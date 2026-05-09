// Theme tokens + an `effective` mode selector. We keep the two themes as
// instances rather than a single factory so the JIT can specialize
// component styles per mode without reflowing the full palette on every
// toggle.
import { createTheme, type Theme } from "@mui/material/styles";
import { useEffect, useState } from "react";

/** What the user picked in Settings. `system` = follow `prefers-color-scheme`. */
export type ThemeMode = "light" | "dark" | "system";

/** Concrete mode actually applied to the tree. Always `light` or `dark`. */
export type EffectiveMode = "light" | "dark";

const baseTypography = {
  // System font stack mirrors what native file managers use, so the app
  // doesn't read as "another Electron app". No webfont download either.
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
} as const;

const baseShape = { borderRadius: 6 } as const;

const lightPalette = {
  mode: "light" as const,
  primary: { main: "#1565c0" },
  background: { default: "#fafafa", paper: "#ffffff" },
};

const darkPalette = {
  mode: "dark" as const,
  primary: { main: "#64b5f6" },
  background: { default: "#1a1a1a", paper: "#222222" },
};

export const lightTheme: Theme = createTheme({
  palette: lightPalette,
  typography: baseTypography,
  shape: baseShape,
});

export const darkTheme: Theme = createTheme({
  palette: darkPalette,
  typography: baseTypography,
  shape: baseShape,
});

/** Resolve a `ThemeMode` to the concrete mode, consulting the OS for `system`. */
export function resolveEffective(mode: ThemeMode): EffectiveMode {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Hook that returns the effective mode and re-renders when the OS theme
 * changes (only relevant when the user picked `system`). The matchMedia
 * listener is added/removed in lockstep with the prop so we don't keep stale
 * subscriptions after the user picks a fixed mode.
 */
export function useEffectiveMode(mode: ThemeMode): EffectiveMode {
  const [effective, setEffective] = useState<EffectiveMode>(() =>
    resolveEffective(mode),
  );

  useEffect(() => {
    setEffective(resolveEffective(mode));
    if (mode !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      setEffective(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  return effective;
}

/** Returns the MUI Theme matching the resolved effective mode. */
export function themeFor(effective: EffectiveMode): Theme {
  return effective === "dark" ? darkTheme : lightTheme;
}

/** Hook that returns true when the user has requested reduced motion
 *  via the OS (`prefers-reduced-motion`). Drives the `transitions.create`
 *  short-circuit in MUI's theme. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Builds a theme that respects the reduced-motion preference. When
 *  reduced, MUI's `transitions.create` returns `none` so component
 *  fades / accordions / drawers don't animate. Built with a single
 *  `createTheme` call so transitions actually take effect — wrapping
 *  an already-baked theme would leave precomputed transition strings
 *  on individual components. */
export function themeForWithMotion(
  effective: EffectiveMode,
  reducedMotion: boolean,
): Theme {
  if (!reducedMotion) return themeFor(effective);
  return createTheme({
    palette: effective === "dark" ? darkPalette : lightPalette,
    typography: baseTypography,
    shape: baseShape,
    transitions: {
      create: () => "none",
    },
  });
}

/** Maps the user's font-size choice to MUI's base font size in pixels.
 *  MUI's default is 14; we step ±2 for S/L. */
export function fontSizePx(
  size: "small" | "medium" | "large",
): number {
  if (size === "small") return 12;
  if (size === "large") return 16;
  return 14;
}

/** Build a theme honoring all UI-level user preferences in a single
 *  `createTheme` call. Critically: typography variants (body1, h1,
 *  etc.) only rescale when `fontSize` is part of the *initial*
 *  options — spreading `...base.typography` from an already-baked
 *  theme bakes in the old variant pixel sizes. Same story for
 *  `transitions.create`. So we recompose from scratch every time. */
export function themeForFull(
  effective: EffectiveMode,
  reducedMotion: boolean,
  fontSize: "small" | "medium" | "large",
): Theme {
  return createTheme({
    palette: effective === "dark" ? darkPalette : lightPalette,
    typography: { ...baseTypography, fontSize: fontSizePx(fontSize) },
    shape: baseShape,
    ...(reducedMotion
      ? { transitions: { create: () => "none" } }
      : {}),
    components: {
      // Apply the user's font size at the document root too — MUI's
      // typography variants scale via pxToRem, so they need both
      // typography.fontSize *and* a matching root font-size for the
      // CSS to actually render at the chosen scale.
      MuiCssBaseline: {
        styleOverrides: {
          html: { fontSize: `${fontSizePx(fontSize)}px` },
          body: {
            fontSize: `${fontSizePx(fontSize)}px`,
            // Desktop-app convention: labels (sidebar, tabs, path-
            // bar, file rows, status bar, menu items) shouldn't be
            // text-selectable — clicking / dragging them drops a
            // caret which always feels wrong. Inputs + textareas +
            // content-editable + the preview pane (.skiff-selectable)
            // opt back in.
            userSelect: "none",
            WebkitUserSelect: "none",
          },
          "input, textarea, [contenteditable=true], .skiff-selectable, .skiff-selectable *": {
            userSelect: "auto",
            WebkitUserSelect: "auto",
          },
        },
      },
    },
  });
}
