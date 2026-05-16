// Regression tests for the Cmd+V paste orchestrator.
//
// Both regressions live in here so they can't reopen silently:
//   - Bug 1 (image #4/#5): after pasting 2 files into an SMB folder,
//     only one showed until manual refresh. Root cause:
//     `sync_start_*` returns when the job is QUEUED, not when bytes
//     have landed. We must refresh once `sync:done` fires per job.
//   - Bug 2 (image #6): the "Paste 2 items" toolbar pill remained
//     after a paste, inviting accidental duplicate pastes. We clear
//     the clipboard up-front when paste starts.
import { describe, expect, it, vi } from "vitest";
import { runPaste, type PasteDeps } from "./pasteFlow";
import type { Summary } from "../api/sync";

/** Build a `Summary` matching the engine's `sync:done` payload shape.
 *  Default fields are no-op values — tests only care about `jobId`. */
function makeSummary(jobId: string): Summary {
  return {
    jobId,
    copied: 1,
    skipped: 0,
    conflicts: 0,
    errors: 0,
    bytesCopied: 1,
    cancelled: false,
  };
}

/** Factory for a `PasteDeps` test double. Returns the deps + a manual
 *  trigger that fires the registered `sync:done` listener so the test
 *  controls the timing precisely. */
function makeDeps(over: Partial<PasteDeps> = {}) {
  let doneListener: ((s: Summary) => void) | null = null;
  const refresh = vi.fn();
  const clearClipboard = vi.fn();
  const removeOrTrashMany = vi.fn().mockResolvedValue(undefined);
  const onError = vi.fn();
  const stat = vi.fn(async (p: string) => ({
    name: p.split("/").pop() ?? p,
    isDir: false,
  }));
  let jobIdCounter = 0;
  const startSync = vi.fn(async () => `job-${++jobIdCounter}`);
  const onDone = vi.fn(async (cb: (s: Summary) => void) => {
    doneListener = cb;
    return () => { doneListener = null; };
  });
  const deps: PasteDeps = {
    stat,
    startSync,
    refresh,
    onDone,
    clearClipboard,
    removeOrTrashMany,
    onError,
    currentPath: () => "/dest",
    doneTimeoutMs: 1_000,
    ...over,
  };
  return {
    deps,
    refresh,
    clearClipboard,
    removeOrTrashMany,
    onError,
    startSync,
    stat,
    onDone,
    fireDone: (id: string) => doneListener?.(makeSummary(id)),
  };
}

describe("runPaste", () => {
  it("clears the file clipboard up-front (Bug 2)", async () => {
    // Even before any sync_start_* resolves, the toolbar pill must
    // disappear. Verifies the contract regardless of network latency.
    const { deps, clearClipboard } = makeDeps();
    await runPaste(
      { paths: ["/src/a.png"], operation: "copy" },
      "/dest",
      deps,
    );
    expect(clearClipboard).toHaveBeenCalledTimes(1);
  });

  it("refreshes the destination after each sync:done fires (Bug 1)", async () => {
    // Two-file paste — the destination must refresh as each job
    // lands, not only after the initial dispatch returns. Mirrors the
    // SMB scenario from image #4/#5.
    const { deps, refresh, fireDone } = makeDeps();
    const { jobIds } = await runPaste(
      { paths: ["/src/a.png", "/src/b.png"], operation: "copy" },
      "/dest",
      deps,
    );
    expect(jobIds.size).toBe(2);
    // Optimistic post-dispatch refresh.
    expect(refresh).toHaveBeenCalledWith("/dest");
    const before = refresh.mock.calls.length;
    // Fire sync:done for each queued job. Each one should refresh.
    for (const id of jobIds) fireDone(id);
    expect(refresh.mock.calls.length).toBeGreaterThan(before);
    // Last refresh call must target the original destFolder (the
    // user might have navigated away, but currentPath() returns the
    // same folder here).
    expect(refresh).toHaveBeenLastCalledWith("/dest");
  });

  it("dispatches one sync per source with the right dest shape", async () => {
    // Sources that are directories get their basename appended to the
    // destination folder; file sources land directly under destFolder.
    const customStat = vi.fn(async (p: string) => ({
      name: p.split("/").pop() ?? p,
      isDir: p.endsWith("/folder"),
    }));
    const { deps, startSync } = makeDeps({ stat: customStat });
    await runPaste(
      { paths: ["/src/file.txt", "/src/folder"], operation: "copy" },
      "/dest",
      deps,
    );
    expect(customStat).toHaveBeenCalledTimes(2);
    expect(startSync).toHaveBeenCalledWith("/src/file.txt", "/dest");
    expect(startSync).toHaveBeenCalledWith("/src/folder", "/dest/folder");
  });

  it("removes sources after every cut-paste job completes (symmetric path)", async () => {
    // Pair with the copy-paste case above. On `cut` we must:
    //   1) still clear the clipboard up-front (Bug 2),
    //   2) wait for ALL syncs to finish before removing sources,
    //   3) refresh the destination after the removal lands.
    const { deps, removeOrTrashMany, fireDone } = makeDeps();
    const { jobIds } = await runPaste(
      { paths: ["/src/a", "/src/b"], operation: "cut" },
      "/dest",
      deps,
    );
    expect(removeOrTrashMany).not.toHaveBeenCalled();
    const ids = Array.from(jobIds);
    fireDone(ids[0]);
    // First job done — sources must not be removed yet (the second
    // is still copying).
    expect(removeOrTrashMany).not.toHaveBeenCalled();
    fireDone(ids[1]);
    // Both jobs done — removal kicks in with all original sources.
    expect(removeOrTrashMany).toHaveBeenCalledWith(["/src/a", "/src/b"]);
  });

  it("skips refresh when the user has navigated away mid-paste", async () => {
    // The `currentPath()` test seam returns a non-matching folder, so
    // the orchestrator must not refresh someone else's tab.
    const refresh = vi.fn();
    const { deps, fireDone } = makeDeps({
      refresh,
      currentPath: () => "/somewhere/else",
    });
    const { jobIds } = await runPaste(
      { paths: ["/src/a"], operation: "copy" },
      "/dest",
      deps,
    );
    for (const id of jobIds) fireDone(id);
    // Optimistic refresh + per-done refresh both gated on currentPath
    // == destFolder. Neither must have fired.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("surfaces per-source stat errors via onError, continues other sources", async () => {
    // One bad source mustn't abort the whole paste — the per-item
    // try/catch is load-bearing for partial-success behavior.
    const { deps, onError, startSync } = makeDeps({
      stat: vi.fn(async (p: string) => {
        if (p === "/src/bad") throw new Error("stat failed");
        return { name: p.split("/").pop() ?? p, isDir: false };
      }),
    });
    await runPaste(
      { paths: ["/src/bad", "/src/good"], operation: "copy" },
      "/dest",
      deps,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(startSync).toHaveBeenCalledTimes(1);
    expect(startSync).toHaveBeenCalledWith("/src/good", "/dest");
  });
});
