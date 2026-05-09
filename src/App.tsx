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
import { fsHomeDir, fsStat, windowOpenNew } from "./api/fs";
import { listen } from "@tauri-apps/api/event";
import { loadSettingsFromDisk } from "./state/settings";
import { useSettings } from "./state/settings";
import { pruneStaleBookmarks, pruneStalePaths } from "./util/pruneStale";

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
  const { settings, setSettings, update } = useSettings();

  // Cmd/Ctrl+K → toggle the quick-jump palette. Cmd/Ctrl+B → toggle
  // the sidebar (persisted in Settings so it survives restart).
  // Both skip when an input is focused so they don't hijack typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === "n" && !e.shiftKey) {
        // Cmd/Ctrl+N opens a new top-level window. Multi-window
        // support: each spawned window is a fresh React tree
        // pointing at the same settings.json on disk; settings sync
        // across windows via the `settings:changed` Tauri event.
        e.preventDefault();
        void windowOpenNew().catch(() => {
          /* running outside Tauri / browser dev — silent fallback */
        });
      } else if (k === "k") {
        e.preventDefault();
        setQuickJumpOpen((o) => !o);
      } else if (k === "p" && e.shiftKey) {
        // Cmd/Ctrl+Shift+P opens the command palette. VS Code muscle
        // memory. Distinct from Cmd+K (paths) and Cmd+P (no binding —
        // intentionally left free since browsers consume it for print).
        e.preventDefault();
        setCommandPaletteOpen((o) => !o);
      } else if (k === "b") {
        e.preventDefault();
        update("sidebarVisible", !settings.sidebarVisible);
      } else if (e.key === "," ) {
        // Mac convention: Cmd+, opens app preferences. We honor it
        // on Linux/Windows too via Ctrl+, since users coming from
        // VS Code expect this binding everywhere.
        e.preventDefault();
        setPage("settings");
      } else if (e.key === "\\" && e.shiftKey) {
        // Cmd/Ctrl+Shift+\ toggles two-pane (split) mode. FileZilla
        // muscle memory: the second pane is for cross-protocol
        // drag-drop transfers from local ↔ remote without juggling
        // tabs. Plain Cmd+\ is reserved for the sidebar toggle below.
        e.preventDefault();
        update("twoPaneMode", !settings.twoPaneMode);
      } else if (e.key === "\\") {
        // Cmd/Ctrl+\ toggles the sidebar. Cmd+B also works (kept for
        // VS Code muscle memory) — \\ is the user-preferred binding.
        e.preventDefault();
        update("sidebarVisible", !settings.sidebarVisible);
      } else if (e.key === "=" || e.key === "+") {
        // Browser muscle memory: Cmd/Ctrl+= bumps font size one step
        // up. Cycles small → medium → large → (cap). `=` and `+`
        // share the key on US keyboards; honor both.
        e.preventDefault();
        const next =
          settings.fontSize === "small"
            ? "medium"
            : settings.fontSize === "medium"
              ? "large"
              : "large";
        update("fontSize", next);
      } else if (e.key === "-") {
        e.preventDefault();
        const next =
          settings.fontSize === "large"
            ? "medium"
            : settings.fontSize === "medium"
              ? "small"
              : "small";
        update("fontSize", next);
      } else if (e.key === "0") {
        // Browser muscle memory: Cmd/Ctrl+0 resets zoom. Here it
        // resets font size to medium. Skipped when Shift is held so
        // users with non-US layouts who type ")" via Shift+0 don't
        // accidentally trigger.
        if (e.shiftKey) return;
        e.preventDefault();
        update("fontSize", "medium");
      } else if (e.shiftKey && (e.key === "." || e.key === ">" || e.code === "Period")) {
        // Finder muscle memory: Cmd+Shift+. toggles dotfile visibility.
        // On macOS Shift+. emits ">" (US layout) so we accept both keys
        // plus the layout-independent `code === "Period"`.
        e.preventDefault();
        update("showHidden", !settings.showHidden);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings.sidebarVisible, settings.twoPaneMode, settings.fontSize, settings.showHidden, update]);

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
            // queueMicrotask so the page change commits before the
            // listener fires.
            queueMicrotask(() =>
              window.dispatchEvent(
                new CustomEvent(NAVIGATE_EVENT, { detail: p }),
              ),
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
              <Box
                sx={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                  borderRight: 1,
                  borderColor: "divider",
                }}
              >
                <BrowserTabs home={home} pane="main" />
              </Box>
              <Box
                sx={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                }}
              >
                <BrowserTabs home={home} pane="right" />
              </Box>
            </Box>
          ) : (
            <BrowserTabs home={home} />
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
            window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: p })),
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
}): CommandAction[] {
  const { page, setPage, settings, update } = deps;
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
  ];
}
