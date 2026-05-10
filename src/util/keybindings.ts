// Keyboard binding helpers. Centralizes the "match a KeyboardEvent
// against a stored shortcut string" logic so bindings can be edited
// from Settings without rewriting every keydown handler.
//
// Convention: combos are stored as lowercase strings with modifiers
// separated by `+` and the key last (e.g. "ctrl+shift+p", "cmd+k",
// "f2", "delete"). The `cmd` modifier means metaKey; on macOS that's
// the Command key, on Windows/Linux it's the Windows / Super key —
// we deliberately don't treat them differently because the binding
// surface should be platform-neutral.

/** Build the canonical combo string for a KeyboardEvent. The result
 *  matches the same shape stored in `Settings.shortcutOverrides`,
 *  so a captured event can be string-compared against the override. */
export function keyEventToCombo(e: KeyboardEvent): string | null {
  const k = e.key;
  if (!k) return null;
  // Skip pure modifier presses ("Shift" alone isn't a binding).
  if (k === "Shift" || k === "Control" || k === "Meta" || k === "Alt") {
    return null;
  }
  const parts: string[] = [];
  // Treat Cmd (macOS metaKey) and Ctrl (Windows / Linux) as one
  // platform-neutral "primary" modifier emitted as "cmd". Bindings
  // stay portable: a binding configured on macOS as Cmd+K matches
  // a Ctrl+K press on Linux without per-platform branching.
  if (e.metaKey || e.ctrlKey) parts.push("cmd");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  // Normalize key. Use e.code for symbol keys when available so the
  // captured combo is layout-independent (Shift+/ on US == Shift+? on
  // some other layouts; we want both to match).
  const lowerKey = normalizeKey(k, e.code);
  parts.push(lowerKey);
  return parts.join("+");
}

function normalizeKey(key: string, code: string): string {
  const k = key.toLowerCase();
  // Fall back on code for non-printable symbol keys we want to be
  // layout-stable. Period / Slash / Backquote etc. are common
  // shortcut keys whose `key` value differs by layout.
  if (k.length === 1 && code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code === "Period") return ".";
  if (code === "Comma") return ",";
  if (code === "Slash") return "/";
  if (code === "Backslash") return "\\";
  if (code === "BracketLeft") return "[";
  if (code === "BracketRight") return "]";
  if (code === "Minus") return "-";
  if (code === "Equal") return "=";
  if (code === "Quote") return "'";
  if (code === "Semicolon") return ";";
  return k;
}

/** Test if a KeyboardEvent matches a stored combo. Empty / null
 *  `combo` always returns false (the binding is disabled). The
 *  stored combo is normalized so "ctrl+x" and "cmd+x" are
 *  equivalent — see `keyEventToCombo` for the rationale. */
export function matchesCombo(e: KeyboardEvent, combo: string | null | undefined): boolean {
  if (!combo) return false;
  const eventCombo = keyEventToCombo(e);
  if (!eventCombo) return false;
  return eventCombo === normalizeCombo(combo);
}

/** Normalize a stored combo: lowercase + collapse `ctrl+` into the
 *  platform-neutral `cmd+` so historical settings (or user input
 *  that types Ctrl on a Mac out of habit) match cleanly. */
function normalizeCombo(combo: string): string {
  return combo.toLowerCase().replace(/\bctrl\+/g, "cmd+");
}

/** Pretty-printed display form for a combo. Capitalizes modifiers
 *  and the leading letter of the trailing key so the catalog reads
 *  cleanly ("Cmd+Shift+P" rather than "cmd+shift+p"). */
export function formatCombo(combo: string | null | undefined): string {
  if (!combo) return "—";
  return combo
    .split("+")
    .map((p) => {
      if (p === "cmd") return "Cmd";
      if (p === "ctrl") return "Ctrl";
      if (p === "alt") return "Alt";
      if (p === "shift") return "Shift";
      if (p.length === 1) return p.toUpperCase();
      // Multi-char keys: "delete" → "Delete", "arrowup" → "ArrowUp"
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join("+");
}

/** Look up the active combo for an action: explicit override wins;
 *  null override means the user disabled the binding; missing key
 *  falls back to the default. */
export function activeCombo(
  actionId: string,
  defaultCombo: string,
  overrides: Record<string, string | null>,
): string | null {
  if (Object.prototype.hasOwnProperty.call(overrides, actionId)) {
    return overrides[actionId]; // could be null = disabled
  }
  return defaultCombo;
}
