// Helper for cleaning stale entries (paths the OS no longer has) out
// of the recent-paths + bookmarks lists.
//
// Pure — pulled out of the App.tsx mount effect so the filtering
// logic is unit-testable without spinning up the full provider tree.
// `statFn` is injected so tests can supply a deterministic stub.

/** A user can have a remote bookmark / recent entry that we can't
 *  stat without an active SFTP session — we never prune those. The
 *  `sftp://` prefix is the marker (and matches the existing
 *  `util/location` scheme). */
function isRemote(path: string): boolean {
  return path.startsWith("sftp://");
}

/** Probe each local path. Resolved → keep. Errored → drop.
 *  Remote paths are kept unconditionally. Returns the same array
 *  identity if nothing changed (so a useEffect comparing references
 *  doesn't re-render). */
export async function pruneStalePaths(
  paths: string[],
  statFn: (p: string) => Promise<unknown>,
): Promise<string[]> {
  if (paths.length === 0) return paths;
  const results = await Promise.all(
    paths.map(async (p) => {
      if (isRemote(p)) return { path: p, alive: true };
      try {
        await statFn(p);
        return { path: p, alive: true };
      } catch {
        return { path: p, alive: false };
      }
    }),
  );
  const next = results.filter((r) => r.alive).map((r) => r.path);
  // Reference-stable when nothing was pruned — saves a settings
  // round-trip on every cold start.
  if (next.length === paths.length) return paths;
  return next;
}

/** Bookmarks are objects with a `path`; same prune rule applies. We
 *  preserve the shape of every kept entry (label, id) — only `path`
 *  is consulted for the existence check. */
export async function pruneStaleBookmarks<T extends { path: string }>(
  bookmarks: T[],
  statFn: (p: string) => Promise<unknown>,
): Promise<T[]> {
  if (bookmarks.length === 0) return bookmarks;
  const results = await Promise.all(
    bookmarks.map(async (b) => {
      if (isRemote(b.path)) return { entry: b, alive: true };
      try {
        await statFn(b.path);
        return { entry: b, alive: true };
      } catch {
        return { entry: b, alive: false };
      }
    }),
  );
  const next = results.filter((r) => r.alive).map((r) => r.entry);
  if (next.length === bookmarks.length) return bookmarks;
  return next;
}
