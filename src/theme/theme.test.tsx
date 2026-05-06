import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { resolveEffective, useEffectiveMode, themeFor } from "./index";

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
