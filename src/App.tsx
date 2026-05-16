// Root layout — sidebar on the left, route content on the right. Both are
// inside the HashRouter (set up in main.tsx), so the sidebar can use the
// navigation hooks directly.
import { Box } from "@mui/material";
import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import ShortcutsModal from "./components/ShortcutsModal";
import ConflictModal from "./components/ConflictModal";
import BrowserTabs from "./components/BrowserTabs";
import QuickJump from "./components/QuickJump";
import CommandPalette, { type CommandAction } from "./components/CommandPalette";
import OperationsDrawer from "./components/OperationsDrawer";
import SettingsPage from "./pages/SettingsPage";
import ConnectionsPage from "./pages/ConnectionsPage";
import TransfersPage from "./pages/TransfersPage";
import {
  fsHomeDir,
  fsStat,
  windowOpenNew,
  windowSetAlwaysOnTop,
} from "./api/fs";
import { listen } from "@tauri-apps/api/event";
import { loadSettingsFromDisk } from "./state/settings";
import { useSettings } from "./state/settings";
import { pruneStaleBookmarks, pruneStalePaths } from "./util/pruneStale";
import { activeCombo, matchesCombo } from "./util/keybindings";

/** A custom DOM event the Sidebar emits to ask the Browser to navigate. We
 *  use a window event rather than lifting state because it stays
 *  zero-coupling — the Sidebar doesn't need to know whether the Browser is
 *  currently mounted. */
export const NAVIGATE_EVENT = "skiff:navigate";

/** Custom DOM event the Browser emits when the user Cmd/Ctrl+clicks a
 *  folder. BrowserTabs listens and spawns a new tab seeded at the
 *  folder's path. Same window-event pattern as NAVIGATE_EVENT so the
 *  Browser doesn't have to know about its tab strip parent. */
export const OPEN_IN_TAB_EVENT = "skiff:open-in-new-tab";

/** Top-level page identifier. The app used to use react-router for
 *  this but the HashRouter + StrictMode + nested Routes combo had a
 *  rendering bug we couldn't pin down — the URL would flip back to /
 *  in a re-render loop after every navigate(). State-based switching
 *  is more direct and we don't need URL deep links inside a Tauri
 *  desktop app anyway. */
export type Page = "browser" | "connections" | "transfers" | "settings";

/**
 * Resolves the home directory once at the layout level so navigating between
 * Settings and Browser doesn't re-issue the Rust call on every route change.
 */
export default function App() {
  const [home, setHome] = useState("");
  const [quickJumpOpen, setQuickJumpOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  /** Active page. Replaces react-router's Routes-based switching. */
  const [page, setPage] = useState<Page>("browser");
  // Which pane the next sidebar / quick-jump / palette navigation
  // targets in two-pane mode. Mouse focus inside a pane (BrowserTabs
  // fires onPaneFocus on mousedown) updates this; the dispatched
  // NAVIGATE_EVENT carries the active pane on its detail so only the
  // matching Browser instance honors it. Single-pane mode treats
  // every dispatch as "main" — the right pane simply isn't mounted
  // and its listener never runs.
  const [activePane, setActivePane] = useState<"main" | "right">("main");
  const { settings, setSettings, update } = useSettings();

  // Cmd/Ctrl+K → toggle the quick-jump palette. Cmd/Ctrl+B → toggle
  // the sidebar (persisted in Settings so it survives restart).
  // Both skip when an input is focused so they don't hijack typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
      // Modifier guard intentionally near-but-not-at-the-top: any
      // future rebindable action whose default is modifier-less
      // would need to live above this line.
      if (!(e.metaKey || e.ctrlKey) && !e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (
        matchesCombo(
          e,
          activeCombo("app.newWindow", "cmd+n", settings.shortcutOverrides),
        )
      ) {
        // Multi-window support: each spawned window is a fresh React
        // tree pointing at the same settings.json on disk; settings
        // sync across windows via the `settings:changed` Tauri event.
        e.preventDefault();
        void windowOpenNew().catch(() => {
          /* running outside Tauri / browser dev — silent fallback */
        });
        return;
      }
      if (
        matchesCombo(
          e,
          activeCombo("app.quickJump", "cmd+k", settings.shortcutOverrides),
        )
      ) {
        e.preventDefault();
        setQuickJumpOpen((o) => !o);
      } else if (
        matchesCombo(
          e,
          activeCombo(
            "app.commandPalette",
            "cmd+shift+p",
            settings.shortcutOverrides,
          ),
        )
      ) {
        e.preventDefault();
        setCommandPaletteOpen((o) => !o);
      } else if (k === "b") {
        // Cmd+B is the legacy sidebar binding (kept for VS Code muscle
        // memory). The modern path goes through app.toggleSidebar
        // below — Cmd+\ is the user-preferred default.
        e.preventDefault();
        update("sidebarVisible", !settings.sidebarVisible);
      } else if (
        matchesCombo(
          e,
          activeCombo("app.openSettings", "cmd+,", settings.shortcutOverrides),
        )
      ) {
        // Mac convention: Cmd+, opens app preferences. We honor it
        // on Linux/Windows too via Ctrl+, since users coming from
        // VS Code expect this binding everywhere.
        e.preventDefault();
        setPage("settings");
      } else if (
        matchesCombo(
          e,
          activeCombo("app.toggleSplit", "cmd+shift+\\", settings.shortcutOverrides),
        )
      ) {
        // Cmd/Ctrl+Shift+\ toggles two-pane (split) mode. FileZilla
        // muscle memory: the second pane is for cross-protocol
        // drag-drop transfers from local ↔ remote without juggling
        // tabs.
        e.preventDefault();
        update("twoPaneMode", !settings.twoPaneMode);
      } else if (
        matchesCombo(
          e,
          activeCombo("app.toggleSidebar", "cmd+\\", settings.shortcutOverrides),
        )
      ) {
        // Cmd/Ctrl+\ toggles the sidebar. Cmd+B also works (kept for
        // VS Code muscle memory) — \\ is the user-preferred binding.
        e.preventDefault();
        update("sidebarVisible", !settings.sidebarVisible);
      } else if (
        matchesCombo(
          e,
          activeCombo("app.fontSizeUp", "cmd+=", settings.shortcutOverrides),
        ) ||
        // Accept "+" too: on US keyboards `=` and `+` share the
        // physical key; the user might press Shift+= and get `+`.
        // We can't represent that as a single combo string so the
        // additional check is a small pragmatic alias.
        (e.key === "+" && (e.metaKey || e.ctrlKey))
      ) {
        e.preventDefault();
        const next =
          settings.fontSize === "small"
            ? "medium"
            : settings.fontSize === "medium"
              ? "large"
              : "large";
        update("fontSize", next);
      } else if (
        matchesCombo(
          e,
          activeCombo("app.fontSizeDown", "cmd+-", settings.shortcutOverrides),
        )
      ) {
        e.preventDefault();
        const next =
          settings.fontSize === "large"
            ? "medium"
            : settings.fontSize === "medium"
              ? "small"
              : "small";
        update("fontSize", next);
      } else if (
        matchesCombo(
          e,
          activeCombo("app.fontSizeReset", "cmd+0", settings.shortcutOverrides),
        )
      ) {
        // Browser muscle memory: Cmd/Ctrl+0 resets zoom. Here it
        // resets font size to medium.
        e.preventDefault();
        update("fontSize", "medium");
      } else if (
        matchesCombo(
          e,
          activeCombo("app.toggleHidden", "cmd+shift+.", settings.shortcutOverrides),
        )
      ) {
        // Finder muscle memory: Cmd+Shift+. toggles dotfile visibility.
        // The `keyEventToCombo` helper normalizes via `code` so the
        // Shift+. → ">" quirk on US layouts matches the binding.
        e.preventDefault();
        update("showHidden", !settings.showHidden);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    settings.sidebarVisible,
    settings.twoPaneMode,
    settings.fontSize,
    settings.showHidden,
    settings.shortcutOverrides,
    update,
  ]);

  useEffect(() => {
    let cancelled = false;
    fsHomeDir()
      .then((h) => !cancelled && setHome(h))
      .catch(() => {
        /* running outside Tauri (tests / browser dev) — leave empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply the always-on-top setting on every change. Calling the
  // Tauri command is cheap (~µs); the noisy guard would just be the
  // string-equality compare we'd write here, so we call every time.
  useEffect(() => {
    void windowSetAlwaysOnTop(settings.alwaysOnTop).catch(() => {
      /* silent fallback in tests / browser dev */
    });
  }, [settings.alwaysOnTop]);

  // Multi-window settings sync. The Rust `settings_save` command
  // emits a `settings:changed` event after every write; every window
  // listens for it and re-loads from disk so views stay coherent
  // (e.g. flipping the theme in window A applies to window B).
  //
  // CRITICAL: deep-equal compare before swapping state. Tauri
  // broadcasts the event to every window INCLUDING the source. The
  // source window's listener fires, reloads disk, and would call
  // setSettings with a fresh object reference even though the values
  // are identical. React sees the new ref → persist effect re-fires
  // → save → emit → reload → loop. Manifested in 0.2.135 as the view
  // mode flipping endlessly between gallery and column.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    const reload = async () => {
      const fromDisk = await loadSettingsFromDisk();
      if (cancelled || !fromDisk) return;
      setSettings((prev) => {
        // JSON-roundtrip equality is safe — Settings is a plain
        // serializable object. Skipping when equal keeps the persist
        // effect from re-arming on a no-op reload.
        if (JSON.stringify(prev) === JSON.stringify(fromDisk)) return prev;
        return fromDisk;
      });
    };
    void listen<unknown>("settings:changed", () => void reload())
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {
        /* tests / browser dev — no Tauri event bus */
      });
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener("focus", onFocus);
    };
  }, [setSettings]);

  // One-shot prune pass on mount: drop recent paths + bookmarks
  // whose target no longer exists. Local paths only — remote
  // entries are kept unconditionally since stat'ing them needs an
  // active SFTP session. The pure helpers return reference-stable
  // arrays when nothing was pruned, so this no-ops for clean
  // settings.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [prunedRecent, prunedBookmarks] = await Promise.all([
        pruneStalePaths(settings.recentPaths, fsStat),
        pruneStaleBookmarks(settings.bookmarks, fsStat),
      ]);
      if (cancelled) return;
      if (prunedRecent !== settings.recentPaths) {
        update("recentPaths", prunedRecent);
      }
      if (prunedBookmarks !== settings.bookmarks) {
        update("bookmarks", prunedBookmarks);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount only — re-running on every settings change
    // would create a feedback loop with the update calls above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "row",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
      }}
    >
      {settings.sidebarVisible && (
        <Sidebar
          home={home}
          page={page}
          onSwitchPage={setPage}
          onNavigate={(p) => {
            // Switch to the Browser page first, then dispatch the
            // path. Order matters: if we're on Settings the Browser
            // isn't mounted yet, so dispatching first would no-op.
            setPage("browser");
            // Defer the dispatch with setTimeout(0) instead of
            // queueMicrotask. Microtasks drain BEFORE React's commit
            // + effects phase in some scheduling orders, so on the
            // very first click from Settings the Browser's
            // NAVIGATE_EVENT listener hasn't been registered yet
            // (the Browser was unmounted while Settings was active).
            // The event then fires into the void, the user lands on
            // the Browser's previous path (home), and they have to
            // click the host a second time to navigate.
            //
            // setTimeout(0) queues a macrotask which runs strictly
            // after React's reconciliation + useEffect registration,
            // so the listener is guaranteed to be live when the
            // dispatch happens. One render-tick of latency is
            // imperceptible compared to the two-click bug it kills.
            //
            // detail carries `pane` so two-pane mode routes the
            // navigation to the focused pane only. Single-pane mode
            // always targets "main".
            setTimeout(
              () =>
                window.dispatchEvent(
                  new CustomEvent(NAVIGATE_EVENT, {
                    detail: { path: p, pane: activePane },
                  }),
                ),
              0,
            );
          }}
        />
      )}
      <Box
        component="main"
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        {/* State-based page switch. Replaces react-router's Routes
            because that combo (HashRouter + StrictMode + nested
            Routes with conditional element) was getting stuck in
            a render loop that flipped the URL back to / on every
            navigate(). Direct state is more reliable here — Tauri
            doesn't expose URL deep linking anyway. */}
        {page === "browser" ? (
          settings.twoPaneMode ? (
            <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
              {/* TODO(split-pane-resize): the divider between the
                  two panes is currently a fixed 50/50 split (each
                  Box flex: 1). Should let users drag the divider to
                  re-balance, with the ratio persisted to settings.
                  Same pass should add resizable columns to FileList
                  in list-view mode (Name / Size / Modified / Kind).
                  Both are pure-UX work, no backend changes. Out of
                  scope for the SMB-dialog branch — split as a
                  follow-up so this PR stays focused. */}
              {/* Each pane in two-pane mode owns its own
                  focus-state indicator. Visual treatment:
                    - Focused pane gets a 3px primary-tinted ring on
                      ALL FOUR sides (inset boxShadow), plus a very
                      subtle background tint so it's unmistakable
                      even at a glance from across the room.
                    - Unfocused pane shows no ring + the default
                      background so the contrast does the work.
                  mousedown (not click) sets the active pane so the
                  intent is registered before any inner click handler
                  fires — important because the inner Browser may
                  consume the click event (e.g. selecting a row). */}
              <Box
                sx={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                  borderRight: 1,
                  borderColor: "divider",
                  position: "relative",
                  boxShadow: (t) =>
                    activePane === "main"
                      ? `inset 0 0 0 3px ${t.palette.primary.main}`
                      : "none",
                  bgcolor: (t) =>
                    activePane === "main"
                      ? t.palette.mode === "dark"
                        ? "rgba(144, 202, 249, 0.04)"
                        : "rgba(25, 118, 210, 0.03)"
                      : "transparent",
                  transition:
                    "box-shadow 120ms ease-out, background-color 120ms ease-out",
                }}
                onMouseDown={() => setActivePane("main")}
              >
                <BrowserTabs
                  home={home}
                  pane="main"
                  isFocusedPane={activePane === "main"}
                />
              </Box>
              <Box
                sx={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                  position: "relative",
                  boxShadow: (t) =>
                    activePane === "right"
                      ? `inset 0 0 0 3px ${t.palette.primary.main}`
                      : "none",
                  bgcolor: (t) =>
                    activePane === "right"
                      ? t.palette.mode === "dark"
                        ? "rgba(144, 202, 249, 0.04)"
                        : "rgba(25, 118, 210, 0.03)"
                      : "transparent",
                  transition:
                    "box-shadow 120ms ease-out, background-color 120ms ease-out",
                }}
                onMouseDown={() => setActivePane("right")}
              >
                <BrowserTabs
                  home={home}
                  pane="right"
                  isFocusedPane={activePane === "right"}
                />
              </Box>
            </Box>
          ) : (
            // Single-pane mode: the lone instance is always
            // "focused" — there's no other pane to compete with.
            <BrowserTabs home={home} isFocusedPane={true} />
          )
        ) : page === "connections" ? (
          <ConnectionsPage />
        ) : page === "transfers" ? (
          <TransfersPage />
        ) : (
          <SettingsPage />
        )}
      </Box>
      {/* Mounted once at the app root so any route can pop the cheatsheet
          via `?` without re-listening per page. */}
      <ShortcutsModal />
      {/* Sync-conflict prompt. Lives at the root because conflict events
          can fire while the user is on Settings / Connections; the modal
          must surface regardless of route. */}
      <ConflictModal />
      {/* Cmd+K palette. Routes selections through the same nav event
          + route switch the sidebar uses so the Browser stays in sync. */}
      <QuickJump
        open={quickJumpOpen}
        onClose={() => setQuickJumpOpen(false)}
        home={home}
        onJump={(p) => {
          setPage("browser");
          queueMicrotask(() =>
            window.dispatchEvent(
              new CustomEvent(NAVIGATE_EVENT, {
                detail: { path: p, pane: activePane },
              }),
            ),
          );
        }}
      />
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        actions={buildCommandActions({
          page,
          setPage,
          settings,
          update,
          activePane,
        })}
      />
      {/* Floating bottom-right drawer that surfaces every in-flight
          sync from any page, so closing the Transfers tab doesn't
          hide an active operation. */}
      <OperationsDrawer />
    </Box>
  );
}

/** Build the catalog of actions surfaced by Cmd/Ctrl+Shift+P. Each
 *  action either flips a setting, switches the page, or fires a
 *  one-shot UI event. We rebuild on every render so the hint strings
 *  reflect live state ("Theme: dark" vs "Theme: light"). */
function buildCommandActions(deps: {
  page: Page;
  setPage: (p: Page) => void;
  settings: ReturnType<typeof useSettings>["settings"];
  update: ReturnType<typeof useSettings>["update"];
  /** Which pane the next navigation should target. Two-pane mode
   *  routes via NAVIGATE_EVENT detail so only the focused pane
   *  responds; single-pane treats every dispatch as "main". */
  activePane: "main" | "right";
}): CommandAction[] {
  const { page, setPage, settings, update, activePane } = deps;
  /** Common helper: switch to Browser then dispatch a navigate event so
   *  the Browser actually goes there. Used by every "Go to <path>"
   *  action surfaced from bookmarks / recent. */
  const goTo = (target: string) => {
    setPage("browser");
    queueMicrotask(() =>
      window.dispatchEvent(
        new CustomEvent(NAVIGATE_EVENT, {
          detail: { path: target, pane: activePane },
        }),
      ),
    );
  };
  // Bookmark + recent path actions. Each becomes a row in the
  // palette so users can fuzzy-search across their full path graph.
  const bookmarkActions: CommandAction[] = settings.bookmarks.map((b) => ({
    id: `bookmark.${b.id}`,
    label: `Go to ${b.label}`,
    hint: b.path,
    keywords: `bookmark ${b.path}`,
    run: () => goTo(b.path),
  }));
  const recentActions: CommandAction[] = settings.recentPaths
    // Drop the current path (Browser auto-pushes it) since "go to
    // current" is a no-op that pollutes the suggestions list.
    .slice(0, 10)
    .map((p) => ({
      id: `recent.${p}`,
      label: `Recent: ${p}`,
      hint: undefined,
      keywords: `recent ${p}`,
      run: () => goTo(p),
    }));
  return [
    // Pages
    {
      id: "page.browser",
      label: "Go to Browser",
      hint: page === "browser" ? "Current page" : undefined,
      keywords: "files folder navigate",
      run: () => setPage("browser"),
    },
    {
      id: "page.connections",
      label: "Go to Connections",
      keywords: "sftp ssh remote",
      run: () => setPage("connections"),
    },
    {
      id: "page.transfers",
      label: "Go to Transfers",
      keywords: "sync skiffsync jobs progress",
      run: () => setPage("transfers"),
    },
    {
      id: "page.settings",
      label: "Open Settings",
      keywords: "preferences config",
      run: () => setPage("settings"),
    },
    // Theme
    {
      id: "theme.light",
      label: "Theme: Light",
      hint: settings.themeMode === "light" ? "Current" : undefined,
      keywords: "appearance",
      run: () => update("themeMode", "light"),
    },
    {
      id: "theme.dark",
      label: "Theme: Dark",
      hint: settings.themeMode === "dark" ? "Current" : undefined,
      keywords: "appearance",
      run: () => update("themeMode", "dark"),
    },
    {
      id: "theme.system",
      label: "Theme: System",
      hint: settings.themeMode === "system" ? "Current" : undefined,
      keywords: "appearance auto",
      run: () => update("themeMode", "system"),
    },
    // Font size
    {
      id: "font.small",
      label: "Font size: Small",
      hint: settings.fontSize === "small" ? "Current" : undefined,
      run: () => update("fontSize", "small"),
    },
    {
      id: "font.medium",
      label: "Font size: Medium (reset)",
      hint: settings.fontSize === "medium" ? "Current" : "Cmd+0",
      run: () => update("fontSize", "medium"),
    },
    {
      id: "font.large",
      label: "Font size: Large",
      hint: settings.fontSize === "large" ? "Current" : undefined,
      run: () => update("fontSize", "large"),
    },
    // Visibility toggles
    {
      id: "toggle.hidden",
      label: settings.showHidden
        ? "Hide hidden files (dotfiles)"
        : "Show hidden files (dotfiles)",
      hint: "Cmd+Shift+.",
      run: () => update("showHidden", !settings.showHidden),
    },
    {
      id: "toggle.sidebar",
      label: settings.sidebarVisible ? "Hide sidebar" : "Show sidebar",
      hint: "Cmd+\\",
      run: () => update("sidebarVisible", !settings.sidebarVisible),
    },
    {
      id: "toggle.statusbar",
      label: settings.showStatusBar ? "Hide status bar" : "Show status bar",
      run: () => update("showStatusBar", !settings.showStatusBar),
    },
    {
      id: "toggle.twoPane",
      label: settings.twoPaneMode ? "Disable two-pane mode" : "Enable two-pane mode",
      hint: "Cmd+Shift+\\",
      run: () => update("twoPaneMode", !settings.twoPaneMode),
    },
    {
      id: "toggle.alwaysOnTop",
      label: settings.alwaysOnTop
        ? "Disable always-on-top window"
        : "Enable always-on-top window",
      keywords: "pin pinned floating sticky",
      run: () => update("alwaysOnTop", !settings.alwaysOnTop),
    },
    // Tag actions — apply to current selection. Browser listens for
    // skiff:tag-selection and routes the color through fileTags.
    ...(["red", "orange", "yellow", "green", "blue", "purple", "gray"] as const).map(
      (c) => ({
        id: `tag.${c}`,
        label: `Tag selection: ${c.charAt(0).toUpperCase() + c.slice(1)}`,
        keywords: `color tag finder ${c}`,
        run: () =>
          window.dispatchEvent(
            new CustomEvent("skiff:tag-selection", { detail: c }),
          ),
      }),
    ),
    {
      id: "tag.clear",
      label: "Tag selection: Clear",
      keywords: "color tag finder remove",
      run: () =>
        window.dispatchEvent(
          new CustomEvent("skiff:tag-selection", { detail: null }),
        ),
    },
    // Tab workspaces — restore replaces the current tab strip.
    // Confirm before firing since it's destructive.
    ...settings.tabWorkspaces.flatMap((ws) => [
      {
        id: `workspace.replace.${ws.id}`,
        label: `Restore workspace: ${ws.label}`,
        hint: `${ws.tabs.length} tab${ws.tabs.length === 1 ? "" : "s"} · replaces current`,
        keywords: `workspace tabs restore replace ${ws.label}`,
        run: () => {
          const ok = window.confirm(
            `Replace your current tabs with "${ws.label}" (${ws.tabs.length} tab${ws.tabs.length === 1 ? "" : "s"})?`,
          );
          if (!ok) return;
          setPage("browser");
          queueMicrotask(() =>
            window.dispatchEvent(
              new CustomEvent("skiff:restore-workspace", { detail: ws }),
            ),
          );
        },
      },
      {
        id: `workspace.append.${ws.id}`,
        label: `Append workspace: ${ws.label}`,
        hint: `${ws.tabs.length} tab${ws.tabs.length === 1 ? "" : "s"} · adds to current`,
        keywords: `workspace tabs append additive ${ws.label}`,
        run: () => {
          setPage("browser");
          queueMicrotask(() =>
            window.dispatchEvent(
              new CustomEvent("skiff:append-workspace", { detail: ws }),
            ),
          );
        },
      },
    ]),
    // Recent searches (auto-tracked) — top 5 from searchHistory.
    // Dispatches the same skiff:run-saved-search event the named
    // saved-searches use, with default flags (no regex, case
    // insensitive, recursive off).
    ...settings.searchHistory.slice(0, 5).map((q) => ({
      id: `recentsearch.${q}`,
      label: `Search: ${q}`,
      hint: "Recent",
      keywords: `recent search find ${q}`,
      run: () => {
        setPage("browser");
        queueMicrotask(() =>
          window.dispatchEvent(
            new CustomEvent("skiff:run-saved-search", {
              detail: {
                query: q,
                regex: false,
                caseSensitive: false,
                recursive: false,
              },
            }),
          ),
        );
      },
    })),
    // Saved sync-job templates — two palette actions per job: a
    // real run (confirmed) and a dry-run (no confirm needed since
    // dry-run writes nothing).
    ...settings.savedSyncJobs.flatMap((j) => [
      {
        id: `syncjob.${j.id}`,
        label: `Run sync job: ${j.label}`,
        hint: `${j.src} → ${j.dest} · ${j.conflictPolicy}`,
        keywords: `sync skiffsync transfer copy ${j.label}`,
        run: () => {
          const ok = window.confirm(
            `Run sync job "${j.label}"?\n\n${j.src} → ${j.dest}`,
          );
          if (!ok) return;
          setPage("transfers");
          queueMicrotask(() =>
            window.dispatchEvent(
              new CustomEvent("skiff:run-sync-job", { detail: j.id }),
            ),
          );
        },
      },
      {
        id: `syncjob.dryrun.${j.id}`,
        label: `Dry-run sync job: ${j.label}`,
        hint: `${j.src} → ${j.dest} · writes nothing`,
        keywords: `sync skiffsync dry-run preview ${j.label}`,
        run: () => {
          setPage("transfers");
          queueMicrotask(() =>
            window.dispatchEvent(
              new CustomEvent("skiff:run-sync-job", {
                detail: { id: j.id, dryRun: true },
              }),
            ),
          );
        },
      },
    ]),
    // Saved selection groups — palette restoration. Browser listens
    // for the event, picks paths that exist in the current folder.
    ...settings.savedSelections.map((s) => ({
      id: `selection.${s.id}`,
      label: `Restore selection: ${s.label}`,
      hint: `${s.paths.length} item${s.paths.length === 1 ? "" : "s"}`,
      keywords: `selection group restore ${s.label}`,
      run: () => {
        setPage("browser");
        queueMicrotask(() =>
          window.dispatchEvent(
            new CustomEvent("skiff:restore-selection", { detail: s.paths }),
          ),
        );
      },
    })),
    // View modes
    {
      id: "view.list",
      label: "View: List",
      run: () => update("defaultView", "list"),
    },
    {
      id: "view.tile",
      label: "View: Tile",
      run: () => update("defaultView", "tile"),
    },
    {
      id: "view.gallery",
      label: "View: Gallery",
      run: () => update("defaultView", "gallery"),
    },
    {
      id: "view.column",
      label: "View: Column",
      run: () => update("defaultView", "column"),
    },
    // Density
    {
      id: "density.comfortable",
      label: "Density: Comfortable",
      hint: settings.density === "comfortable" ? "Current" : undefined,
      run: () => update("density", "comfortable"),
    },
    {
      id: "density.compact",
      label: "Density: Compact",
      hint: settings.density === "compact" ? "Current" : undefined,
      run: () => update("density", "compact"),
    },
    // Browser actions — fan out via window CustomEvents so the
    // palette doesn't need a direct ref to the active Browser.
    {
      id: "browser.refresh",
      label: "Refresh current folder",
      hint: "Cmd/Ctrl+R · F5",
      keywords: "reload list_dir",
      run: () => {
        setPage("browser");
        queueMicrotask(() =>
          window.dispatchEvent(new CustomEvent("skiff:refresh")),
        );
      },
    },
    {
      id: "browser.refreshAll",
      label: "Refresh all tabs",
      keywords: "reload all tabs list_dir",
      run: () => {
        setPage("browser");
        queueMicrotask(() =>
          window.dispatchEvent(new CustomEvent("skiff:refresh-all")),
        );
      },
    },
    {
      id: "sidebar.resetVisibility",
      label: "Reset sidebar section visibility",
      keywords: "sidebar sections show all defaults",
      hint: "Re-show every hidden section",
      run: () => update("sidebarSectionsVisible", {}),
    },
    {
      id: "browser.newFolder",
      label: "New folder",
      hint: "Cmd/Ctrl+Shift+N",
      keywords: "mkdir create",
      run: () => {
        setPage("browser");
        queueMicrotask(() =>
          window.dispatchEvent(new CustomEvent("skiff:new-folder")),
        );
      },
    },
    {
      id: "browser.newTab",
      label: "New tab",
      hint: "Cmd/Ctrl+T",
      keywords: "tab",
      run: () => {
        setPage("browser");
        queueMicrotask(() =>
          window.dispatchEvent(new CustomEvent("skiff:new-tab")),
        );
      },
    },
    {
      id: "browser.restoreClosedTab",
      label: "Restore last closed tab",
      hint: "Cmd/Ctrl+Shift+T",
      keywords: "tab undo",
      run: () => {
        setPage("browser");
        queueMicrotask(() =>
          window.dispatchEvent(new CustomEvent("skiff:restore-closed-tab")),
        );
      },
    },
    {
      id: "app.newWindow",
      label: "Open new window",
      hint: "Cmd/Ctrl+N",
      keywords: "window",
      run: () => {
        // dynamic import keeps the module out of the palette's hot
        // path render — only loads when the user actually triggers it.
        void import("./api/fs").then(({ windowOpenNew }) =>
          windowOpenNew().catch(() => {}),
        );
      },
    },
    // User-curated paths land at the bottom — they're noisier than
    // the static actions, but the palette's fuzzy search lets users
    // type a snippet of the path and skip past everything else.
    ...bookmarkActions,
    ...recentActions,
  ];
}
