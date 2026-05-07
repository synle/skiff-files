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

/** Optional add-ons for the bulk rename pattern. Each is empty / 0
 *  in defaults; the dialog only sets the fields the user touched. */
export interface BulkRenameOptions {
  /** Prepended to every name after find/replace runs. */
  prefix?: string;
  /** Appended after find/replace, BEFORE the file extension when
   *  `suffixBeforeExt` is true (so a suffix of "-edit" turns
   *  "photo.jpg" into "photo-edit.jpg" rather than "photo.jpg-edit"). */
  suffix?: string;
  /** Whether `suffix` should land before the extension. Default true
   *  because that's almost always what users want for files. */
  suffixBeforeExt?: boolean;
  /** Starting value for the `{n}` sequence-number token. Default 1. */
  sequenceStart?: number;
}

/**
 * Apply a find/replace transformation to every entry name.
 *
 * - `find` empty → no-op (every row's `changed` is false), unless
 *   `prefix` / `suffix` is set, in which case those still apply.
 * - `regex=true` → `find` is parsed as a JS regex with the `g` flag;
 *   capture groups can be referenced via `$1` etc. in `replace`.
 * - Invalid regex → every row gets `error = "invalid regex"` and
 *   the dialog disables Apply.
 *
 * Sequence-number tokens in `replace`:
 * - `{n}`     — 1-based row index (post-start).
 * - `{n:NN}`  — zero-padded to NN digits, e.g. `{n:03}` → `001, 002, ...`
 *
 * Tokens are expanded AFTER the regex substitution, so a regex
 * capture group can also feed into the prefix or replace text.
 */
export function applyBulkRename(
  names: string[],
  find: string,
  replace: string,
  regex: boolean,
  options: BulkRenameOptions = {},
): BulkRenameResult[] {
  const prefix = options.prefix ?? "";
  const suffix = options.suffix ?? "";
  const suffixBeforeExt = options.suffixBeforeExt ?? true;
  const start = options.sequenceStart ?? 1;
  const hasFind = find.length > 0;
  const hasAddons = prefix.length > 0 || suffix.length > 0;

  // Build the find/replace regex once (or skip when find is empty).
  let pattern: RegExp | null = null;
  if (hasFind) {
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
  }

  return names.map((n, i) => {
    if (!hasFind && !hasAddons) {
      return { oldName: n, newName: n, error: null, changed: false };
    }
    // 1. find/replace.
    const sub = pattern ? n.replace(pattern, replace) : n;
    // 2. {n} token expansion. We do this AFTER the regex pass so the
    //    user can mix `$1` (capture) with `{n}` (sequence) in one
    //    `replace` field — though typically only one is used.
    const numbered = expandSequenceTokens(sub, i + start);
    // 3. prefix + suffix (suffix optionally before the extension).
    const withAddons = applyAddons(numbered, prefix, suffix, suffixBeforeExt);
    return {
      oldName: n,
      newName: withAddons,
      error: null,
      changed: withAddons !== n,
    };
  });
}

/** Replace `{n}` and `{n:NN}` tokens with the index. NN is a
 *  decimal integer; `{n:03}` → 3-digit zero-padded. */
function expandSequenceTokens(s: string, idx: number): string {
  return s.replace(/\{n(?::(\d+))?\}/g, (_, padStr) => {
    const str = String(idx);
    if (!padStr) return str;
    const pad = parseInt(padStr, 10);
    return str.padStart(pad, "0");
  });
}

/** Insert prefix + suffix around the name. `suffixBeforeExt` controls
 *  whether `-edit` lands before or after the extension. */
function applyAddons(
  name: string,
  prefix: string,
  suffix: string,
  suffixBeforeExt: boolean,
): string {
  if (!suffix) return `${prefix}${name}`;
  if (!suffixBeforeExt) return `${prefix}${name}${suffix}`;
  // Find the last dot that's actually an extension separator (not at
  // index 0, e.g. ".env"). Match common file-extension shapes only.
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${prefix}${name}${suffix}`;
  return `${prefix}${name.slice(0, dot)}${suffix}${name.slice(dot)}`;
}

/** Escape a literal string so it's safe to use inside a RegExp. The
 *  built-in regex constructor takes care of `g` flag for us; this
 *  helper is just for the literal-search mode. */
function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
