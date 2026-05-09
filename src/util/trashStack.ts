// In-session stack of trashed-path batches. Cmd/Ctrl+Z pops the most
// recent batch and asks Rust to restore it via the OS trash API
// (`fs_trash_restore`). Linux + Windows fully supported by the
// `trash` crate's `os_limited::restore_all`; macOS gets a friendly
// error since the crate doesn't surface a programmatic-restore API
// on that platform.
//
// Why session-only? Persisting across restarts would require us to
// retain trash entry IDs in settings.json, but those identifiers are
// platform-specific (Windows: SID + GUID; Linux: trashinfo file path)
// and stale fast — a user emptying Trash between sessions would
// invalidate them all silently. Session-only matches Finder/Explorer's
// Cmd+Z reach (current session only) and keeps the data flow simple.

interface TrashBatch {
  /** Original full paths that were trashed. Only locals are recorded —
   *  remote (sftp://) deletes go through `conn_remove` which is
   *  permanent, so there's nothing to undo. */
  paths: string[];
  /** Wall-clock time of the trash, used only for tooltip / debugging. */
  trashedAt: number;
}

const stack: TrashBatch[] = [];

/** Cap so a session that does thousands of deletes doesn't grow
 *  unbounded. The user is realistically only going to undo a handful
 *  of recent trashes anyway. */
const MAX_STACK = 50;

export function pushTrashBatch(paths: string[]): void {
  // Filter out remotes — they don't go to OS trash, so they can't be
  // restored from there. Same reasoning as the doc comment above.
  const locals = paths.filter((p) => !p.startsWith("sftp://"));
  if (locals.length === 0) return;
  stack.push({ paths: locals, trashedAt: Date.now() });
  while (stack.length > MAX_STACK) stack.shift();
}

export function popTrashBatch(): TrashBatch | null {
  return stack.pop() ?? null;
}

/** Read-only view, used by tests + the Settings → Advanced "Recent
 *  trash" diagnostic surface (future). */
export function trashStackSnapshot(): readonly TrashBatch[] {
  return [...stack];
}

/** Test helper. Only call from tests. */
export function _resetTrashStackForTests(): void {
  stack.length = 0;
}
