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

export const lightTheme: Theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1565c0" },
    background: { default: "#fafafa", paper: "#ffffff" },
  },
  typography: baseTypography,
  shape: baseShape,
});

export const darkTheme: Theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#64b5f6" },
    background: { default: "#1a1a1a", paper: "#222222" },
  },
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
