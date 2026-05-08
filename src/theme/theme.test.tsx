import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  fontSizePx,
  resolveEffective,
  themeFor,
  themeForFull,
  themeForWithMotion,
  useEffectiveMode,
} from "./index";

/** Build a fake matchMedia that the test can mutate after render. */
function installMatchMedia(initial: boolean) {
  let listener: ((e: MediaQueryListEvent) => void) | null = null;
  const mq = {
    matches: initial,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((_: string, cb: (e: MediaQueryListEvent) => void) => {
      listener = cb;
    }),
    removeEventListener: vi.fn(),
    onchange: null,
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockReturnValue(mq),
  });
  return {
    fire: (matches: boolean) => {
      mq.matches = matches;
      if (listener) listener({ matches } as MediaQueryListEvent);
    },
  };
}

describe("resolveEffective", () => {
  beforeEach(() => {
    installMatchMedia(false);
  });

  it("passes through an explicit choice", () => {
    expect(resolveEffective("light")).toBe("light");
    expect(resolveEffective("dark")).toBe("dark");
  });

  it("consults the OS for system mode", () => {
    expect(resolveEffective("system")).toBe("light");
    installMatchMedia(true);
    expect(resolveEffective("system")).toBe("dark");
  });
});

describe("useEffectiveMode", () => {
  it("re-renders when the OS theme flips and mode is system", () => {
    const mq = installMatchMedia(false);
    type Mode = "light" | "dark" | "system";
    const { result, rerender } = renderHook(
      ({ m }: { m: Mode }) => useEffectiveMode(m),
      { initialProps: { m: "system" as Mode } },
    );
    expect(result.current).toBe("light");
    act(() => mq.fire(true));
    expect(result.current).toBe("dark");

    // Switching to an explicit mode should ignore further OS flips.
    rerender({ m: "light" as Mode });
    expect(result.current).toBe("light");
    act(() => mq.fire(false));
    expect(result.current).toBe("light");
  });
});

describe("themeFor", () => {
  it("returns palette mode matching the effective choice", () => {
    expect(themeFor("light").palette.mode).toBe("light");
    expect(themeFor("dark").palette.mode).toBe("dark");
  });
});

// Regression for 0.2.129 — the theme builder used to spread typography
// from an already-baked theme, which left the per-variant pixel sizes
// (body1, h1, …) frozen at the previous fontSize. The Settings → Font
// size dropdown silently no-op'd. Recomposing from input options in a
// single createTheme call is the only path that actually rescales the
// variants; these tests pin that contract.
describe("fontSizePx + themeForFull (regression for the silent fontSize no-op)", () => {
  it("maps small / medium / large to expected MUI base px", () => {
    expect(fontSizePx("small")).toBe(12);
    expect(fontSizePx("medium")).toBe(14);
    expect(fontSizePx("large")).toBe(16);
  });

  it("themeForFull surfaces the chosen fontSize on typography.fontSize", () => {
    expect(themeForFull("light", false, "small").typography.fontSize).toBe(12);
    expect(themeForFull("light", false, "medium").typography.fontSize).toBe(14);
    expect(themeForFull("light", false, "large").typography.fontSize).toBe(16);
  });

  it("themeForFull rescales typography variants proportionally to fontSize", () => {
    // body1 fontSize differs across small/medium/large because the theme
    // was rebuilt with the new typography.fontSize at createTheme time.
    // If we ever regress to spreading typography from a baked theme, the
    // variant pixel sizes will collapse to a single value across modes.
    const small = themeForFull("light", false, "small").typography
      .body1.fontSize;
    const medium = themeForFull("light", false, "medium").typography
      .body1.fontSize;
    const large = themeForFull("light", false, "large").typography
      .body1.fontSize;
    expect(small).not.toBe(medium);
    expect(medium).not.toBe(large);
  });

  it("themeForFull installs an MuiCssBaseline html.fontSize override matching the chosen scale", () => {
    // Non-Typography text (buttons, MenuItems, file rows) reads from the
    // document root font-size, not from MUI Typography variants. The
    // 0.2.129 fix added an MuiCssBaseline override so the visual scale
    // applies to those too.
    const t = themeForFull("light", false, "large");
    const baseline = t.components?.MuiCssBaseline?.styleOverrides as
      | { html?: { fontSize?: string } }
      | undefined;
    expect(baseline?.html?.fontSize).toBe("16px");
  });

  it("themeForWithMotion suppresses transitions when reduceMotion is true", () => {
    const reduced = themeForWithMotion("light", true);
    // MUI's transitions.create returns the suppressed value when the
    // theme was built with `transitions.create: () => "none"`. We check
    // that the function exists and returns "none" — a regression that
    // re-introduces "spread from baked theme" would leave the original
    // create function in place.
    expect(reduced.transitions.create([], {})).toBe("none");
  });

  it("themeForWithMotion keeps transitions when reduceMotion is false", () => {
    const normal = themeForWithMotion("light", false);
    expect(normal.transitions.create([], {})).not.toBe("none");
  });
});
