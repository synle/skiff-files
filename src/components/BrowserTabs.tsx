// Multi-tab Browser. Renders one Browser per tab, all mounted at once so
// switching tabs is free; the inactive ones use `display: none` and an
// `isActive=false` prop that gates their global event listeners (so a
// drag-drop or '?' keypress only acts on the active tab).
//
// State preserved across tab switches: history, sort, search, primary
// selection, multi-select — everything that lives in Browser's local
// useState. The tab itself only carries a label + the path it last
// opened, used for the tab strip.
import {
  Box,
  IconButton,
  Menu,
  MenuItem,
  Tab,
  Tabs,
  Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import { useEffect, useState, type SyntheticEvent } from "react";
import Browser from "../pages/Browser";
import { useSettings } from "../state/settings";
import { OPEN_IN_TAB_EVENT } from "../App";

interface TabRow {
  id: string;
  label: string;
  initialPath: string;
  /** Most recent path the inner Browser navigated to. Drives the
   *  optional full-path window title. */
  currentPath: string;
}

interface Props {
  /** Used as the seed for new tabs. Empty until fsHomeDir resolves. */
  home: string;
}

/** Pull a friendly label out of an absolute path: the last segment, or
 *  "/" for filesystem roots. Used as the tab title. */
function labelFor(path: string): string {
  if (!path || path === "/") return "/";
  const segs = path.split(/[\\/]/).filter(Boolean);
  return segs[segs.length - 1] ?? path;
}

export default function BrowserTabs({ home }: Props) {
  // Seed tabs from persisted settings. Empty saved list → spawn the
  // default Home tab. Settings is also our write-back target so the
  // tabs survive restart.
  const { settings, update } = useSettings();
  const [tabs, setTabs] = useState<TabRow[]>(() => {
    if (settings.savedTabs.length > 0) {
      return settings.savedTabs.map((t) => ({
        id: t.id,
        label: t.label || "Home",
        initialPath: t.initialPath,
        currentPath: t.initialPath,
      }));
    }
    return [
      {
        id: crypto.randomUUID(),
        label: "Home",
        initialPath: "",
        currentPath: "",
      },
    ];
  });
  /** LRU stack of recently-closed tabs. Not persisted — restoring
   *  closed tabs across restarts would conflict with the saved-tabs
   *  flow. Capped at 10 so a hyperactive user doesn't grow memory
   *  unbounded. We only ever read this through the functional setter
   *  inside `restoreClosedTab`, so the state value is intentionally
   *  unused at render time. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_closedStack, setClosedStack] = useState<TabRow[]>([]);

  const [activeId, setActiveId] = useState<string>(() => {
    const saved = settings.savedActiveTabId;
    if (saved && settings.savedTabs.some((t) => t.id === saved)) return saved;
    return (settings.savedTabs[0]?.id ?? null) ?? "";
  });
  // First-run default-tab case: activeId would be "" because there
  // were no saved tabs and the seed tabs[0].id is fresh. Fix that
  // here rather than complicating the initializer.
  useEffect(() => {
    if (!activeId && tabs[0]) setActiveId(tabs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cmd/Ctrl+click on a folder in the active tab → spawn a new tab
  // seeded at that folder's path. The Browser dispatches the event;
  // we own the tab strip so we react here.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const path = (e as CustomEvent<string>).detail;
      if (path) addTab(path);
    };
    window.addEventListener(OPEN_IN_TAB_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_IN_TAB_EVENT, onOpen);
    // addTab closes over `home`; the listener should pick up the
    // freshest one across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home]);

  // Persist tabs + active id whenever either changes. We trim to
  // TABS_MAX = 20 so a stuck-open run doesn't bloat settings.json.
  useEffect(() => {
    const slice = tabs.slice(0, 20);
    update(
      "savedTabs",
      slice.map((t) => ({
        id: t.id,
        label: t.label,
        initialPath: t.initialPath,
      })),
    );
    update("savedActiveTabId", activeId || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeId]);

  /** Replace the seed tab's initial path once the home dir resolves —
   *  this is what the Browser hands its history `back` stack on first
   *  mount. */
  useEffect(() => {
    if (!home) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.initialPath === "" && t.label === "Home"
          ? { ...t, initialPath: home, currentPath: home }
          : t,
      ),
    );
  }, [home]);

  /** Right-click menu state — anchor element + the tab the menu
   *  acts on. Null = closed. */
  const [tabMenu, setTabMenu] = useState<{
    anchor: HTMLElement;
    tabId: string;
  } | null>(null);

  /** Close every tab whose id !== keepId. Keeps the kept tab as the
   *  active one even if it wasn't the active one before. */
  const closeOtherTabs = (keepId: string) => {
    setTabs((prev) => prev.filter((t) => t.id === keepId));
    setActiveId(keepId);
  };

  /** Reorder the active tab left or right by one position. No-op at
   *  the boundary. Used by Cmd/Ctrl+Shift+Left/Right. */
  const moveActiveTab = (direction: "left" | "right") => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === activeId);
      if (idx < 0) return prev;
      const target = direction === "left" ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  // Keyboard shortcuts. Cmd/Ctrl+T = new tab, Cmd/Ctrl+W = close active,
  // Cmd/Ctrl+1..9 = switch to nth tab, Cmd/Ctrl+Shift+←/→ = reorder
  // active tab. Skipped while the user is in an input so typing 'w'
  // in the path bar doesn't close the tab.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "t" && e.shiftKey) {
        // Cmd/Ctrl+Shift+T → restore the most-recently-closed tab.
        // Browser convention.
        e.preventDefault();
        restoreClosedTab();
        return;
      } else if (k === "t") {
        e.preventDefault();
        addTab();
        return;
      } else if (k === "w") {
        e.preventDefault();
        closeTab(activeId);
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (tabs[idx]) {
          e.preventDefault();
          setActiveId(tabs[idx].id);
        }
      } else if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        moveActiveTab(e.key === "ArrowLeft" ? "left" : "right");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `addTab` and `closeTab` close over `activeId` + `tabs` already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, tabs]);

  const addTab = (initialPath?: string) => {
    const id = crypto.randomUUID();
    const seed = initialPath ?? home ?? "";
    setTabs((prev) => [
      ...prev,
      {
        id,
        label: seed ? labelFor(seed) : "New tab",
        initialPath: seed,
        currentPath: seed,
      },
    ]);
    setActiveId(id);
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      // Keep at least one tab open so the user always has a Browser.
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((t) => t.id === id);
      const closed = prev[idx];
      const next = prev.filter((t) => t.id !== id);
      if (id === activeId && next.length > 0) {
        setActiveId(next[Math.max(0, idx - 1)].id);
      }
      // Push onto the LRU stack so Cmd+Shift+T can restore.
      if (closed && closed.currentPath) {
        setClosedStack((stack) =>
          [closed, ...stack.filter((t) => t.id !== closed.id)].slice(0, 10),
        );
      }
      return next;
    });
  };

  /** Pop the most recently closed tab back to life, focused. */
  const restoreClosedTab = () => {
    setClosedStack((stack) => {
      if (stack.length === 0) return stack;
      const [restored, ...rest] = stack;
      // Fresh id so a subsequent close + restore doesn't collide.
      const id = crypto.randomUUID();
      setTabs((prev) => [
        ...prev,
        {
          id,
          label: restored.label,
          initialPath: restored.currentPath,
          currentPath: restored.currentPath,
        },
      ]);
      setActiveId(id);
      return rest;
    });
  };

  /** Updates a tab's label after the inner Browser navigates. Lifted
   *  here so the tab strip stays in sync with the active path. */
  const updateLabel = (id: string, path: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, label: labelFor(path), currentPath: path } : t,
      ),
    );
  };

  // Sync the OS window title with either "Skiff Files" or the active
  // tab's full path, depending on the `showFullPathInTitle` setting.
  // Wrapped in try/catch + dynamic import so tests + browser-mode dev
  // (no Tauri runtime) silently no-op.
  const activePath =
    tabs.find((t) => t.id === activeId)?.currentPath ?? "";
  useEffect(() => {
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const next =
          settings.showFullPathInTitle && activePath
            ? `${activePath} — Skiff Files`
            : "Skiff Files";
        await win.setTitle(next);
      } catch {
        /* outside Tauri — no-op */
      }
    })();
  }, [activePath, settings.showFullPathInTitle]);

  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Tabs
          value={activeId}
          onChange={(_: SyntheticEvent, id: string) => setActiveId(id)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ flex: 1, minHeight: 36 }}
        >
          {tabs.map((t) => (
            <Tab
              key={t.id}
              value={t.id}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabMenu({ anchor: e.currentTarget, tabId: t.id });
              }}
              sx={{ minHeight: 36, py: 0.5, textTransform: "none" }}
              label={
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                  }}
                >
                  {t.label}
                  {tabs.length > 1 && (
                    <CloseIcon
                      fontSize="inherit"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(t.id);
                      }}
                      aria-label={`Close tab ${t.label}`}
                      role="button"
                      sx={{
                        ml: 0.5,
                        fontSize: 14,
                        opacity: 0.6,
                        "&:hover": { opacity: 1 },
                      }}
                    />
                  )}
                </Box>
              }
            />
          ))}
        </Tabs>
        <Tooltip title="New tab (Cmd/Ctrl+T)">
          <IconButton
            size="small"
            onClick={() => addTab()}
            aria-label="New tab"
            sx={{ mx: 0.5 }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Right-click context menu for tabs. Lets users close many
          tabs at once without clicking each ×. */}
      <Menu
        open={tabMenu !== null}
        anchorEl={tabMenu?.anchor ?? null}
        onClose={() => setTabMenu(null)}
        slotProps={{ list: { dense: true } }}
      >
        <MenuItem
          onClick={() => {
            if (tabMenu) closeTab(tabMenu.tabId);
            setTabMenu(null);
          }}
        >
          Close
        </MenuItem>
        <MenuItem
          disabled={tabs.length <= 1}
          onClick={() => {
            if (tabMenu) closeOtherTabs(tabMenu.tabId);
            setTabMenu(null);
          }}
        >
          Close others
        </MenuItem>
        <MenuItem
          disabled={tabs.length <= 1}
          onClick={() => {
            // Close every tab that's strictly to the right of the
            // right-clicked one — convention from VS Code / Chrome.
            if (!tabMenu) return;
            const idx = tabs.findIndex((t) => t.id === tabMenu.tabId);
            if (idx >= 0) {
              setTabs((prev) => prev.slice(0, idx + 1));
              if (!tabs.slice(0, idx + 1).some((t) => t.id === activeId)) {
                setActiveId(tabMenu.tabId);
              }
            }
            setTabMenu(null);
          }}
        >
          Close tabs to the right
        </MenuItem>
      </Menu>

      {/* All Browsers stay mounted so switching tabs is instant.
          `display: none` on inactive tabs hides them; isActive prop
          gates global event listeners so only the foreground tab
          handles drag-drop / Delete / Cmd+F. */}
      {tabs.map((t) => (
        <Box
          key={t.id}
          sx={{
            flex: 1,
            display: t.id === activeId ? "flex" : "none",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <Browser
            initialPath={t.initialPath}
            isActive={t.id === activeId}
            onPathChange={(p) => updateLabel(t.id, p)}
          />
        </Box>
      ))}
    </Box>
  );
}
