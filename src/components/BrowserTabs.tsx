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
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Tab,
  Tabs,
  Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from "react";
import Browser from "../pages/Browser";
import { useSettings, type SavedTab } from "../state/settings";
import { activeCombo, matchesCombo } from "../util/keybindings";
import { onDone, onError, onProgress, syncList } from "../api/sync";
import { OPEN_IN_TAB_EVENT } from "../App";

interface TabRow {
  id: string;
  label: string;
  initialPath: string;
  /** Most recent path the inner Browser navigated to. Drives the
   *  optional full-path window title. */
  currentPath: string;
  /** Pinned tabs render at the front of the strip (smaller width,
   *  no close × button) and survive Close-others / Close-to-right.
   *  Mirrors browser muscle memory — Chrome / Safari / VS Code all
   *  use this same affordance for "tabs I want to keep around". */
  pinned?: boolean;
  /** User-supplied tab name that overrides the auto-derived
   *  basename. Persisted via SavedTab.customLabel. Empty string
   *  clears the override. */
  customLabel?: string;
}

interface Props {
  /** Used as the seed for new tabs. Empty until fsHomeDir resolves. */
  home: string;
  /** Which pane this BrowserTabs instance backs. Single-pane mode
   *  always uses `"main"`; two-pane mode renders a second instance
   *  with `"right"` so each pane has its own tab list + active id
   *  in Settings. Default `"main"` keeps the single-pane callsite
   *  unchanged. */
  pane?: "main" | "right";
}

/** Pull a friendly label out of an absolute path: the last segment, or
 *  "/" for filesystem roots. Used as the tab title. */
function labelFor(path: string): string {
  if (!path || path === "/") return "/";
  const segs = path.split(/[\\/]/).filter(Boolean);
  return segs[segs.length - 1] ?? path;
}

export default function BrowserTabs({ home, pane = "main" }: Props) {
  // Seed tabs from persisted settings. Empty saved list → spawn the
  // default Home tab. Settings is also our write-back target so the
  // tabs survive restart. Per-pane keys: the right pane uses the
  // `*Right` field family so the two pane tab lists don't collide.
  const { settings, update } = useSettings();
  const savedTabsKey = pane === "right" ? "savedTabsRight" : "savedTabs";
  const savedActiveTabIdKey =
    pane === "right" ? "savedActiveTabIdRight" : "savedActiveTabId";
  const seedTabs =
    pane === "right" ? settings.savedTabsRight : settings.savedTabs;
  const seedActive =
    pane === "right"
      ? settings.savedActiveTabIdRight
      : settings.savedActiveTabId;
  const [tabs, setTabs] = useState<TabRow[]>(() => {
    // Boot-time URL hash override: when the window was spawned via
    // window_open_at(path), the Rust side encoded the path into the
    // URL fragment (#path=<urlEncoded>). Honor it once at first
    // mount — overrides saved tabs so the user lands at the
    // requested path even if they had a saved set. Only the main
    // pane reads the hash; the right pane in two-pane mode keeps
    // its persisted state.
    if (pane === "main" && typeof window !== "undefined") {
      const hash = window.location.hash;
      const m = /[#&]path=([^&]+)/.exec(hash);
      if (m) {
        try {
          const initialPath = decodeURIComponent(m[1]);
          // Strip the fragment so a refresh / reopen doesn't keep
          // re-seeding from the stale hash.
          window.history.replaceState(null, "", window.location.pathname);
          return [
            {
              id: crypto.randomUUID(),
              label: "",
              initialPath,
              currentPath: initialPath,
            },
          ];
        } catch {
          /* malformed hash — fall through to the saved-tabs path */
        }
      }
    }
    if (seedTabs.length > 0) {
      return seedTabs.map((t) => ({
        id: t.id,
        label: t.label || "Home",
        initialPath: t.initialPath,
        currentPath: t.initialPath,
        pinned: t.pinned,
        customLabel: t.customLabel,
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
  // Closed-tab stack is persisted in `Settings.recentlyClosedTabs`
  // (across restarts; capped at 10). Local state isn't needed —
  // `closeTab` writes to settings, `restoreClosedTab` reads + pops.

  const [activeId, setActiveId] = useState<string>(() => {
    if (seedActive && seedTabs.some((t) => t.id === seedActive))
      return seedActive;
    return (seedTabs[0]?.id ?? null) ?? "";
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
    // Command-palette dispatched tab actions. We listen at the
    // tab-strip level since this component owns the tab list — the
    // active Browser doesn't have access to other tabs.
    const onNewTab = () => addTab();
    const onRestoreTab = () => restoreClosedTab();
    // Restore a saved workspace — replaces the current tab strip
    // with the saved set. The palette confirms before dispatching
    // so the destructive replace doesn't fire on a stray click.
    const onRestoreWorkspace = (e: Event) => {
      const ws = (e as CustomEvent<{ tabs: SavedTab[] }>).detail;
      if (!ws || !ws.tabs || ws.tabs.length === 0) return;
      setTabs(
        ws.tabs.map((t) => ({
          id: t.id,
          label: t.label || "Home",
          initialPath: t.initialPath,
          currentPath: t.initialPath,
          pinned: t.pinned,
          customLabel: t.customLabel,
        })),
      );
      setActiveId(ws.tabs[0].id);
    };
    // Additive variant — adds workspace tabs to the current strip
    // without replacing. Each restored tab gets a fresh id so it
    // doesn't collide with an existing tab carrying the workspace's
    // saved id (which would happen if the user is restoring the
    // same workspace twice in a session).
    const onAppendWorkspace = (e: Event) => {
      const ws = (e as CustomEvent<{ tabs: SavedTab[] }>).detail;
      if (!ws || !ws.tabs || ws.tabs.length === 0) return;
      const fresh = ws.tabs.map((t) => ({
        id: crypto.randomUUID(),
        label: t.label || "Home",
        initialPath: t.initialPath,
        currentPath: t.initialPath,
        pinned: t.pinned,
        customLabel: t.customLabel,
      }));
      setTabs((prev) => [...prev, ...fresh]);
      setActiveId(fresh[0].id);
    };
    window.addEventListener("skiff:new-tab", onNewTab);
    window.addEventListener("skiff:restore-closed-tab", onRestoreTab);
    window.addEventListener("skiff:restore-workspace", onRestoreWorkspace);
    window.addEventListener("skiff:append-workspace", onAppendWorkspace);
    return () => {
      window.removeEventListener(OPEN_IN_TAB_EVENT, onOpen);
      window.removeEventListener("skiff:new-tab", onNewTab);
      window.removeEventListener("skiff:restore-closed-tab", onRestoreTab);
      window.removeEventListener("skiff:restore-workspace", onRestoreWorkspace);
      window.removeEventListener("skiff:append-workspace", onAppendWorkspace);
    };
    // addTab / restoreClosedTab close over `home` and the tabs +
    // activeId state; the deps are intentionally loose so the
    // listener picks up the freshest closures on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home]);

  // Persist tabs + active id whenever either changes. We trim to
  // TABS_MAX = 20 so a stuck-open run doesn't bloat settings.json.
  // Per-pane keys ensure the left + right tab strips don't trash
  // each other's state when both are mounted.
  useEffect(() => {
    const slice = tabs.slice(0, 20);
    update(
      savedTabsKey,
      slice.map((t) => ({
        id: t.id,
        label: t.label,
        initialPath: t.initialPath,
        pinned: t.pinned,
        customLabel: t.customLabel,
      })),
    );
    update(savedActiveTabIdKey, activeId || null);
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

  /** Pending drag-hover timer. Set when a file drag enters a non-
   *  active tab, cleared on drag-leave / drop / fire. Prevents
   *  multiple timers stacking when the user lingers on the same
   *  tab. */
  const hoverTimerRef = useRef<number | null>(null);

  /** Close every tab whose id !== keepId. Keeps the kept tab as the
   *  active one even if it wasn't the active one before. Pinned tabs
   *  survive — they're explicit "I want this one around" markers. */
  const closeOtherTabs = (keepId: string) => {
    setTabs((prev) => prev.filter((t) => t.id === keepId || t.pinned));
    setActiveId(keepId);
  };

  /** Toggle pinned state. Pinned tabs migrate to the front of the
   *  strip on pin (so they cluster) and stay where they are on
   *  unpin (the user can drag them back later if they want). */
  const togglePin = (id: string) => {
    setTabs((prev) => {
      const target = prev.find((t) => t.id === id);
      if (!target) return prev;
      const nextPinned = !target.pinned;
      const others = prev.filter((t) => t.id !== id);
      if (nextPinned) {
        // Insert AFTER the last existing pinned tab so multiple
        // pinned tabs cluster in pin order.
        const lastPinIdx = others.reduce(
          (acc, t, i) => (t.pinned ? i : acc),
          -1,
        );
        const insertAt = lastPinIdx + 1;
        return [
          ...others.slice(0, insertAt),
          { ...target, pinned: true },
          ...others.slice(insertAt),
        ];
      }
      // Unpin in place — keep the user's mental model of where
      // the tab was sitting.
      return prev.map((t) => (t.id === id ? { ...t, pinned: false } : t));
    });
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
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) {
        return;
      }
      // Tab actions go through the rebindable framework. Restore-tab
      // is checked first since its combo (Cmd+Shift+T) is a strict
      // superset of the new-tab combo (Cmd+T).
      if (
        matchesCombo(
          e,
          activeCombo(
            "tabs.restoreClosedTab",
            "cmd+shift+t",
            settings.shortcutOverrides,
          ),
        )
      ) {
        e.preventDefault();
        restoreClosedTab();
        return;
      }
      if (
        matchesCombo(
          e,
          activeCombo("tabs.newTab", "cmd+t", settings.shortcutOverrides),
        )
      ) {
        e.preventDefault();
        addTab();
        return;
      }
      if (
        matchesCombo(
          e,
          activeCombo("tabs.closeTab", "cmd+w", settings.shortcutOverrides),
        )
      ) {
        e.preventDefault();
        closeTab(activeId);
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (tabs[idx]) {
          e.preventDefault();
          setActiveId(tabs[idx].id);
        }
      } else if (
        matchesCombo(
          e,
          activeCombo(
            "tabs.moveLeft",
            "cmd+shift+arrowleft",
            settings.shortcutOverrides,
          ),
        )
      ) {
        e.preventDefault();
        moveActiveTab("left");
      } else if (
        matchesCombo(
          e,
          activeCombo(
            "tabs.moveRight",
            "cmd+shift+arrowright",
            settings.shortcutOverrides,
          ),
        )
      ) {
        e.preventDefault();
        moveActiveTab("right");
      } else if (
        matchesCombo(
          e,
          activeCombo(
            "tabs.cyclePrev",
            "cmd+shift+[",
            settings.shortcutOverrides,
          ),
        ) ||
        matchesCombo(
          e,
          activeCombo(
            "tabs.cycleNext",
            "cmd+shift+]",
            settings.shortcutOverrides,
          ),
        )
      ) {
        // Browser muscle memory: Cmd/Ctrl+Shift+[ / ] cycles between
        // tabs. Wraps at the ends. Distinct from plain Cmd+[/] which
        // is back/forward inside a tab's history.
        const idx = tabs.findIndex((t) => t.id === activeId);
        if (idx >= 0 && tabs.length > 1) {
          e.preventDefault();
          const isPrev = matchesCombo(
            e,
            activeCombo(
              "tabs.cyclePrev",
              "cmd+shift+[",
              settings.shortcutOverrides,
            ),
          );
          const delta = isPrev ? -1 : 1;
          const next = (idx + delta + tabs.length) % tabs.length;
          setActiveId(tabs[next].id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `addTab` and `closeTab` close over `activeId` + `tabs` already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, tabs]);

  // Pre-compute active path so addTab below can read it without
  // relying on a forward-declared const.
  const activePathForSeed =
    tabs.find((t) => t.id === activeId)?.currentPath ?? "";

  const addTab = (initialPath?: string) => {
    const id = crypto.randomUUID();
    // Seeding precedence: explicit caller arg > "open at current
    // path" setting > home directory.
    const seed =
      initialPath ??
      (settings.openNewTabAtCurrent && activePathForSeed
        ? activePathForSeed
        : home ?? "");
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
      // Pinned tabs ignore Cmd+W / × clicks — the user has to
      // explicitly Unpin first. Browser muscle memory.
      if (closed?.pinned) return prev;
      const next = prev.filter((t) => t.id !== id);
      if (id === activeId && next.length > 0) {
        setActiveId(next[Math.max(0, idx - 1)].id);
      }
      // Push onto the persisted LRU stack so Cmd+Shift+T can restore
      // even across restarts. Dedup by initialPath so closing + reopening
      // the same path repeatedly doesn't bloat the list.
      if (closed && closed.currentPath) {
        update(
          "recentlyClosedTabs",
          [
            {
              id: closed.id,
              label: closed.label,
              initialPath: closed.currentPath,
            },
            ...settings.recentlyClosedTabs.filter(
              (t) => t.initialPath !== closed.currentPath,
            ),
          ].slice(0, 10),
        );
      }
      return next;
    });
  };

  /** Pop the most recently closed tab back to life, focused. */
  const restoreClosedTab = () => {
    if (settings.recentlyClosedTabs.length === 0) return;
    const [restored, ...rest] = settings.recentlyClosedTabs;
    update("recentlyClosedTabs", rest);
    // Fresh id so a subsequent close + restore doesn't collide.
    const id = crypto.randomUUID();
    setTabs((prev) => [
      ...prev,
      {
        id,
        label: restored.label,
        initialPath: restored.initialPath,
        currentPath: restored.initialPath,
      },
    ]);
    setActiveId(id);
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

  // Active sync job count — reflected in the window title so users
  // see "(2) Skiff Files" in the OS taskbar / dock when transfers
  // are running. Subscribes to the same sync:* events the Sidebar
  // badge + OperationsDrawer use; the cost is one cheap Set per
  // window pane so duplicate listeners are fine.
  const [activeJobs, setActiveJobs] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let unsubP: (() => void) | null = null;
    let unsubD: (() => void) | null = null;
    let unsubE: (() => void) | null = null;
    void (async () => {
      try {
        const list = await syncList();
        const inFlight = new Set<string>();
        for (const j of list) {
          if (
            j.state === "running" ||
            j.state === "paused" ||
            j.state === "planning"
          ) {
            inFlight.add(j.id);
          }
        }
        setActiveJobs(inFlight);
      } catch {
        /* outside Tauri — keep empty */
      }
    })();
    void (async () => {
      unsubP = await onProgress((p) => {
        setActiveJobs((prev) => {
          if (prev.has(p.jobId)) return prev;
          const next = new Set(prev);
          next.add(p.jobId);
          return next;
        });
      });
      unsubD = await onDone((s) => {
        setActiveJobs((prev) => {
          if (!prev.has(s.jobId)) return prev;
          const next = new Set(prev);
          next.delete(s.jobId);
          return next;
        });
      });
      unsubE = await onError((e) => {
        setActiveJobs((prev) => {
          if (!prev.has(e.jobId)) return prev;
          const next = new Set(prev);
          next.delete(e.jobId);
          return next;
        });
      });
    })();
    return () => {
      unsubP?.();
      unsubD?.();
      unsubE?.();
    };
  }, []);

  // Sync the OS window title with either "Skiff Files" or the active
  // tab's full path, depending on the `showFullPathInTitle` setting.
  // Wrapped in try/catch + dynamic import so tests + browser-mode dev
  // (no Tauri runtime) silently no-op. Active job count gets prefixed
  // when there's transfer activity so users notice from the taskbar.
  const activePath =
    tabs.find((t) => t.id === activeId)?.currentPath ?? "";
  useEffect(() => {
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const base =
          settings.showFullPathInTitle && activePath
            ? `${activePath} — Skiff Files`
            : "Skiff Files";
        const next =
          activeJobs.size > 0 ? `(${activeJobs.size}) ${base}` : base;
        await win.setTitle(next);
      } catch {
        /* outside Tauri — no-op */
      }
    })();
  }, [activePath, settings.showFullPathInTitle, activeJobs]);

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
          {tabs.map((t) => {
            // Remote tabs (sftp:// + future smb:// / gdrive:// / s3://)
            // get a primary-tinted underline so users can tell remote
            // from local at a glance without reading the breadcrumb.
            // Local tabs render unchanged.
            const isRemote = (t.currentPath || t.initialPath).startsWith(
              "sftp://",
            );
            return (
            <Tab
              key={t.id}
              value={t.id}
              // Native title tooltip on hover — shows the full path so
              // users can disambiguate two tabs with the same basename
              // (e.g. two `src` folders from different repos) without
              // clicking through to read the breadcrumbs.
              title={t.currentPath || t.initialPath || t.label}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabMenu({ anchor: e.currentTarget, tabId: t.id });
              }}
              // Middle-click closes the tab — browser muscle memory.
              // Skip pinned tabs to mirror the × button's hide behavior.
              onAuxClick={(e: ReactMouseEvent) => {
                if (e.button !== 1 || t.pinned) return;
                e.preventDefault();
                closeTab(t.id);
              }}
              // Drag-to-reorder. Browser muscle memory: Chrome / Firefox
              // / Edge / Safari all support dragging tabs in the strip.
              // Uses a custom MIME so the OS drag-drop into the Browser
              // pane (which expects `application/x-skiff-paths`) doesn't
              // get confused. A separate handler also activates the tab
              // when the user hovers over it during a FILE drag — lets
              // them drop a multi-selection into a different tab's
              // folder without juggling the active-tab switch by hand.
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-skiff-tab", t.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                const types = e.dataTransfer.types;
                if (types.includes("application/x-skiff-tab")) {
                  // Tab-on-tab drag: prepare a reorder drop.
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  return;
                }
                if (types.includes("application/x-skiff-paths")) {
                  // File drag hovering a non-active tab: arm a hover
                  // timer that switches to it after 700ms. Browser
                  // muscle memory ("hover-switch"). Already-active
                  // tabs no-op the timer so we don't repeatedly
                  // re-set the same active id.
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  if (t.id !== activeId && hoverTimerRef.current === null) {
                    hoverTimerRef.current = window.setTimeout(() => {
                      setActiveId(t.id);
                      hoverTimerRef.current = null;
                    }, 700);
                  }
                }
              }}
              onDragLeave={() => {
                if (hoverTimerRef.current !== null) {
                  window.clearTimeout(hoverTimerRef.current);
                  hoverTimerRef.current = null;
                }
              }}
              onDrop={(e) => {
                if (hoverTimerRef.current !== null) {
                  window.clearTimeout(hoverTimerRef.current);
                  hoverTimerRef.current = null;
                }
                const sourceId = e.dataTransfer.getData(
                  "application/x-skiff-tab",
                );
                if (!sourceId || sourceId === t.id) return;
                e.preventDefault();
                setTabs((prev) => {
                  const sourceIdx = prev.findIndex((x) => x.id === sourceId);
                  const targetIdx = prev.findIndex((x) => x.id === t.id);
                  if (sourceIdx < 0 || targetIdx < 0) return prev;
                  const next = [...prev];
                  const [moved] = next.splice(sourceIdx, 1);
                  // Insert AT the target index — when dragging to the
                  // right, the splice has already shifted everything
                  // down by 1, so this lands the source where the
                  // target was.
                  next.splice(targetIdx, 0, moved);
                  return next;
                });
              }}
              sx={{
                minHeight: 36,
                py: 0.5,
                textTransform: "none",
                // Pinned tabs render slimmer + icon-only — same idea
                // as Chrome's "fav-icon-only" pinned tabs. Saves
                // horizontal real estate when many tabs are pinned.
                ...(t.pinned ? { minWidth: 56, px: 1 } : {}),
                // Remote tabs get a left border in primary tint so
                // they read as visually distinct from local tabs at
                // a glance. Width is small (3px) so it doesn't move
                // the label.
                ...(isRemote
                  ? {
                      borderLeft: 3,
                      borderColor: "primary.main",
                      pl: 1.5,
                    }
                  : {}),
              }}
              label={
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                  }}
                >
                  {t.pinned && (
                    <PushPinIcon
                      sx={{
                        fontSize: 12,
                        color: "primary.main",
                        transform: "rotate(45deg)",
                      }}
                    />
                  )}
                  {/* Hide the label on pinned tabs to keep them slim,
                   *  similar to Chrome. The full path stays accessible
                   *  via the title tooltip + right-click menu. */}
                  {!t.pinned && (t.customLabel || t.label)}
                  {tabs.length > 1 && !t.pinned && (
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
            );
          })}
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
        {tabMenu &&
          (() => {
            const target = tabs.find((t) => t.id === tabMenu.tabId);
            const pinned = !!target?.pinned;
            return (
              <MenuItem
                onClick={() => {
                  togglePin(tabMenu.tabId);
                  setTabMenu(null);
                }}
              >
                {pinned ? (
                  <>
                    <PushPinOutlinedIcon
                      fontSize="small"
                      sx={{ mr: 1 }}
                    />
                    Unpin
                  </>
                ) : (
                  <>
                    <PushPinIcon fontSize="small" sx={{ mr: 1 }} />
                    Pin
                  </>
                )}
              </MenuItem>
            );
          })()}
        <MenuItem
          onClick={() => {
            const target = tabMenu
              ? tabs.find((t) => t.id === tabMenu.tabId)
              : null;
            if (!target || !tabMenu) return;
            // Native prompt is suppressed in the Tauri webview; we
            // use a tiny inline approach here — push a custom label
            // via window.prompt only when running in dev / browser
            // mode (where prompt works), otherwise fall back to a
            // basename-derived suggestion. Keeps the implementation
            // narrow without lifting yet another modal into App.
            const current = target.customLabel ?? "";
            const next = window.prompt(
              "Tab name (leave empty to reset):",
              current,
            );
            if (next === null) return; // user cancelled
            const trimmed = next.trim();
            setTabs((prev) =>
              prev.map((t) =>
                t.id === tabMenu.tabId
                  ? { ...t, customLabel: trimmed || undefined }
                  : t,
              ),
            );
            setTabMenu(null);
          }}
        >
          Rename tab…
        </MenuItem>
        <MenuItem
          disabled={
            tabMenu
              ? !!tabs.find((t) => t.id === tabMenu.tabId)?.pinned
              : false
          }
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
            // Close every NON-PINNED tab strictly to the right of the
            // right-clicked one — convention from VS Code / Chrome.
            // Pinned tabs survive regardless of position.
            if (!tabMenu) return;
            const idx = tabs.findIndex((t) => t.id === tabMenu.tabId);
            if (idx >= 0) {
              setTabs((prev) =>
                prev.filter((t, i) => i <= idx || t.pinned),
              );
              const surviving = tabs.filter(
                (t, i) => i <= idx || t.pinned,
              );
              if (!surviving.some((t) => t.id === activeId)) {
                setActiveId(tabMenu.tabId);
              }
            }
            setTabMenu(null);
          }}
        >
          Close tabs to the right
        </MenuItem>
        {tabs.length > 1 && (
          <MenuItem
            onClick={() => {
              setTabMenu(null);
              const allPinned = tabs.every((t) => t.pinned);
              setTabs((prev) =>
                prev.map((t) => ({ ...t, pinned: !allPinned })),
              );
            }}
          >
            {tabs.every((t) => t.pinned) ? "Unpin all" : "Pin all"}
          </MenuItem>
        )}
        <Divider />
        <MenuItem
          onClick={() => {
            setTabMenu(null);
            const label = window.prompt(
              `Save ${tabs.length} tab${tabs.length === 1 ? "" : "s"} as workspace:`,
              "",
            );
            if (!label || !label.trim()) return;
            const snapshot = tabs.slice(0, 20).map((t) => ({
              id: t.id,
              label: t.label,
              initialPath: t.currentPath || t.initialPath,
              pinned: t.pinned,
              customLabel: t.customLabel,
            }));
            const next = [
              ...settings.tabWorkspaces,
              {
                id: crypto.randomUUID(),
                label: label.trim(),
                savedAt: Date.now(),
                tabs: snapshot,
              },
            ];
            // Cap at 20; drop oldest by insertion order.
            if (next.length > 20) next.splice(0, next.length - 20);
            update("tabWorkspaces", next);
          }}
        >
          Save all tabs as workspace…
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
