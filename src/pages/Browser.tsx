// The main file-browsing view. Owns navigation history, current entries, and
// the active sort. Delegates rendering to PathBar / Toolbar / FileList /
// StatusBar, and the sidebar lives one level up in App so it persists across
// route changes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import PathBar from "../components/PathBar";
import Toolbar from "../components/Toolbar";
import FileList, { type SortDir, type SortKey } from "../components/FileList";
import StatusBar from "../components/StatusBar";
import PreviewPane from "../components/PreviewPane";
import {
  fsDiskSpace,
  fsFind,
  fsHomeDir,
  fsOpenInTerminal,
  fsOpenWithDefault,
  fsRevealInOs,
  fsStat,
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
import { parentPath } from "../util/format";
import { useSettings } from "../state/settings";
import { isImage } from "../util/mime";
import { NAVIGATE_EVENT } from "../App";
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

  // Cmd/Ctrl+R → refresh the current folder. Cmd/Ctrl+Shift+N →
  // new folder. Both have been documented in the cheatsheet since
  // 0.1.2; finally implementing. Skip on input focus so typing in
  // the path bar doesn't trigger them.
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === "r" && !e.shiftKey) {
        e.preventDefault();
        if (path) void refresh(path);
      } else if (k === "n" && e.shiftKey) {
        e.preventDefault();
        void handleNewFolder();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleNewFolder + refresh are stable enough; we list path so the
    // refresh handler reads the current value via closure capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, path]);

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
      const verb = hasRemote
        ? "Permanently delete" // remote: no server-side trash
        : "Move to Trash";
      const ok = window.confirm(
        `${verb} ${selectedPaths.length} item${selectedPaths.length === 1 ? "" : "s"}?`,
      );
      if (!ok) return;
      void removeOrTrashMany(selectedPaths)
        .then(() => {
          if (path) void refresh(path);
        })
        .catch((err) => setError(String(err)));
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

  const handleNewFolder = async () => {
    if (!path) return;
    // Auto-name "New Folder", "New Folder 2", ... so we don't need a modal
    // on the first cut. A rename-on-create flow lands with the context menu.
    const existing = new Set(entries.map((e) => e.name));
    let name = "New Folder";
    let n = 2;
    while (existing.has(name)) {
      name = `New Folder ${n++}`;
    }
    const target = `${path}/${name}`;
    try {
      await clientMkdir(target);
      await refresh(path);
    } catch (e) {
      setError(String(e));
    }
  };

  const totals = useMemo(() => {
    let totalSize = 0;
    for (const e of entries) totalSize += e.isDir ? 0 : e.size;
    return { totalSize };
  }, [entries]);

  /** Filtered entry list — case-insensitive substring match on `name`.
   *  When recursive find is on we substitute the find results instead. */
  const visibleEntries = useMemo(() => {
    if (searchRecursive && findResults) return findResults;
    if (!search) return entries;
    const q = search.toLowerCase();
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, search, searchRecursive, findResults]);

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
      />
      <Toolbar
        canGoBack={history.back.length > 1}
        canGoForward={history.forward.length > 0}
        canGoUp={!!path && parentPath(path) !== path}
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
      />
      <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
        <FileList
          entries={visibleEntries}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={handleSort}
          onOpenDir={(e) => navigate(e.path)}
          onPrimarySelect={setPrimarySelected}
          onSelectionChange={setSelectedPaths}
          onContext={(entry, x, y) => setContextMenu({ entry, x, y })}
          isActive={isActive}
          density={settings.density}
          showExtensions={settings.showExtensions}
          groupFoldersFirst={settings.groupFoldersFirst}
        />
        {effectivePreviewOpen && (
          <PreviewPane
            selected={primarySelected}
            width={settings.previewWidth}
          />
        )}
      </Box>
      <StatusBar
        totalEntries={entries.length}
        selectedEntries={selectionStats.count}
        selectedSize={
          selectionStats.count > 0 ? selectionStats.size : totals.totalSize
        }
        errorMessage={error}
        onDismissError={() => setError(null)}
        diskFree={diskSpace?.free ?? null}
        diskTotal={diskSpace?.total ?? null}
      />
      <EntryContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(null)}
        onOpen={(e) => navigate(e.path)}
        onRename={(e) => setRenameTarget(e)}
        onTrash={(e) => {
          // Single-entry trash. Reuses the same confirm + remote
          // wording as the multi-select Delete-key path.
          const isRemoteEntry = e.path.startsWith("sftp://");
          const verb = isRemoteEntry ? "Permanently delete" : "Move to Trash";
          if (!window.confirm(`${verb} "${e.name}"?`)) return;
          void removeOrTrashMany([e.path])
            .then(() => {
              if (path) void refresh(path);
            })
            .catch((err) => setError(String(err)));
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
