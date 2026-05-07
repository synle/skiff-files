// App bootstrap. The order matters: SettingsProvider has to wrap
// EffectiveThemeProvider because the latter reads `themeMode` from the
// settings store to decide which MUI theme to apply.
import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { HashRouter } from "react-router";
import App from "./App";
import { SettingsProvider, useSettings } from "./state/settings";
import {
  themeForWithMotion,
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
    <ThemeProvider theme={themeForWithMotion(effective, reducedMotion)}>
      {children}
    </ThemeProvider>
  );
}

// Use HashRouter so deep links work under the `tauri://` protocol without
// needing server-side route fallbacks (the file:// loader can't rewrite paths).
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SettingsProvider>
      <EffectiveThemeProvider>
        <CssBaseline />
        <HashRouter>
          <App />
        </HashRouter>
      </EffectiveThemeProvider>
    </SettingsProvider>
  </React.StrictMode>,
);
