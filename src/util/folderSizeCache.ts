// Lazy folder-size cache for the "hover-a-folder-row → see its
// recursive size in a tooltip" UX. The dir summary is non-trivially
// expensive (recursive walk) for big folders, so we:
//   1. only fetch on a hover that lingers ≥ 800ms,
//   2. dedupe in-flight fetches per-path,
//   3. cache the result for the lifetime of the page so a second
//      hover is instant.
//
// Cache TTL isn't enforced — entries are cheap (~24 bytes each) and
// the dir contents may change anyway. Eviction happens on tab close
// (module reload) which matches the user's mental model.

import { dirSummary } from "../api/client";
import type { DirSummary } from "../api/fs";

const cache = new Map<string, DirSummary>();
const inflight = new Map<string, Promise<DirSummary>>();

export function getCachedFolderSize(path: string): DirSummary | null {
  return cache.get(path) ?? null;
}

/** Fetch (or return cached) summary. Multiple concurrent calls for
 *  the same path coalesce into one network round-trip. */
export async function fetchFolderSize(path: string): Promise<DirSummary> {
  const cached = cache.get(path);
  if (cached) return cached;
  const pending = inflight.get(path);
  if (pending) return pending;
  const p = dirSummary(path)
    .then((s) => {
      cache.set(path, s);
      return s;
    })
    .finally(() => {
      inflight.delete(path);
    });
  inflight.set(path, p);
  return p;
}

/** Test helper. */
export function _resetFolderSizeCacheForTests(): void {
  cache.clear();
  inflight.clear();
}
