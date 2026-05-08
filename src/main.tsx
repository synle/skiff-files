// App bootstrap. The order matters: SettingsProvider has to wrap
// EffectiveThemeProvider because the latter reads `themeMode` from the
// settings store to decide which MUI theme to apply.
import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import App from "./App";
import { SettingsProvider, useSettings } from "./state/settings";
import {
  themeForFull,
  useEffectiveMode,
  usePrefersReducedMotion,
} from "./theme";

/**
 * Reads `themeMode` from settings and resolves it to a concrete MUI theme.
 * Lives here so the actual `<App>` tree doesn't need to know how the theme
 * was chosen — it just inherits the resolved palette via context.
 */
function EffectiveThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const effective = useEffectiveMode(settings.themeMode);
  // Reduced motion is auto-detected via prefers-reduced-motion, with
  // a Settings override (`reduceMotion`) for users who want it on
  // unconditionally regardless of OS preference.
  const prefersReduced = usePrefersReducedMotion();
  const reducedMotion = settings.reduceMotion || prefersReduced;
  return (
    <ThemeProvider
      theme={themeForFull(effective, reducedMotion, settings.fontSize)}
    >
      {children}
    </ThemeProvider>
  );
}

// Top-level routing is state-based (see App.tsx Page type) rather than
// react-router. We don't need URL deep linking inside a Tauri desktop
// app and the HashRouter + StrictMode + nested Routes combo had a
// rendering bug we couldn't track down.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SettingsProvider>
      <EffectiveThemeProvider>
        <CssBaseline />
        <App />
      </EffectiveThemeProvider>
    </SettingsProvider>
  </React.StrictMode>,
);
