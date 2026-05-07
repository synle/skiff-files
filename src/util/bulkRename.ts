// Pure helpers for the bulk-rename dialog. Pulled out so the
// substitution logic is unit-testable without spinning up Testing
// Library. The dialog itself owns the UI + the actual rename
// invocation.

/** Result of applying the find/replace pattern to a single name.
 *  `error` is non-null when the regex was invalid (the dialog shows
 *  it inline rather than crashing). */
export interface BulkRenameResult {
  oldName: string;
  newName: string;
  error: string | null;
  /** True when the substitution actually changes the name. The dialog
   *  hides unchanged rows + skips them on apply. */
  changed: boolean;
}

/**
 * Apply a find/replace transformation to every entry name.
 *
 * - `find` empty → no-op (every row's `changed` is false).
 * - `regex=true` → `find` is parsed as a JS regex with the `g` flag;
 *   capture groups can be referenced via `$1` etc. in `replace`.
 * - Invalid regex → every row gets `error = "invalid regex"` and
 *   the dialog disables Apply.
 */
export function applyBulkRename(
  names: string[],
  find: string,
  replace: string,
  regex: boolean,
): BulkRenameResult[] {
  if (!find) {
    return names.map((n) => ({
      oldName: n,
      newName: n,
      error: null,
      changed: false,
    }));
  }
  let pattern: RegExp;
  try {
    pattern = regex
      ? new RegExp(find, "g")
      : new RegExp(escapeForRegex(find), "g");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "invalid regex";
    return names.map((n) => ({
      oldName: n,
      newName: n,
      error: msg,
      changed: false,
    }));
  }
  return names.map((n) => {
    const next = n.replace(pattern, replace);
    return {
      oldName: n,
      newName: next,
      error: null,
      changed: next !== n,
    };
  });
}

/** Escape a literal string so it's safe to use inside a RegExp. The
 *  built-in regex constructor takes care of `g` flag for us; this
 *  helper is just for the literal-search mode. */
function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
