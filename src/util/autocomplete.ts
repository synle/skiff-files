// Helpers for path-bar autocomplete. Pure functions — pulled out so
// the Tab-completion behavior is unit-testable without spinning up
// Testing Library.

/** Split a path into `(parent, partial)` halves at the last separator.
 *  `partial` is what the user is currently typing; we list `parent`
 *  to find matching siblings. The trailing-separator case (e.g.
 *  `/Users/syle/`) returns an empty `partial` so completion shows
 *  every entry in that folder. */
export function splitForCompletion(input: string): {
  parent: string;
  partial: string;
} {
  if (!input) return { parent: "", partial: "" };
  // Posix + Windows separators both supported; we always emit the
  // forward-slash form on output since every backend in this app
  // accepts it.
  const sep = Math.max(input.lastIndexOf("/"), input.lastIndexOf("\\"));
  if (sep < 0) return { parent: "", partial: input };
  return {
    parent: input.slice(0, sep) || "/",
    partial: input.slice(sep + 1),
  };
}

/** Longest common prefix of an array of strings. Used when the user's
 *  partial matches multiple entries — we complete as much as is
 *  unambiguous so the next keystroke disambiguates. */
export function longestCommonPrefix(strs: string[]): string {
  if (strs.length === 0) return "";
  if (strs.length === 1) return strs[0];
  const sorted = [...strs].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  let i = 0;
  while (i < first.length && i < last.length && first[i] === last[i]) i++;
  return first.slice(0, i);
}

/** Given the current input + the parent's listing, compute the new
 *  input value after a Tab keypress. Returns `null` to signal "no
 *  completion possible" (the caller should keep the input as-is). */
export function completePath(
  input: string,
  parentEntries: { name: string; isDir: boolean }[],
): string | null {
  const { parent, partial } = splitForCompletion(input);
  // Prefix match (case-insensitive — Finder convention).
  const lower = partial.toLowerCase();
  const matches = parentEntries.filter((e) =>
    e.name.toLowerCase().startsWith(lower),
  );
  if (matches.length === 0) return null;
  // Single match: complete it fully + a trailing `/` for folders so a
  // second Tab dives into them.
  if (matches.length === 1) {
    const m = matches[0];
    const tail = m.isDir ? `${m.name}/` : m.name;
    return joinAfterSplit(parent, tail);
  }
  // Multi-match: complete to the longest common prefix of the names.
  // Case-sensitive prefix here (the LCP is informational, the user
  // hasn't picked a case yet — preserve whatever the entries on disk
  // actually use).
  const lcp = longestCommonPrefix(matches.map((m) => m.name));
  if (lcp.length <= partial.length) return null; // no progress
  return joinAfterSplit(parent, lcp);
}

/** Re-join a `splitForCompletion` parent with a tail, normalizing the
 *  separator to a single forward slash. Trailing slash on parent is
 *  collapsed so we don't emit `//`. */
function joinAfterSplit(parent: string, tail: string): string {
  if (!parent) return tail;
  const trimmed = parent.replace(/[\\/]+$/, "");
  return `${trimmed}/${tail}`;
}
