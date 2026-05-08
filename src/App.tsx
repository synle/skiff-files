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
import SettingsPage from "./pages/SettingsPage";
import ConnectionsPage from "./pages/ConnectionsPage";
import TransfersPage from "./pages/TransfersPage";
import { fsHomeDir, fsStat } from "./api/fs";
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
  /** Active page. Replaces react-router's Routes-based switching. */
  const [page, setPage] = useState<Page>("browser");
  const { settings, update } = useSettings();

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
      if (k === "k") {
        e.preventDefault();
        setQuickJumpOpen((o) => !o);
      } else if (k === "b") {
        e.preventDefault();
        update("sidebarVisible", !settings.sidebarVisible);
      } else if (e.key === "," ) {
        // Mac convention: Cmd+, opens app preferences. We honor it
        // on Linux/Windows too via Ctrl+, since users coming from
        // VS Code expect this binding everywhere.
        e.preventDefault();
        setPage("settings");
      } else if (e.key === "\\") {
        // Cmd/Ctrl+\ toggles two-pane (split) mode. FileZilla muscle
        // memory: the second pane is for cross-protocol drag-drop
        // transfers from local ↔ remote without juggling tabs.
        e.preventDefault();
        update("twoPaneMode", !settings.twoPaneMode);
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
      } else if (e.shiftKey && e.key === ".") {
        // Finder muscle memory: Cmd+Shift+. toggles dotfile visibility.
        e.preventDefault();
        update("showHidden", !settings.showHidden);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings.sidebarVisible, update]);

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
    </Box>
  );
}
