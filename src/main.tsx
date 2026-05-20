// App bootstrap. The order matters: SettingsProvider has to wrap
// EffectiveThemeProvider because the latter reads `themeMode` from the
// settings store to decide which MUI theme to apply.
import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import App from "./App";
import PreviewWindow from "./pages/PreviewWindow";
import { initI18n } from "./i18n";
import { loadSettings, SettingsProvider, useSettings } from "./state/settings";

// Boot-time URL hash dispatch — when Tauri spawned us with
// `#preview=<urlEncoded-path>` (via `window_open_preview`), render
// the standalone PreviewWindow page instead of the full Browser
// shell. The full app is heavy (sidebar, tabs, command palette,
// settings store hydration); the preview window only needs to
// render one file's body and a header.
const isPreviewBoot =
  typeof window !== "undefined" && /[#&]preview=/.test(window.location.hash);

// Boot i18next BEFORE React mounts so `useTranslation` reads from a
// populated bundle on the first render. We seed from the persisted
// `Settings.language` (synchronous localStorage read) so the user
// doesn't see an English flash before their preferred locale loads.
initI18n(loadSettings().language);
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
      theme={themeForFull(
        effective,
        reducedMotion,
        settings.fontSize,
        settings.useCustomTheme
          ? effective === "dark"
            ? settings.customDarkPalette
            : settings.customLightPalette
          : undefined,
      )}
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
        {isPreviewBoot ? <PreviewWindow /> : <App />}
      </EffectiveThemeProvider>
    </SettingsProvider>
  </React.StrictMode>,
);
