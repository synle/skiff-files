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
import { fsFind, fsHomeDir, fsStat, type Entry } from "../api/fs";
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
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
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
      try {
        const list = await clientListDir(target, {
          showHidden: settings.showHidden,
        });
        setEntries(list);
        setError(null);
      } catch (e) {
        setEntries([]);
        setError(String(e));
      }
    },
    [settings.showHidden],
  );

  // Re-fetch whenever the active path or hidden-files setting changes.
  useEffect(() => {
    if (path) void refresh(path);
  }, [path, refresh]);

  // Bubble path changes up to the tab strip so the tab label tracks
  // the active path.
  useEffect(() => {
    if (path) onPathChange?.(path);
  }, [path, onPathChange]);

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
      setRenameTarget(primarySelected);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, primarySelected]);

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

  const goUp = useCallback(() => {
    if (!path) return;
    const p = parentPath(path);
    if (p && p !== path) navigate(p);
  }, [path, navigate]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
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
        onRefresh={() => path && void refresh(path)}
        onNewFolder={() => void handleNewFolder()}
        view={settings.defaultView}
        onViewChange={(v) => update("defaultView", v)}
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
          density={settings.density}
          showExtensions={settings.showExtensions}
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
