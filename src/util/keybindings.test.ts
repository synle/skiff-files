import { describe, expect, it } from "vitest";
import {
  activeCombo,
  formatCombo,
  keyEventToCombo,
  matchesCombo,
} from "./keybindings";

function ev(init: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("keyEventToCombo", () => {
  it("captures simple letter + modifier", () => {
    expect(keyEventToCombo(ev({ key: "p", code: "KeyP", metaKey: true, shiftKey: true }))).toBe(
      "cmd+shift+p",
    );
  });

  it("returns null for a pure modifier press", () => {
    expect(keyEventToCombo(ev({ key: "Shift", code: "ShiftLeft" }))).toBeNull();
  });

  it("normalizes period via code (Shift+. on US emits >, both should match)", () => {
    expect(keyEventToCombo(ev({ key: ">", code: "Period", shiftKey: true }))).toBe(
      "shift+.",
    );
    expect(keyEventToCombo(ev({ key: ".", code: "Period", shiftKey: true }))).toBe(
      "shift+.",
    );
  });

  it("captures function keys + named keys", () => {
    expect(keyEventToCombo(ev({ key: "F2", code: "F2" }))).toBe("f2");
    expect(keyEventToCombo(ev({ key: "Delete", code: "Delete" }))).toBe("delete");
    expect(keyEventToCombo(ev({ key: "ArrowUp", code: "ArrowUp" }))).toBe("arrowup");
  });
});

describe("matchesCombo", () => {
  it("matches when eventCombo === combo", () => {
    const e = ev({ key: "p", code: "KeyP", metaKey: true, shiftKey: true });
    expect(matchesCombo(e, "cmd+shift+p")).toBe(true);
  });

  it("returns false for empty / null combo (disabled binding)", () => {
    expect(matchesCombo(ev({ key: "p" }), "")).toBe(false);
    expect(matchesCombo(ev({ key: "p" }), null)).toBe(false);
  });

  it("is case-insensitive in combo input", () => {
    const e = ev({ key: "p", code: "KeyP", metaKey: true });
    expect(matchesCombo(e, "Cmd+P")).toBe(true);
  });
});

describe("formatCombo", () => {
  it("capitalizes modifiers and key", () => {
    expect(formatCombo("cmd+shift+p")).toBe("Cmd+Shift+P");
    expect(formatCombo("ctrl+k")).toBe("Ctrl+K");
    expect(formatCombo("f2")).toBe("F2");
    expect(formatCombo("delete")).toBe("Delete");
  });

  it("returns dash for null/empty", () => {
    expect(formatCombo(null)).toBe("—");
    expect(formatCombo("")).toBe("—");
  });
});

describe("activeCombo", () => {
  it("returns the default when no override is present", () => {
    expect(activeCombo("foo", "cmd+k", {})).toBe("cmd+k");
  });

  it("returns the override when set", () => {
    expect(activeCombo("foo", "cmd+k", { foo: "ctrl+j" })).toBe("ctrl+j");
  });

  it("returns null (disabled) when the override key is null", () => {
    expect(activeCombo("foo", "cmd+k", { foo: null })).toBeNull();
  });
});
