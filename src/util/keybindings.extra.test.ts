// Branch-coverage pad for keybindings.ts. The original suite covers
// the happy paths (Cmd+Shift+P, Esc, F2, Delete) and the >→. layout
// normalization. This file fills in every other layout-symbol
// normalization branch + the pure-modifier short-circuit on
// matchesCombo. Without these tests a regression in `normalizeKey`
// could silently break shortcuts on every non-US keyboard layout.
import { describe, expect, it } from "vitest";
import { formatCombo, keyEventToCombo, matchesCombo } from "./keybindings";

function ev(init: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("keyEventToCombo — layout-stable code mapping", () => {
  it("maps each named symbol code to the canonical character", () => {
    // Pin every code-based mapping; this exists so a layout where
    // the user's keyboard emits e.g. `key="é"` for the Period key
    // still resolves to "." via the code fallback.
    const cases: Array<[string, string]> = [
      ["Period", "."],
      ["Comma", ","],
      ["Slash", "/"],
      ["Backslash", "\\"],
      ["BracketLeft", "["],
      ["BracketRight", "]"],
      ["Minus", "-"],
      ["Equal", "="],
      ["Quote", "'"],
      ["Semicolon", ";"],
    ];
    for (const [code, want] of cases) {
      // Provide a non-printable `key` so the function falls through
      // to the explicit code-based mappings rather than the
      // shifted-symbol normalizations below.
      const combo = keyEventToCombo(ev({ key: "Unidentified", code }));
      expect(combo).toBe(want);
    }
  });
});

describe("keyEventToCombo — shifted-symbol fallback (no `code`)", () => {
  it("normalizes every shifted symbol the test-utility lacks `code` for", () => {
    // fireEvent / some remote KVMs hand us `key="?"` with no `code`.
    // Each line corresponds to one branch of the shifted-symbol
    // switch in `normalizeKey`.
    const cases: Array<[string, string]> = [
      ["<", ","],
      ["?", "/"],
      ["|", "\\"],
      ["{", "["],
      ["}", "]"],
      ["_", "-"],
      ["+", "="],
      ['"', "'"],
      [":", ";"],
    ];
    for (const [k, want] of cases) {
      // No `code` field; rely on the shifted-symbol fallback.
      expect(keyEventToCombo(ev({ key: k }))).toBe(want);
    }
  });
});

describe("keyEventToCombo — modifier coverage", () => {
  it("treats Ctrl alone like Cmd alone (platform-neutral primary)", () => {
    expect(keyEventToCombo(ev({ key: "k", code: "KeyK", ctrlKey: true }))).toBe(
      "cmd+k",
    );
  });

  it("emits alt+key when only Alt is held", () => {
    expect(keyEventToCombo(ev({ key: "k", code: "KeyK", altKey: true }))).toBe(
      "alt+k",
    );
  });

  it("emits alt+shift+key when both are held without primary", () => {
    expect(
      keyEventToCombo(
        ev({ key: "k", code: "KeyK", altKey: true, shiftKey: true }),
      ),
    ).toBe("alt+shift+k");
  });

  it("returns null when the event carries no key field at all", () => {
    // Edge case: synthetic event with key="" — the explicit !k guard
    // bails out before the modifier-only check.
    expect(keyEventToCombo(ev({ key: "" }))).toBeNull();
  });
});

describe("matchesCombo — null event combo path", () => {
  it("returns false when the event itself is a pure modifier press (eventCombo null)", () => {
    // Pure modifier event → keyEventToCombo returns null → matchesCombo
    // must short-circuit to false rather than blowing up on a null
    // comparison.
    expect(matchesCombo(ev({ key: "Shift" }), "cmd+shift+p")).toBe(false);
    expect(matchesCombo(ev({ key: "Alt" }), "alt+f4")).toBe(false);
  });

  it("normalizes `ctrl+x` and `cmd+x` to the same combo", () => {
    // Stored combo uses ctrl+, event uses cmdKey → normalization
    // collapses the two so the binding still matches.
    const e = ev({ key: "x", code: "KeyX", metaKey: true });
    expect(matchesCombo(e, "ctrl+x")).toBe(true);
  });
});

describe("matchesCombo — Windows ↔ macOS cross-platform aliases", () => {
  // These pin the contract the user reported on 0.2.310: the
  // shortcuts they use on macOS (Cmd+T, Cmd+W, Cmd+Arrow for nav)
  // must trigger off the same KeyboardEvent shapes Windows produces
  // (ctrlKey=true, metaKey=false) without per-platform branching at
  // the call site. Each case below is a Windows-style keypress
  // checked against the macOS-style stored combo.
  it("matches Ctrl+T on Windows against the stored cmd+t binding", () => {
    const e = ev({ key: "t", code: "KeyT", ctrlKey: true });
    expect(matchesCombo(e, "cmd+t")).toBe(true);
  });
  it("matches Ctrl+W on Windows against the stored cmd+w binding", () => {
    const e = ev({ key: "w", code: "KeyW", ctrlKey: true });
    expect(matchesCombo(e, "cmd+w")).toBe(true);
  });
  it("matches Ctrl+ArrowLeft on Windows against the stored cmd+arrowleft binding", () => {
    const e = ev({ key: "ArrowLeft", ctrlKey: true });
    expect(matchesCombo(e, "cmd+arrowleft")).toBe(true);
  });
  it("matches Ctrl+ArrowRight on Windows against the stored cmd+arrowright binding", () => {
    const e = ev({ key: "ArrowRight", ctrlKey: true });
    expect(matchesCombo(e, "cmd+arrowright")).toBe(true);
  });
  it("matches Ctrl+ArrowUp on Windows against the stored cmd+arrowup binding", () => {
    const e = ev({ key: "ArrowUp", ctrlKey: true });
    expect(matchesCombo(e, "cmd+arrowup")).toBe(true);
  });
  it("matches Ctrl+ArrowDown on Windows against the stored cmd+arrowdown binding", () => {
    const e = ev({ key: "ArrowDown", ctrlKey: true });
    expect(matchesCombo(e, "cmd+arrowdown")).toBe(true);
  });
  it("emits alt+arrowleft for an Alt+Left press (Windows Explorer Back convention)", () => {
    // The Browser uses this combo as a hardcoded alias for goBack
    // so Windows users get the native chord without rebinding.
    expect(keyEventToCombo(ev({ key: "ArrowLeft", altKey: true }))).toBe(
      "alt+arrowleft",
    );
  });
});

describe("formatCombo — extras", () => {
  it("renders multi-modifier combos in left-to-right order", () => {
    expect(formatCombo("cmd+alt+shift+z")).toBe("Cmd+Alt+Shift+Z");
  });

  it("treats `ctrl` (stored verbatim) as a printable modifier", () => {
    // formatCombo doesn't collapse ctrl→cmd (only matchesCombo does);
    // the catalog displays whatever was stored.
    expect(formatCombo("ctrl+shift+a")).toBe("Ctrl+Shift+A");
  });
});
