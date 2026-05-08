// Duplicate-naming logic. Given a source filename or folder name,
// returns the duplicate target name as `<base>-copy-YYYY-MM-DD-HH-MM`
// where the timestamp uses 24-hour military time (no colons or
// seconds — the precision is "minute" so siblings created in the
// same minute would collide; the caller handles that with a `(2)`
// suffix).
//
// If the source already ends in a `-copy-<timestamp>` suffix
// (because the user is duplicating a duplicate), we strip the old
// timestamp before appending the new one. The user explicitly asked
// for this — they don't want the name to grow indefinitely.

/** Regex that matches the canonical `-copy-YYYY-MM-DD-HH-MM` tail
 *  we append, plus the optional `-N` collision suffix (and any
 *  number of repeats). Anchored at end so middle-name occurrences
 *  aren't stripped. Without this, re-duplicating
 *  `untitled-copy-2026-05-08-13-32-2` would produce
 *  `untitled-copy-2026-05-08-13-32-2-copy-2026-05-08-13-32` —
 *  user-visible bug. */
const COPY_SUFFIX_RE = /-copy-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}(?:-\d+)?$/;

/** Format `Date` as `YYYY-MM-DD-HH-MM`. Local time — users expect
 *  the timestamp to match what their wall clock says. */
function formatStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    pad(d.getHours()),
    pad(d.getMinutes()),
  ].join("-");
}

/** Split a filename into `{ stem, ext }`. Folders + dotfiles
 *  (`.env`) get an empty `ext`. */
function splitExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/** Build the duplicate name. `isDir = true` skips the extension
 *  split entirely. `now` lets tests inject a fixed clock. */
export function duplicateName(
  source: string,
  options?: { isDir?: boolean; now?: Date },
): string {
  const isDir = options?.isDir ?? false;
  const now = options?.now ?? new Date();
  const { stem: rawStem, ext } = isDir
    ? { stem: source, ext: "" }
    : splitExt(source);
  // Strip ANY number of previous `-copy-<timestamp>(-N)?` suffixes
  // so re-duplicating a re-duplicate doesn't grow the name forever
  // (the previous bug — names like `untitled-copy-…-copy-…-copy-…`).
  let stem = rawStem;
  while (true) {
    const next = stem.replace(COPY_SUFFIX_RE, "");
    if (next === stem) break;
    stem = next;
  }
  return `${stem}-copy-${formatStamp(now)}${ext}`;
}

/** Pick a unique duplicate name within `siblings`. Same-minute
 *  collisions get a `-copy-<timestamp>-2` / `-3` suffix. The
 *  caller decides what counts as a sibling. */
export function uniqueDuplicateName(
  source: string,
  siblings: Set<string>,
  options?: { isDir?: boolean; now?: Date },
): string {
  const base = duplicateName(source, options);
  if (!siblings.has(base)) return base;
  // Same-minute collision — append -2 / -3 etc. Insert before the
  // extension if there is one so the file extension stays at the
  // very end.
  const isDir = options?.isDir ?? false;
  const { stem, ext } = isDir ? { stem: base, ext: "" } : splitExt(base);
  let n = 2;
  let candidate = `${stem}-${n}${ext}`;
  while (siblings.has(candidate)) {
    n += 1;
    candidate = `${stem}-${n}${ext}`;
  }
  return candidate;
}
