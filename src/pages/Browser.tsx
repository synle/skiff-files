// The main file-browsing view. Owns navigation history, current entries, and
// the active sort. Delegates rendering to PathBar / Toolbar / FileList /
// StatusBar, and the sidebar lives one level up in App so it persists across
// route changes.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Box } from "@mui/material";
import PathBar from "../components/PathBar";
import Toolbar from "../components/Toolbar";
import FileList, { type SortDir, type SortKey } from "../components/FileList";
import StatusBar from "../components/StatusBar";
import PreviewPane from "../components/PreviewPane";
import { fsHomeDir, fsMkdir, type Entry } from "../api/fs";
import { listDir as clientListDir } from "../api/client";
import { parentPath } from "../util/format";
import { isRemote } from "../util/location";
import { useSettings } from "../state/settings";
import { isImage } from "../util/mime";
import { NAVIGATE_EVENT } from "../App";

interface Props {
  /** Optional initial path. Defaults to home dir on first load. */
  initialPath?: string;
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

export default function Browser({ initialPath }: Props) {
  const { settings, update } = useSettings();
  const [home, setHome] = useState<string>("");
  const [history, setHistory] = useState<History>({ back: [], forward: [] });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  /** Last-clicked entry — drives the preview pane. */
  const [primarySelected, setPrimarySelected] = useState<Entry | null>(null);
  /** Per-session toggle of the preview pane, seeded from the persisted
   *  policy. The toolbar eye icon flips this; closing-then-reopening
   *  doesn't change Settings. */
  const [previewOpen, setPreviewOpen] = useState<boolean>(
    () => settings.previewMode !== "off",
  );

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

  // Listen for sidebar-driven navigations. Decoupling via a window event keeps
  // the Sidebar from needing a reference to setHistory.
  useEffect(() => {
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
  }, []);

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
    // mkdir on remote backends lands in a follow-up — Phase 2a only ships
    // the read-side of SFTP. Skip silently rather than throwing a confusing
    // "command not found" error at the user.
    if (isRemote(path)) {
      setError("Remote mkdir is not supported yet.");
      return;
    }
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
      await fsMkdir(target);
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
      />
      <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
        <FileList
          entries={entries}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={handleSort}
          onOpenDir={(e) => navigate(e.path)}
          onPrimarySelect={setPrimarySelected}
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
        selectedEntries={0}
        selectedSize={totals.totalSize}
        errorMessage={error}
      />
    </Box>
  );
}
