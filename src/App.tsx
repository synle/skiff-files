// Root layout — sidebar on the left, route content on the right. Both are
// inside the HashRouter (set up in main.tsx), so the sidebar can use the
// navigation hooks directly.
import { Routes, Route, Navigate, useNavigate } from "react-router";
import { Box } from "@mui/material";
import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import ShortcutsModal from "./components/ShortcutsModal";
import Browser from "./pages/Browser";
import SettingsPage from "./pages/SettingsPage";
import ConnectionsPage from "./pages/ConnectionsPage";
import TransfersPage from "./pages/TransfersPage";
import { fsHomeDir } from "./api/fs";

/** A custom DOM event the Sidebar emits to ask the Browser to navigate. We
 *  use a window event rather than lifting state because it stays
 *  zero-coupling — the Sidebar doesn't need to know whether the Browser is
 *  currently mounted. */
export const NAVIGATE_EVENT = "skiff:navigate";

/**
 * Resolves the home directory once at the layout level so navigating between
 * Settings and Browser doesn't re-issue the Rust call on every route change.
 */
export default function App() {
  const [home, setHome] = useState("");
  const navigate = useNavigate();

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
      <Sidebar
        home={home}
        onNavigate={(p) => {
          // Switch to the Browser route first, then dispatch the path. Order
          // matters: if we're on /settings the Browser isn't mounted yet, so
          // dispatching first would no-op.
          navigate("/");
          // queueMicrotask so the route change commits before the listener fires
          queueMicrotask(() =>
            window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: p })),
          );
        }}
      />
      <Box
        component="main"
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <Routes>
          <Route path="/" element={<Browser />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/transfers" element={<TransfersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Box>
      {/* Mounted once at the app root so any route can pop the cheatsheet
          via `?` without re-listening per page. */}
      <ShortcutsModal />
    </Box>
  );
}
