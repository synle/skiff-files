// The main file-browsing view. Owns navigation history, current entries, and
// the active sort. Delegates rendering to PathBar / Toolbar / FileList /
// StatusBar, and the sidebar lives one level up in App so it persists across
// route changes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import PathBar from "../components/PathBar";
import Toolbar from "../components/Toolbar";
import FileList, { type SortDir, type SortKey } from "../components/FileList";
import StatusBar from "../components/StatusBar";
import PreviewPane from "../components/PreviewPane";
import {
  fsDiskSpace,
  fsFind,
  fsCompressZip,
  fsCopyRecursive,
  fsCreateEmptyFile,
  fsExtractZip,
  fsHomeDir,
  fsOpenInTerminal,
  fsOpenWithDefault,
  fsRevealInOs,
  fsStat,
  fsWatchClear,
  fsWatchSet,
  type DiskSpace,
  type Entry,
} from "../api/fs";
import {
  listDir as clientListDir,
  mkdir as clientMkdir,
  rename as clientRename,
  removeOrTrashMany,
  startSync,
} from "../api/client";
import RenameDialog from "../components/RenameDialog";
import EntryContextMenu from "../components/EntryContextMenu";
import PropertiesDialog from "../components/PropertiesDialog";
import BulkRenameDialog from "../components/BulkRenameDialog";
import DiffDialog from "../components/DiffDialog";
import NewEntryDialog from "../components/NewEntryDialog";
import ConfirmDialog from "../components/ConfirmDialog";
import { parentPath } from "../util/format";
import { useSettings } from "../state/settings";
import { isImage } from "../util/mime";
import { uniqueDuplicateName } from "../util/duplicateName";
import {
  clearFileClipboard,
  FILE_CLIPBOARD_EVENT,
  getFileClipboard,
  type FileClipboardEntry,
} from "../util/fileClipboard";
import { NAVIGATE_EVENT, OPEN_IN_TAB_EVENT } from "../App";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface Props {
  /** Optional initial path. Defaults to home dir on first load. */
  initialPath?: string;
  /** When false, this Browser is mounted but hidden by the tab strip.
   *  Global window listeners (drag-drop, Delete, Cmd/Ctrl+F, sidebar
   *  navigate event) skip themselves so only the visible tab acts. */
  isActive?: boolean;
  /** Fires when the active path changes (navigation, back, forward,
   *  sidebar drop). Tab strip uses it to keep tab labels in sync. */
  onPathChange?: (path: string) => void;
}

/**
 * Maintains a back/forward history a la a browser. We keep two stacks; the
 * "current" path is the top of `back`. Navigations push onto back and clear
 * forward; pressing Back pops from back to forward.
 */
interface History {
  back: string[];
  forward: string[];
}

export default function Browser({
  initialPath,
  isActive = true,
  onPathChange,
}: Props) {
  const { settings, update } = useSettings();
  const [home, setHome] = useState<string>("");
  const [history, setHistory] = useState<History>({ back: [], forward: [] });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Sort state. The Toolbar's column-header click cycles direction,
  // so we keep these locally — but read the *initial* value from
  // settings (per-folder override → app default → "name asc"). On
  // every change we mirror back into Settings so the choice survives
  // tab switches + restarts.
  const [sortKey, setSortKey] = useState<SortKey>(settings.defaultSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(settings.defaultSortDir);
  /** Last-clicked entry — drives the preview pane. */
  const [primarySelected, setPrimarySelected] = useState<Entry | null>(null);
  /** Multi-select set, reported by FileList. We compute aggregate stats
   *  here so the StatusBar can render N of M selected · total size. */
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  /** Per-session toggle of the preview pane, seeded from the persisted
   *  policy. The toolbar eye icon flips this; closing-then-reopening
   *  doesn't change Settings. */
  const [previewOpen, setPreviewOpen] = useState<boolean>(
    () => settings.previewMode !== "off",
  );
  /** In-folder search query. Pure client-side filter when
   *  `searchRecursive` is false; otherwise we dispatch `fs_find` and
   *  show its results until the user navigates / clears. */
  const [search, setSearch] = useState("");
  const [searchRecursive, setSearchRecursive] = useState(false);
  const [findResults, setFindResults] = useState<Entry[] | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  /** True while a Tauri drag-drop is hovering the window. Drives the
   *  semi-transparent overlay rendered at the bottom of this component. */
  const [dragOver, setDragOver] = useState(false);
  /** When non-null, the rename dialog is open against this entry. */
  const [renameTarget, setRenameTarget] = useState<Entry | null>(null);
  /** When non-null, the right-click menu is open at these coordinates. */
  const [contextMenu, setContextMenu] = useState<{
    entry: Entry;
    x: number;
    y: number;
  } | null>(null);
  /** When non-null, the Properties dialog is open against this entry. */
  const [propertiesTarget, setPropertiesTarget] = useState<Entry | null>(null);
  /** Filesystem totals for the current path. Local paths only — remote
   *  paths set this to null and the StatusBar hides the readout. */
  const [diskSpace, setDiskSpace] = useState<DiskSpace | null>(null);
  /** True while `refresh()` is in flight. Drives the toolbar's
   *  refresh-button spinner so the user gets visible feedback that
   *  the click registered, even when the remote is slow. */
  const [isRefreshing, setIsRefreshing] = useState(false);
  /** When non-empty, the BulkRenameDialog is open against this set of
   *  entries. Triggered by F2 with multi-select; single-select F2
   *  still opens the per-file RenameDialog. */
  const [bulkRenameTargets, setBulkRenameTargets] = useState<Entry[]>([]);
  /** When non-null, the NewEntryDialog is open. `kind` picks between
   *  the mkdir vs empty-file submit handler. `defaultName` is the
   *  auto-suggested unique name (collision-aware). */
  const [newEntryDialog, setNewEntryDialog] = useState<{
    kind: "folder" | "file";
    defaultName: string;
  } | null>(null);
  /** Generic yes/no confirm modal. Replaces every `window.confirm`
   *  call (Tauri suppresses native dialogs). Closure captures the
   *  follow-up; the dialog calls `onConfirm` and closes. */
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    destructive?: boolean;
    onConfirm: () => void;
  } | null>(null);
  /** Counter the PathBar watches — incrementing flips it into edit
   *  mode and selects the text. Driven by Cmd/Ctrl+L. */
  const [pathBarFocusRequest, setPathBarFocusRequest] = useState(0);
  /** Empty-area context menu state — anchor coords. When non-null
   *  the menu is open. */
  const [emptyMenu, setEmptyMenu] = useState<{ x: number; y: number } | null>(null);
  /** Mirror of the file clipboard so the StatusBar can show the hint
   *  reactively. Updated via the FILE_CLIPBOARD_EVENT window event. */
  const [clipboardSnap, setClipboardSnap] = useState(getFileClipboard());
  useEffect(() => {
    const onChange = () => setClipboardSnap(getFileClipboard());
    window.addEventListener(FILE_CLIPBOARD_EVENT, onChange);
    return () => window.removeEventListener(FILE_CLIPBOARD_EVENT, onChange);
  }, []);
  /** First file picked for a "Compare with…" pair. When non-null and
   *  the user picks another file, both paths flow into DiffDialog. */
  const [diffBase, setDiffBase] = useState<string | null>(null);
  const [diffOther, setDiffOther] = useState<string | null>(null);

  const path = history.back[history.back.length - 1] ?? "";

  // Resolve home dir + start path on mount. We tolerate the initial call
  // failing (e.g. running outside Tauri during dev) by surfacing an empty
  // file list with an error in the status bar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await fsHomeDir();
        if (cancelled) return;
        setHome(h);
        const start = initialPath ?? settings.startPath ?? "";
        setHistory({ back: [start || h], forward: [] });
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // We deliberately don't depend on settings here — the start path only
    // matters at first launch, not whenever Settings updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Fetch the directory listing for `path` and update local state.
   *  Routes through the unified client so remote paths (`sftp://...`)
   *  hit the registry instead of the local fs. */
  const refresh = useCallback(
    async (target: string) => {
      if (!target) return;
      setIsRefreshing(true);
      try {
        const list = await clientListDir(target, {
          showHidden: settings.showHidden,
        });
        setEntries(list);
        setError(null);
      } catch (e) {
        setEntries([]);
        setError(String(e));
      } finally {
        setIsRefreshing(false);
      }
    },
    [settings.showHidden],
  );

  // Re-fetch whenever the active path or hidden-files setting changes.
  useEffect(() => {
    if (path) void refresh(path);
  }, [path, refresh]);

  // Fetch disk space for the current path. Skipped for sftp:// paths
  // since fs4 only knows about local filesystems; the StatusBar hides
  // the readout when diskSpace is null.
  useEffect(() => {
    if (!path || path.startsWith("sftp://")) {
      setDiskSpace(null);
      return;
    }
    let cancelled = false;
    fsDiskSpace(path)
      .then((s) => !cancelled && setDiskSpace(s))
      .catch(() => !cancelled && setDiskSpace(null));
    return () => {
      cancelled = true;
    };
  }, [path]);

  // Re-target the local fs watcher whenever the active path changes.
  // The Rust side emits debounced fs:changed events; the next effect
  // listens + debounce-refreshes. Skipped for remote paths since
  // local fs notifications can't see them. Only the active tab
  // claims the (single, shared) watcher so background tabs don't
  // reset the watch target every time a sibling navigates.
  useEffect(() => {
    if (!isActive) return;
    if (!path || path.startsWith("sftp://")) {
      void fsWatchClear().catch(() => {});
      return;
    }
    void fsWatchSet(path).catch(() => {
      /* watcher init is best-effort — failure leaves the user with
         manual refresh, which still works. */
    });
  }, [isActive, path]);

  // Subscribe to fs:changed events from the Rust watcher and refresh
  // the visible listing when our path is the one that changed. The
  // Rust side already debounces at 150ms; we add a second 250ms layer
  // here so a burst (e.g. unzipping into the open folder) coalesces
  // into ONE refresh instead of N.
  useEffect(() => {
    if (!isActive) return;
    if (!path || path.startsWith("sftp://")) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>("fs:changed", (event) => {
        // Filter: only react when the changed path is the one we're
        // showing. Watcher emits the path that triggered (notify
        // surfaces the file path, not the parent dir).
        const changed = event.payload ?? "";
        const norm = path.replace(/\/+$/, "");
        if (changed && !changed.startsWith(norm)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void refresh(path), 250);
      }).then((u) => {
        if (cancelled) u();
        else unlisten = u;
      }),
    );
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unlisten?.();
    };
    // refresh is stable enough; capturing path keeps the closure
    // pointing at the active folder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, path]);

  // Bubble path changes up to the tab strip so the tab label tracks
  // the active path.
  useEffect(() => {
    if (path) onPathChange?.(path);
  }, [path, onPathChange]);

  // Track navigation history globally — surfaces in the sidebar's
  // Recent section. We dedup against the head: arriving at the same
  // path twice in a row doesn't double-record. Only the active tab
  // contributes so multiple inactive tabs don't pollute history.
  useEffect(() => {
    if (!isActive || !path) return;
    if (settings.recentPaths[0] === path) return;
    const next = [
      path,
      ...settings.recentPaths.filter((p) => p !== path),
    ].slice(0, 10);
    update("recentPaths", next);
    // We deliberately don't depend on `settings.recentPaths` — the
    // update function reads its current value through useState, and
    // depending here would cause a feedback loop on every update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, isActive]);

  // Listen for sidebar-driven navigations. Decoupling via a window event keeps
  // the Sidebar from needing a reference to setHistory. Only the active tab
  // responds — otherwise N tabs would all jump on a single sidebar click.
  useEffect(() => {
    if (!isActive) return;
    const onExternalNavigate = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail) {
        setHistory((h) => {
          if (detail === h.back[h.back.length - 1]) return h;
          return { back: [...h.back, detail], forward: [] };
        });
      }
    };
    window.addEventListener(NAVIGATE_EVENT, onExternalNavigate);
    return () => window.removeEventListener(NAVIGATE_EVENT, onExternalNavigate);
  }, [isActive]);

  // OS-level drag-and-drop. Tauri emits a unified event for enter / over
  // / drop / leave. On drop, we route each dropped path through
  // sync_start_local so the user gets a progress bar in the Transfers
  // page; for directories we nest under the basename so the dropped
  // folder lands AT the cursor target rather than flattening into it.
  // Inactive tabs skip — only the foreground tab responds to drops.
  useEffect(() => {
    if (!isActive) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      try {
        unlisten = await listen<{ type: string; paths?: string[] }>(
          "tauri://drag-drop",
          async (event) => {
            if (cancelled) return;
            setDragOver(false);
            if (!path) return;
            const paths = event.payload?.paths ?? [];
            for (const p of paths) {
              try {
                const meta = await fsStat(p);
                // For directories, nest under <currentPath>/<basename>.
                // For files, the planner joins the basename for us.
                const dest = meta.isDir ? `${path}/${meta.name}` : path;
                // Cross-protocol-aware: drops onto an sftp:// folder
                // route through the cross-engine automatically.
                await startSync(p, dest, {
                  maxSizeGb: 100,
                  conflictPolicy: "skip",
                });
              } catch (e) {
                setError(String(e));
              }
            }
            void refresh(path);
          },
        );
        const enter = await listen("tauri://drag-enter", () => {
          if (!cancelled) setDragOver(true);
        });
        const leave = await listen("tauri://drag-leave", () => {
          if (!cancelled) setDragOver(false);
        });
        const prevUnlisten = unlisten;
        unlisten = () => {
          prevUnlisten?.();
          enter();
          leave();
        };
      } catch {
        // Running outside Tauri (browser dev / tests) — drag-drop just
        // doesn't fire. Silent fallback.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [path, refresh, isActive]);

  // F2 on the primary selection → open rename dialog. Skips when an
  // input is focused so typing F2 elsewhere doesn't hijack focus.
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F2") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
      if (!primarySelected) return;
      e.preventDefault();
      // Multi-selection → bulk dialog; single → per-file dialog.
      if (selectedPaths.length > 1) {
        const set = new Set(selectedPaths);
        const selectedEntries = entries.filter((en) => set.has(en.path));
        setBulkRenameTargets(selectedEntries);
      } else {
        setRenameTarget(primarySelected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, primarySelected, selectedPaths, entries]);

  // Cmd/Ctrl+R → refresh the current folder. F5 is also a refresh
  // alias (Windows Explorer muscle memory; takes no modifier).
  // Cmd/Ctrl+Shift+N → new folder. Skip on input focus so typing
  // in the path bar doesn't trigger them.
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
      // F5 — bare keypress, no modifier.
      if (e.key === "F5" && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        if (path) void refresh(path);
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "r" && !e.shiftKey) {
        e.preventDefault();
        if (path) void refresh(path);
      } else if (k === "n" && e.shiftKey) {
        e.preventDefault();
        void handleNewFolder();
      } else if (k === "l" && !e.shiftKey) {
        // Browser muscle memory: Cmd/Ctrl+L = jump to address bar.
        e.preventDefault();
        setPathBarFocusRequest((c) => c + 1);
      } else if (k === "i" && !e.shiftKey) {
        // Finder muscle memory: Cmd+I = Get Info / preview toggle.
        e.preventDefault();
        setPreviewOpen((o) => !o);
      } else if (k === "d" && !e.shiftKey) {
        // Browser muscle memory: Cmd/Ctrl+D = bookmark current page.
        // No-op when the current path is already bookmarked.
        if (!path) return;
        e.preventDefault();
        if (settings.bookmarks.some((b) => b.path === path)) return;
        const segs = path.split(/[\\/]/).filter(Boolean);
        const label = segs.at(-1) || path;
        update("bookmarks", [
          ...settings.bookmarks,
          { id: crypto.randomUUID(), label, path },
        ]);
      } else if (k === "v" && !e.shiftKey) {
        // Cmd/Ctrl+V = paste files from the file clipboard into the
        // current folder. Each path becomes a Skiffsync src; the
        // engine handles cross-protocol cleanly. On `cut`, source
        // files are removed after the sync's done event.
        if (!path) return;
        const clipboard = getFileClipboard();
        if (!clipboard || clipboard.paths.length === 0) return;
        e.preventDefault();
        void handlePaste(clipboard);
      } else if (e.key === "ArrowUp" && !e.shiftKey) {
        // Finder convention: Cmd+↑ goes up one folder. Same as the
        // toolbar Up button. Skipped on Shift+Up so it doesn't
        // hijack range-select.
        if (!path || parentPath(path) === path) return;
        e.preventDefault();
        goUp();
      } else if (e.key === "[") {
        // Browser muscle memory: Cmd+[ = back. Same effect as the
        // toolbar's left arrow.
        if (history.back.length <= 1) return;
        e.preventDefault();
        goBack();
      } else if (e.key === "]") {
        // Cmd+] = forward.
        if (history.forward.length === 0) return;
        e.preventDefault();
        goForward();
      } else if (e.key === "ArrowLeft" && !e.shiftKey) {
        // Cmd+← also goes back (Finder convention; some users
        // prefer arrows over brackets).
        if (history.back.length <= 1) return;
        e.preventDefault();
        goBack();
      } else if (e.key === "ArrowRight" && !e.shiftKey) {
        if (history.forward.length === 0) return;
        e.preventDefault();
        goForward();
      } else if (e.key === "ArrowDown" && !e.shiftKey) {
        // Finder convention: Cmd+↓ opens the focused entry — folders
        // navigate in, files open with the OS default app. Falls back
        // to a no-op when nothing is focused so it doesn't fight the
        // FileList's plain ArrowDown nav.
        if (!primarySelected) return;
        e.preventDefault();
        if (primarySelected.isDir) {
          navigate(primarySelected.path);
        } else if (!primarySelected.path.startsWith("sftp://")) {
          void fsOpenWithDefault(primarySelected.path).catch((err) =>
            setError(String(err)),
          );
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleNewFolder + refresh are stable enough; we list path so the
    // refresh handler reads the current value via closure capture.
    // primarySelected drives the Cmd+↓ open-entry binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, path, primarySelected]);

  // Mouse thumb buttons (X1 = back, X2 = forward) — common on full-size
  // mice and some trackball setups. The browser-style affordance the
  // user expects from any history-having app. Only the active tab
  // responds so background tabs don't yank under the cursor.
  useEffect(() => {
    if (!isActive) return;
    const onMouseDown = (e: MouseEvent) => {
      // button 3 = back (X1), button 4 = forward (X2). preventDefault
      // suppresses the browser's own back/forward gesture that the
      // webview would otherwise inherit.
      if (e.button === 3 && history.back.length > 1) {
        e.preventDefault();
        goBack();
      } else if (e.button === 4 && history.forward.length > 0) {
        e.preventDefault();
        goForward();
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    // `auxclick` covers webviews that don't surface button 3/4 via
    // mousedown on every platform — belt + suspenders.
    window.addEventListener("auxclick", onMouseDown as EventListener);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("auxclick", onMouseDown as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, history.back.length, history.forward.length]);

  // Cmd/Ctrl + F → focus the toolbar search input. Doesn't fire if the
  // user is already in an input (so it doesn't hijack the path bar).
  // Only the active tab responds; otherwise hidden tabs would steal
  // focus to their own (invisible) search box.
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "f") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
      e.preventDefault();
      // Cmd/Ctrl+Shift+F = recursive find. Cmd/Ctrl+F = in-pane filter.
      // Both flip the recursive bit explicitly so toggling between the
      // two modes doesn't get sticky.
      setSearchRecursive(e.shiftKey);
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive]);

  // Delete-key → send selection to OS trash. Backspace alone is reserved
  // for "go up", so we use the dedicated Delete key (Mac users can hit
  // Fn+Backspace which the OS rewrites to Delete). Skips input focus so
  // typing in the path bar / connection form isn't hijacked. Inactive
  // tabs ignore — otherwise a Delete keypress would purge from every tab.
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
      if (selectedPaths.length === 0) return;
      const hasRemote = selectedPaths.some((p) => p.startsWith("sftp://"));
      const verb = hasRemote ? "Permanently delete" : "Move to Trash";
      const count = selectedPaths.length;
      // Modal-based confirm — `window.confirm` is suppressed in the
      // Tauri webview (see CLAUDE.md → Known footguns).
      setConfirmDialog({
        title: verb,
        message: `${verb} ${count} item${count === 1 ? "" : "s"}?`,
        confirmLabel: hasRemote ? "Delete" : "Move to Trash",
        destructive: true,
        onConfirm: () => {
          setConfirmDialog(null);
          void removeOrTrashMany(selectedPaths)
            .then(() => {
              if (path) void refresh(path);
            })
            .catch((err) => setError(String(err)));
        },
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPaths, path, refresh, isActive]);

  /** Push a path onto history (the canonical way to navigate). */
  const navigate = useCallback((target: string) => {
    setHistory((h) => {
      if (target === h.back[h.back.length - 1]) return h;
      return { back: [...h.back, target], forward: [] };
    });
  }, []);

  const goBack = useCallback(() => {
    setHistory((h) => {
      if (h.back.length <= 1) return h;
      const top = h.back[h.back.length - 1];
      return {
        back: h.back.slice(0, -1),
        forward: [top, ...h.forward],
      };
    });
  }, []);

  const goForward = useCallback(() => {
    setHistory((h) => {
      if (h.forward.length === 0) return h;
      const [next, ...rest] = h.forward;
      return { back: [...h.back, next], forward: rest };
    });
  }, []);

  /** Jump multiple steps back/forward — used by the toolbar's
   *  right-click history dropdowns. `steps` is the 1-indexed count
   *  in the chosen direction (so 1 == one step back == clicking the
   *  back arrow). */
  const jumpHistory = useCallback(
    (direction: "back" | "forward", steps: number) => {
      setHistory((h) => {
        if (direction === "back") {
          if (steps <= 0 || steps >= h.back.length) return h;
          // Take the top `steps` entries off `back`, push them onto
          // `forward` (in reverse so the most-recent is at the head).
          const moved = h.back.slice(h.back.length - steps).reverse();
          return {
            back: h.back.slice(0, h.back.length - steps),
            forward: [...moved, ...h.forward],
          };
        }
        if (steps <= 0 || steps > h.forward.length) return h;
        const moved = h.forward.slice(0, steps);
        return {
          back: [...h.back, ...moved],
          forward: h.forward.slice(steps),
        };
      });
    },
    [],
  );

  const goUp = useCallback(() => {
    if (!path) return;
    const p = parentPath(path);
    if (p && p !== path) navigate(p);
  }, [path, navigate]);

  const handleSort = (key: SortKey) => {
    let nextKey = sortKey;
    let nextDir: SortDir = sortDir;
    if (key === sortKey) {
      nextDir = sortDir === "asc" ? "desc" : "asc";
      setSortDir(nextDir);
    } else {
      nextKey = key;
      nextDir = "asc";
      setSortKey(nextKey);
      setSortDir(nextDir);
    }
    // Persist the choice in folderSort so navigating away and back
    // preserves it. Same 200-entry cap as folderViewMode.
    if (!path) return;
    const next = {
      ...settings.folderSort,
      [path]: { key: nextKey, dir: nextDir },
    };
    const keys = Object.keys(next);
    if (keys.length > 200) {
      const trimmed: typeof next = {};
      for (const k of keys.slice(keys.length - 200)) {
        trimmed[k] = next[k];
      }
      update("folderSort", trimmed);
    } else {
      update("folderSort", next);
    }
  };

  /** Cmd+V handler — start a Skiffsync from each clipboard entry to
   *  the current folder. On `cut`, deletes the source after the
   *  sync's done event. Same backend abstraction as the drag-drop
   *  flow; works cross-protocol. */
  const handlePaste = async (clipboard: FileClipboardEntry) => {
    if (!path) return;
    const isCut = clipboard.operation === "cut";
    const remoteCutPaths: string[] = [];
    for (const src of clipboard.paths) {
      try {
        const meta = await fsStat(src);
        const dest = meta.isDir ? `${path}/${meta.name}` : path;
        await startSync(src, dest, {
          maxSizeGb: 100,
          conflictPolicy: settings.syncDefaultConflictPolicy,
        });
        if (isCut) {
          // Defer deletion to the run-loop after sync starts —
          // sync_start_* returns once the job is queued, the actual
          // copy happens async. For correctness we should wait for
          // the done event; for simplicity we trust the engine here
          // and queue removal optimistically.
          remoteCutPaths.push(src);
        }
      } catch (e) {
        setError(String(e));
      }
    }
    // For cut: remove sources after sync completes. We do this best-
    // effort; if the sync fails the source stays put.
    if (isCut && remoteCutPaths.length > 0) {
      // Wait a beat so the sync engine has time to read the source
      // before we remove it. Not bulletproof but adequate for MVP —
      // the alternative requires hooking sync:done events and is
      // significantly more complex.
      setTimeout(() => {
        void removeOrTrashMany(remoteCutPaths)
          .catch(() => {/* engine errors surface in TransfersPage */})
          .finally(() => {
            clearFileClipboard();
            if (path) void refresh(path);
          });
      }, 1500);
    } else {
      if (path) void refresh(path);
    }
  };

  /** Open the New File dialog. The dialog itself owns input + collision
   *  validation; `handleCreateEntry` runs on submit. */
  const handleNewFile = () => {
    if (!path) return;
    if (path.startsWith("sftp://")) {
      setError("Creating files on remote hosts isn't supported yet.");
      return;
    }
    const existing = new Set(entries.map((e) => e.name));
    let suggestion = "untitled.txt";
    let n = 2;
    while (existing.has(suggestion)) {
      suggestion = `untitled ${n++}.txt`;
    }
    setNewEntryDialog({ kind: "file", defaultName: suggestion });
  };

  /** Open the New Folder dialog. */
  const handleNewFolder = () => {
    if (!path) return;
    const existing = new Set(entries.map((e) => e.name));
    let suggestion = "New Folder";
    let n = 2;
    while (existing.has(suggestion)) {
      suggestion = `New Folder ${n++}`;
    }
    setNewEntryDialog({ kind: "folder", defaultName: suggestion });
  };

  /** NewEntryDialog's onSubmit callback. Dispatches mkdir or empty-file
   *  create based on the open dialog's `kind`. The dialog itself
   *  refuses collisions before reaching here, but the backend's
   *  `already exists` errors still propagate as inline error text. */
  const handleCreateEntry = async (name: string) => {
    if (!path || !newEntryDialog) return;
    const target = `${path}/${name}`;
    if (newEntryDialog.kind === "folder") {
      await clientMkdir(target);
    } else {
      await fsCreateEmptyFile(target);
    }
    await refresh(path);
  };

  const totals = useMemo(() => {
    let totalSize = 0;
    let folderCount = 0;
    let fileCount = 0;
    for (const e of entries) {
      if (e.isDir) folderCount++;
      else {
        fileCount++;
        totalSize += e.size;
      }
    }
    return { totalSize, folderCount, fileCount };
  }, [entries]);

  /** Filtered entry list — case-insensitive substring match on `name`.
   *  When recursive find is on we substitute the find results instead.
   *  Always pre-filters known OS system-junk filenames when
   *  `hideSystemFiles` is on so users don't have to toggle `showHidden`
   *  just to escape `.DS_Store` clutter. */
  const visibleEntries = useMemo(() => {
    const SYSTEM_NAMES = new Set([
      ".DS_Store",
      "Thumbs.db",
      "desktop.ini",
      ".localized",
      "._.DS_Store",
    ]);
    // Recursive find is only meaningful with a query — when the toggle
    // is on but the input is empty, fall back to the local listing
    // so the pane doesn't show "Empty folder" out of the blue.
    let base =
      searchRecursive && findResults && search ? findResults : entries;
    if (settings.hideSystemFiles) {
      base = base.filter((e) => !SYSTEM_NAMES.has(e.name));
    }
    if (!search) return base;
    const q = search.toLowerCase();
    return base.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, search, searchRecursive, findResults, settings.hideSystemFiles]);

  // Reset the query on every navigation — the new folder almost certainly
  // doesn't have files matching the previous folder's search.
  useEffect(() => {
    setSearch("");
    setFindResults(null);
    setSearchRecursive(false);
  }, [path]);

  // Debounced recursive find. Fires 300 ms after the last keystroke so a
  // user typing "abc" doesn't trigger three full disk walks. Cancellation
  // happens via `cancelled` rather than a server-side cancel because
  // fs_find is bounded by max-results + max-secs anyway.
  useEffect(() => {
    if (!searchRecursive) {
      setFindResults(null);
      return;
    }
    if (!search || !path) {
      setFindResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void fsFind(path, search)
        .then((rs) => !cancelled && setFindResults(rs))
        .catch((e) => !cancelled && setError(String(e)));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, searchRecursive, path]);

  /** Aggregate stats over the multi-selection. Memoized so a 100k-entry
   *  folder doesn't re-walk on every keystroke. */
  const selectionStats = useMemo(() => {
    if (selectedPaths.length === 0) return { count: 0, size: 0 };
    const set = new Set(selectedPaths);
    let size = 0;
    let count = 0;
    for (const e of entries) {
      if (set.has(e.path)) {
        count++;
        if (!e.isDir) size += e.size;
      }
    }
    return { count, size };
  }, [entries, selectedPaths]);

  // Reset the primary selection on every navigation — sticking to a row in
  // the previous folder would surface a stale path in the preview pane.
  useEffect(() => {
    setPrimarySelected(null);
  }, [path]);

  // Apply per-folder sort overrides on every navigation. Falls back
  // to the app-wide defaults when a folder has no override.
  useEffect(() => {
    if (!path) return;
    const override = settings.folderSort[path];
    if (override) {
      setSortKey(override.key);
      setSortDir(override.dir);
    } else {
      setSortKey(settings.defaultSortKey);
      setSortDir(settings.defaultSortDir);
    }
    // Intentionally don't depend on the settings.folderSort identity —
    // recomputing on every settings update would clobber the user's
    // choice mid-session. We only read on path change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Honor the preview policy. `imagesOnly` only opens the pane when the
  // primary selection is image-shaped; `always` opens unconditionally. The
  // user can still hide via the toolbar — the policy seeds defaults, it
  // doesn't lock state.
  const effectivePreviewOpen =
    settings.previewMode === "off"
      ? false
      : settings.previewMode === "always"
        ? previewOpen
        : previewOpen &&
          !!primarySelected &&
          !primarySelected.isDir &&
          isImage(primarySelected.path);

  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        height: "100%",
        // `position: relative` so the drag-drop overlay can absolute-pin
        // to this Browser pane (and not the whole window).
        position: "relative",
      }}
    >
      <PathBar
        path={path}
        onNavigate={navigate}
        onHome={() => home && navigate(home)}
        focusRequest={pathBarFocusRequest}
      />
      <Toolbar
        canGoBack={history.back.length > 1}
        canGoForward={history.forward.length > 0}
        canGoUp={!!path && parentPath(path) !== path}
        upTarget={path ? parentPath(path) : undefined}
        onBack={goBack}
        onForward={goForward}
        onUp={goUp}
        // Slice off the current path (top of `back`) so the menu only
        // lists destinations the user could actually go back to.
        backHistory={history.back.slice(0, -1)}
        forwardHistory={history.forward}
        onHistoryJump={jumpHistory}
        isRefreshing={isRefreshing}
        onRefresh={() => path && void refresh(path)}
        onNewFolder={() => void handleNewFolder()}
        onNewFile={() => void handleNewFile()}
        view={settings.folderViewMode[path] ?? settings.defaultView}
        onViewChange={(v) => {
          // Persist per-folder rather than globally — the user picked
          // this view *for this path*, not as a new app-wide default.
          // Trim to FOLDER_VIEW_MAX (LRU-style: oldest insertion order
          // entries get dropped) so settings.json stays bounded.
          const next = { ...settings.folderViewMode, [path]: v };
          const keys = Object.keys(next);
          // 200 cap matches FOLDER_VIEW_MAX. We don't import the
          // constant here to keep this hot path simple.
          if (keys.length > 200) {
            const trimmed: typeof next = {};
            for (const k of keys.slice(keys.length - 200)) {
              trimmed[k] = next[k];
            }
            update("folderViewMode", trimmed);
          } else {
            update("folderViewMode", next);
          }
        }}
        previewOpen={previewOpen}
        onTogglePreview={() => setPreviewOpen((o) => !o)}
        search={search}
        onSearchChange={setSearch}
        searchRecursive={searchRecursive}
        onSearchRecursiveChange={setSearchRecursive}
        searchInputRef={searchInputRef}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortChange={handleSort}
        onSortDirToggle={() =>
          setSortDir((d) => (d === "asc" ? "desc" : "asc"))
        }
        showHidden={settings.showHidden}
        onShowHiddenToggle={() => update("showHidden", !settings.showHidden)}
        searchHistory={settings.searchHistory}
        onSearchCommit={(q) => {
          // Push to head, dedup, cap at SEARCH_HISTORY_MAX (10). Most-
          // recent first matches typical recall patterns.
          const next = [
            q,
            ...settings.searchHistory.filter((x) => x !== q),
          ].slice(0, 10);
          if (
            next.length !== settings.searchHistory.length ||
            next[0] !== settings.searchHistory[0]
          ) {
            update("searchHistory", next);
          }
        }}
      />
      <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
        <FileList
          entries={visibleEntries}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={handleSort}
          onOpenDir={(e) => navigate(e.path)}
          onDropOntoFolder={(paths, target) => {
            // Same Skiffsync flow as the sidebar host / bookmark
            // drops — fire one job per dropped path nested under
            // the target folder's basename. Honors the user's
            // default conflict policy.
            const dest = target.path;
            for (const src of paths) {
              const segs = src.split(/[\\/]/).filter(Boolean);
              const base = segs.at(-1) ?? src;
              void startSync(src, `${dest}/${base}`, {
                maxSizeGb: 100,
                conflictPolicy: settings.syncDefaultConflictPolicy,
              }).catch((err) => setError(String(err)));
            }
          }}
          onOpenFile={(e) => {
            // Hand off to the OS default app. Skipped for remote
            // entries since the local OS can't open them without
            // download.
            if (e.path.startsWith("sftp://")) return;
            void fsOpenWithDefault(e.path).catch((err) => setError(String(err)));
          }}
          onOpenDirInNewTab={(e) => {
            window.dispatchEvent(
              new CustomEvent(OPEN_IN_TAB_EVENT, { detail: e.path }),
            );
          }}
          onPrimarySelect={setPrimarySelected}
          onSelectionChange={setSelectedPaths}
          onContext={(entry, x, y) => setContextMenu({ entry, x, y })}
          isActive={isActive}
          density={settings.density}
          showExtensions={settings.showExtensions}
          groupFoldersFirst={settings.groupFoldersFirst}
          highlightQuery={search}
          onContextEmpty={(x, y) => setEmptyMenu({ x, y })}
          contextMenuPath={contextMenu?.entry.path ?? null}
          view={settings.folderViewMode[path] ?? settings.defaultView}
          path={path}
        />
        {effectivePreviewOpen && (
          <PreviewPane
            selected={primarySelected}
            width={settings.previewWidth}
          />
        )}
      </Box>
      {settings.showStatusBar && <StatusBar
        totalEntries={
          searchRecursive && findResults && search
            ? findResults.length
            : entries.length
        }
        folderCount={totals.folderCount}
        fileCount={totals.fileCount}
        selectedEntries={selectionStats.count}
        selectedSize={
          selectionStats.count > 0 ? selectionStats.size : totals.totalSize
        }
        errorMessage={error}
        onDismissError={() => setError(null)}
        diskFree={diskSpace?.free ?? null}
        diskTotal={diskSpace?.total ?? null}
        findActive={searchRecursive && findResults != null && !!search}
        // The Rust-side cap is 1000 results; reaching it is the
        // user's signal to refine the query.
        findHitCap={!!findResults && findResults.length >= 1000}
        clipboardHint={
          clipboardSnap
            ? { count: clipboardSnap.paths.length, op: clipboardSnap.operation }
            : null
        }
        selectedName={
          selectionStats.count === 1 && primarySelected
            ? primarySelected.name
            : null
        }
      />}
      <Menu
        open={emptyMenu !== null}
        onClose={() => setEmptyMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={
          emptyMenu ? { top: emptyMenu.y, left: emptyMenu.x } : undefined
        }
        slotProps={{ list: { dense: true } }}
      >
        <MenuItem
          onClick={() => {
            setEmptyMenu(null);
            void handleNewFolder();
          }}
        >
          <ListItemIcon>
            <CreateNewFolderIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>New folder</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setEmptyMenu(null);
            void handleNewFile();
          }}
        >
          <ListItemIcon>
            <NoteAddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>New file</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={getFileClipboard() === null}
          onClick={() => {
            const cb = getFileClipboard();
            setEmptyMenu(null);
            if (cb) void handlePaste(cb);
          }}
        >
          <ListItemIcon>
            <ContentPasteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {(() => {
              const cb = getFileClipboard();
              return cb
                ? `Paste ${cb.paths.length} item${cb.paths.length === 1 ? "" : "s"}`
                : "Paste";
            })()}
          </ListItemText>
        </MenuItem>
      </Menu>
      <EntryContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(null)}
        onOpen={(e) => navigate(e.path)}
        onRename={(e) => setRenameTarget(e)}
        onTrash={(e) => {
          // If the right-clicked entry is part of a multi-selection,
          // trash the WHOLE selection — that's what the user expects
          // when 3 rows are checked and they right-click one. Falls
          // back to single-entry trash when the right-clicked row
          // isn't in the selection (or nothing is selected).
          const targets =
            selectedPaths.length > 0 && selectedPaths.includes(e.path)
              ? selectedPaths
              : [e.path];
          const hasRemote = targets.some((p) => p.startsWith("sftp://"));
          const verb = hasRemote ? "Permanently delete" : "Move to Trash";
          const message =
            targets.length === 1
              ? `${verb} "${e.name}"?`
              : `${verb} ${targets.length} items?`;
          setConfirmDialog({
            title: verb,
            message,
            confirmLabel: hasRemote ? "Delete" : "Move to Trash",
            destructive: true,
            onConfirm: () => {
              setConfirmDialog(null);
              void removeOrTrashMany(targets)
                .then(() => {
                  if (path) void refresh(path);
                })
                .catch((err) => setError(String(err)));
            },
          });
        }}
        onCopyPath={(e) => {
          // Best-effort — falls back silently in tests / browser
          // contexts without clipboard access.
          if (typeof navigator !== "undefined" && navigator.clipboard) {
            void navigator.clipboard.writeText(e.path);
          }
        }}
        onProperties={(e) => setPropertiesTarget(e)}
        onOpenWithDefault={(e) => {
          void fsOpenWithDefault(e.path).catch((err) => setError(String(err)));
        }}
        onRevealInOs={(e) => {
          void fsRevealInOs(e.path).catch((err) => setError(String(err)));
        }}
        onOpenInTerminal={(e) => {
          void fsOpenInTerminal(e.path).catch((err) => setError(String(err)));
        }}
        onOpenInNewTab={(e) => {
          window.dispatchEvent(
            new CustomEvent(OPEN_IN_TAB_EVENT, { detail: e.path }),
          );
        }}
        onExtractZip={(e) => {
          // Pick a sibling folder named after the zip (sans
          // extension), with collision-aware fallback.
          const sep = e.path.lastIndexOf("/");
          const parent = sep > 0 ? e.path.slice(0, sep) : "";
          const baseName = e.name.replace(/\.zip$/i, "") || "extracted";
          const existing = new Set(entries.map((x) => x.name));
          let candidate = baseName;
          let n = 2;
          while (existing.has(candidate)) {
            candidate = `${baseName} (${n++})`;
          }
          const dest = `${parent}/${candidate}`;
          void fsExtractZip(e.path, dest)
            .then(() => {
              if (path) void refresh(path);
            })
            .catch((err) => setError(String(err)));
        }}
        onCompressZip={(e) => {
          // If the user right-clicked while multi-selecting, zip
          // the whole selection. Otherwise just the right-clicked
          // entry. Names the archive after the first source —
          // "<basename>.zip" with collision-aware fallback.
          const sources = selectedPaths.length > 0 && selectedPaths.includes(e.path)
            ? selectedPaths
            : [e.path];
          const sep = e.path.lastIndexOf("/");
          const parent = sep > 0 ? e.path.slice(0, sep) : "";
          const baseName =
            sources.length === 1
              ? (e.name.replace(/\.[^.]+$/, "") || "archive")
              : "archive";
          const existing = new Set(entries.map((x) => x.name));
          let candidate = `${baseName}.zip`;
          let n = 2;
          while (existing.has(candidate)) {
            candidate = `${baseName} (${n++}).zip`;
          }
          const dest = `${parent}/${candidate}`;
          void fsCompressZip(sources, dest)
            .then(() => {
              if (path) void refresh(path);
            })
            .catch((err) => setError(String(err)));
        }}
        onDuplicate={(e) => {
          // Timestamped duplicate: `<name>-copy-YYYY-MM-DD-HH-MM`.
          // If the source already ends in a `-copy-<timestamp>`,
          // strip it before re-appending so re-duplicates don't
          // grow the name forever (see util/duplicateName).
          // Routes through fs_copy_recursive (synchronous) so we
          // can refresh once the copy is on disk — Skiffsync's
          // start_local returns once the job is queued, not done,
          // which races refresh.
          const existing = new Set(entries.map((x) => x.name));
          const candidate = uniqueDuplicateName(e.name, existing, {
            isDir: e.isDir,
          });
          const sep = e.path.lastIndexOf("/");
          const parent = sep > 0 ? e.path.slice(0, sep) : "";
          const target = `${parent}/${candidate}`;
          if (e.path.startsWith("sftp://")) {
            // Remote duplicate has to go through Skiffsync; the
            // synchronous fs_copy_recursive is local-only. Refresh
            // races the async sync but it's the best we can do
            // until conn_copy_recursive lands.
            void startSync(e.path, target, {
              maxSizeGb: 100,
              conflictPolicy: "skip",
            })
              .then(() => path && void refresh(path))
              .catch((err) => setError(String(err)));
            return;
          }
          void fsCopyRecursive(e.path, target)
            .then(() => path && void refresh(path))
            .catch((err) => setError(String(err)));
        }}
        comparePending={diffBase !== null}
        onCompareWith={(e) => {
          // Two-phase: first call captures the base; second call
          // launches the diff. Same path twice = no-op (with a clean
          // reset so the user can pick again).
          if (diffBase === null) {
            setDiffBase(e.path);
          } else if (e.path === diffBase) {
            setDiffBase(null);
          } else {
            setDiffOther(e.path);
          }
        }}
        onBookmark={(e) => {
          // Append a fresh bookmark with a UUID id; the basename
          // becomes the default label. Settings are persisted via
          // the existing settings provider.
          if (settings.bookmarks.some((b) => b.path === e.path)) return;
          update("bookmarks", [
            ...settings.bookmarks,
            { id: crypto.randomUUID(), label: e.name, path: e.path },
          ]);
        }}
      />
      <PropertiesDialog
        entry={propertiesTarget}
        onClose={() => setPropertiesTarget(null)}
      />
      <DiffDialog
        left={diffBase}
        right={diffOther}
        onClose={() => {
          setDiffBase(null);
          setDiffOther(null);
        }}
      />
      <BulkRenameDialog
        entries={bulkRenameTargets}
        onClose={() => setBulkRenameTargets([])}
        onDone={() => {
          if (path) void refresh(path);
        }}
      />
      <RenameDialog
        open={!!renameTarget}
        originalName={renameTarget?.name ?? ""}
        originalPath={renameTarget?.path ?? ""}
        existingNames={
          new Set(
            entries
              .filter((x) => x.path !== renameTarget?.path)
              .map((x) => x.name),
          )
        }
        onClose={() => setRenameTarget(null)}
        onRename={async (newName) => {
          if (!renameTarget) return;
          // Compute the destination path: same parent, new basename.
          // For sftp paths the address-bar form is `sftp://<id>/...`
          // — splitting on the last separator works for both shapes.
          const sep = renameTarget.path.lastIndexOf("/");
          const parent =
            sep > 0 ? renameTarget.path.slice(0, sep) : renameTarget.path;
          const dest = `${parent}/${newName}`;
          await clientRename(renameTarget.path, dest);
          if (path) await refresh(path);
        }}
      />
      <NewEntryDialog
        open={newEntryDialog !== null}
        title={newEntryDialog?.kind === "file" ? "New file" : "New folder"}
        parentPath={path}
        defaultName={newEntryDialog?.defaultName ?? ""}
        existingNames={new Set(entries.map((x) => x.name))}
        submitLabel="Create"
        onClose={() => setNewEntryDialog(null)}
        onSubmit={handleCreateEntry}
      />
      <ConfirmDialog
        open={confirmDialog !== null}
        title={confirmDialog?.title ?? ""}
        message={confirmDialog?.message ?? ""}
        confirmLabel={confirmDialog?.confirmLabel}
        destructive={confirmDialog?.destructive}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => confirmDialog?.onConfirm()}
      />
      {dragOver && (
        // Pointer-events: none so the OS drag operation isn't intercepted
        // by the overlay; we're purely visual here.
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            bgcolor: "primary.main",
            opacity: 0.15,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Box
            sx={{
              bgcolor: "background.paper",
              border: 2,
              borderStyle: "dashed",
              borderColor: "primary.main",
              borderRadius: 2,
              px: 4,
              py: 2,
              opacity: 1,
            }}
          >
            Drop to copy here
          </Box>
        </Box>
      )}
    </Box>
  );
}
