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

/** Per-mode user palette overrides. Each field is a hex string;
 *  empty means "fall back to the built-in default for that slot". */
export interface CustomPaletteOverrides {
  primaryMain?: string;
  backgroundDefault?: string;
  backgroundPaper?: string;
  textPrimary?: string;
  textSecondary?: string;
}

/** Apply a partial user palette to the built-in mode palette.
 *  Empty-string fields are ignored so users can override one slot
 *  without supplying values for all of them. */
function applyCustomPalette(
  base: typeof lightPalette | typeof darkPalette,
  overrides: CustomPaletteOverrides | undefined,
) {
  if (!overrides) return base;
  // Wider record shape so the createTheme call accepts the result;
  // `text` is optional on MUI's PaletteOptions but not on our concrete
  // base palette literals.
  const merged: Record<string, unknown> = {
    mode: base.mode,
    primary: { main: overrides.primaryMain || base.primary.main },
    background: {
      default: overrides.backgroundDefault || base.background.default,
      paper: overrides.backgroundPaper || base.background.paper,
    },
  };
  if (overrides.textPrimary || overrides.textSecondary) {
    const text: Record<string, string> = {};
    if (overrides.textPrimary) text.primary = overrides.textPrimary;
    if (overrides.textSecondary) text.secondary = overrides.textSecondary;
    merged.text = text;
  }
  return merged as typeof base;
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
  customPalette?: CustomPaletteOverrides,
): Theme {
  const basePalette = effective === "dark" ? darkPalette : lightPalette;
  return createTheme({
    palette: applyCustomPalette(basePalette, customPalette),
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
          // Prism token colors. Two palettes so the highlighted code
          // contrasts on both backgrounds. Tokens that don't appear
          // here fall through to the surrounding `color` (text.primary),
          // which is the right default for things like punctuation.
          // Selectors are `.token.<type>` per Prism's standard markup.
          ...(effective === "dark"
            ? {
                ".token.comment, .token.prolog, .token.doctype, .token.cdata":
                  { color: "#6a7280", fontStyle: "italic" },
                ".token.punctuation": { color: "#cbd5e1" },
                ".token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol, .token.deleted":
                  { color: "#fca5a5" },
                ".token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted":
                  { color: "#86efac" },
                ".token.operator, .token.entity, .token.url, .token.variable":
                  { color: "#fcd34d" },
                ".token.atrule, .token.attr-value, .token.keyword":
                  { color: "#93c5fd" },
                ".token.function, .token.class-name": { color: "#c4b5fd" },
                ".token.regex, .token.important": { color: "#f9a8d4" },
                ".token.important, .token.bold": { fontWeight: 600 },
                ".token.italic": { fontStyle: "italic" },
              }
            : {
                ".token.comment, .token.prolog, .token.doctype, .token.cdata":
                  { color: "#6b7280", fontStyle: "italic" },
                ".token.punctuation": { color: "#475569" },
                ".token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol, .token.deleted":
                  { color: "#b91c1c" },
                ".token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted":
                  { color: "#15803d" },
                ".token.operator, .token.entity, .token.url, .token.variable":
                  { color: "#a16207" },
                ".token.atrule, .token.attr-value, .token.keyword":
                  { color: "#1d4ed8" },
                ".token.function, .token.class-name": { color: "#6d28d9" },
                ".token.regex, .token.important": { color: "#be185d" },
                ".token.important, .token.bold": { fontWeight: 600 },
                ".token.italic": { fontStyle: "italic" },
              }),
          // Search-match highlight inside the preview text body.
          // Picks the accent color from MUI's warning palette so it
          // pops on both themes without re-deriving the hex inline.
          ".skiff-search-hit": {
            backgroundColor:
              effective === "dark"
                ? "rgba(250, 204, 21, 0.32)"
                : "rgba(250, 204, 21, 0.55)",
            borderRadius: 2,
          },
          ".skiff-search-hit-active": {
            backgroundColor:
              effective === "dark"
                ? "rgba(249, 115, 22, 0.55)"
                : "rgba(249, 115, 22, 0.75)",
            outline:
              effective === "dark"
                ? "1px solid rgba(249, 115, 22, 0.85)"
                : "1px solid rgba(194, 65, 12, 0.9)",
          },
          // Rendered-markdown styling for the preview body. Skips
          // a full prose framework — just enough to make headings,
          // code blocks, lists, and tables legible inside the
          // pre-wrap container the preview body uses elsewhere.
          ".skiff-markdown": {
            fontFamily: baseTypography.fontFamily,
            lineHeight: 1.55,
            "& h1, & h2, & h3, & h4, & h5, & h6": {
              fontWeight: 600,
              marginTop: "1em",
              marginBottom: "0.4em",
              lineHeight: 1.25,
            },
            "& h1": { fontSize: "1.6em" },
            "& h2": { fontSize: "1.35em" },
            "& h3": { fontSize: "1.15em" },
            "& h4, & h5, & h6": { fontSize: "1em" },
            "& p": { margin: "0.6em 0" },
            "& code": {
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: "0.92em",
              padding: "0.1em 0.3em",
              borderRadius: 3,
              backgroundColor:
                effective === "dark"
                  ? "rgba(148, 163, 184, 0.18)"
                  : "rgba(15, 23, 42, 0.08)",
            },
            "& pre": {
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: "0.9em",
              padding: "0.75em",
              borderRadius: 6,
              overflowX: "auto",
              backgroundColor:
                effective === "dark"
                  ? "rgba(15, 23, 42, 0.55)"
                  : "rgba(15, 23, 42, 0.05)",
            },
            "& pre code": {
              padding: 0,
              backgroundColor: "transparent",
            },
            "& blockquote": {
              borderLeft:
                effective === "dark"
                  ? "3px solid rgba(148, 163, 184, 0.5)"
                  : "3px solid rgba(15, 23, 42, 0.25)",
              margin: "0.6em 0",
              padding: "0.2em 0 0.2em 0.8em",
              color: effective === "dark" ? "#cbd5e1" : "#475569",
            },
            "& ul, & ol": {
              margin: "0.6em 0",
              paddingLeft: "1.6em",
            },
            "& li": { margin: "0.2em 0" },
            "& table": {
              borderCollapse: "collapse",
              margin: "0.6em 0",
            },
            "& th, & td": {
              border:
                effective === "dark"
                  ? "1px solid rgba(148, 163, 184, 0.3)"
                  : "1px solid rgba(15, 23, 42, 0.15)",
              padding: "0.3em 0.6em",
            },
            "& th": { fontWeight: 600 },
            "& a": {
              color: effective === "dark" ? "#93c5fd" : "#1d4ed8",
              textDecoration: "underline",
            },
            "& img": { maxWidth: "100%" },
            "& hr": {
              border: 0,
              borderTop:
                effective === "dark"
                  ? "1px solid rgba(148, 163, 184, 0.3)"
                  : "1px solid rgba(15, 23, 42, 0.15)",
              margin: "1em 0",
            },
          },
        },
      },
    },
  });
}
