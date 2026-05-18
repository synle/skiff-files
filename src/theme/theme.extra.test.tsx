// Branch + function coverage pad for src/theme/index.ts. The base
// suite (theme.test.tsx) covers resolveEffective + useEffectiveMode
// + themeFor + themeForWithMotion. This adds:
//   - usePrefersReducedMotion hook (initial value + listener flip)
//   - themeForFull with each shape of CustomPaletteOverrides:
//       * undefined (the no-overrides branch)
//       * primary-only
//       * full text override (covers the conditional `text` block at
//         line 165)
//   - themeForFull dark mode with reducedMotion + custom palette in
//     one call (the conditional spread branch)
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { themeForFull, usePrefersReducedMotion } from "./index";

/** Build a fake matchMedia the test can flip after render. */
function installMatchMedia(initial: boolean) {
  let listener: ((e: MediaQueryListEvent) => void) | null = null;
  const mq = {
    matches: initial,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(
      (_: string, cb: (e: MediaQueryListEvent) => void) => {
        listener = cb;
      },
    ),
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

describe("usePrefersReducedMotion", () => {
  beforeEach(() => {
    installMatchMedia(false);
  });

  it("returns false when the OS hasn't requested reduced motion", () => {
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it("re-renders when the OS preference flips to reduced", () => {
    const mq = installMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    act(() => mq.fire(true));
    expect(result.current).toBe(true);
  });

  it("initial value reflects the OS preference at mount time", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });
});

describe("themeForFull — CustomPaletteOverrides branches", () => {
  beforeEach(() => {
    installMatchMedia(false);
  });

  it("renders the default palette when no overrides are supplied", () => {
    const t = themeForFull("light", false, "medium");
    expect(t.palette.primary.main).toBe("#1565c0");
    expect(t.palette.background.default).toBe("#fafafa");
  });

  it("applies a primaryMain override while leaving backgrounds alone", () => {
    const t = themeForFull("light", false, "medium", {
      primaryMain: "#ff0000",
    });
    expect(t.palette.primary.main).toBe("#ff0000");
    expect(t.palette.background.default).toBe("#fafafa");
  });

  it("applies a background-only override (default + paper)", () => {
    const t = themeForFull("dark", false, "medium", {
      backgroundDefault: "#000000",
      backgroundPaper: "#111111",
    });
    expect(t.palette.background.default).toBe("#000000");
    expect(t.palette.background.paper).toBe("#111111");
  });

  it("applies text.primary and text.secondary overrides together", () => {
    const t = themeForFull("light", false, "medium", {
      textPrimary: "#222222",
      textSecondary: "#999999",
    });
    expect(t.palette.text.primary).toBe("#222222");
    expect(t.palette.text.secondary).toBe("#999999");
  });

  it("applies text.primary alone without forcing text.secondary", () => {
    // Pin the partial-text branch — `text` object only includes the
    // fields the user provided. MUI's default secondary survives.
    const t = themeForFull("light", false, "medium", {
      textPrimary: "#333333",
    });
    expect(t.palette.text.primary).toBe("#333333");
  });

  it("ignores empty-string fields (treats them as 'no override')", () => {
    // Empty-string is the "fall back to default" sentinel — pin so a
    // user with one empty field doesn't accidentally render a null
    // color into the palette.
    const t = themeForFull("light", false, "medium", {
      primaryMain: "",
      backgroundDefault: "",
      backgroundPaper: "",
      textPrimary: "",
      textSecondary: "",
    });
    expect(t.palette.primary.main).toBe("#1565c0");
    expect(t.palette.background.default).toBe("#fafafa");
  });

  it("combines reducedMotion + custom palette in dark mode", () => {
    // Cross-branch: dark mode + reduced motion + a primary override.
    // Both the `transitions.create: () => "none"` block AND the
    // applyCustomPalette branch must fire.
    const t = themeForFull("dark", true, "small", {
      primaryMain: "#abcdef",
    });
    expect(t.palette.mode).toBe("dark");
    expect(t.palette.primary.main).toBe("#abcdef");
    expect(t.typography.fontSize).toBe(12);
    expect(t.transitions.create([], {})).toBe("none");
  });
});
