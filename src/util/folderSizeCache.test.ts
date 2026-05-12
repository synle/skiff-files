import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  _resetFolderSizeCacheForTests,
  fetchFolderSize,
  getCachedFolderSize,
} from "./folderSizeCache";

const mocked = vi.mocked(invoke);

beforeEach(() => {
  _resetFolderSizeCacheForTests();
  mocked.mockClear();
});

afterEach(() => {
  _resetFolderSizeCacheForTests();
});

describe("folderSizeCache", () => {
  it("returns null when nothing is cached", () => {
    expect(getCachedFolderSize("/never-fetched")).toBeNull();
  });

  it("fetches via dirSummary on the first call and caches the result", async () => {
    mocked.mockResolvedValueOnce({ entries: 7, totalSize: 1234, truncated: false });
    const out = await fetchFolderSize("/folder");
    expect(out).toEqual({ entries: 7, totalSize: 1234, truncated: false });
    expect(getCachedFolderSize("/folder")).toEqual(out);
  });

  it("subsequent fetches reuse the cache (no new invoke)", async () => {
    mocked.mockResolvedValueOnce({ entries: 1, totalSize: 1, truncated: false });
    await fetchFolderSize("/cached");
    const callsAfterFirst = mocked.mock.calls.length;
    const second = await fetchFolderSize("/cached");
    expect(second).toEqual({ entries: 1, totalSize: 1, truncated: false });
    // No new invoke between the two awaits.
    expect(mocked.mock.calls.length).toBe(callsAfterFirst);
  });

  it("coalesces concurrent in-flight requests into one invoke", async () => {
    let resolveFn: (v: { entries: number; totalSize: number; truncated: boolean }) => void = () => {};
    const promise = new Promise<{
      entries: number;
      totalSize: number;
      truncated: boolean;
    }>((res) => {
      resolveFn = res;
    });
    mocked.mockReturnValueOnce(promise);

    const a = fetchFolderSize("/parallel");
    const b = fetchFolderSize("/parallel");
    // Both await the same Promise; the second call must NOT re-invoke.
    const dirSummaryCalls = mocked.mock.calls.filter(
      (c) => c[0] === "fs_dir_summary",
    );
    expect(dirSummaryCalls.length).toBe(1);
    resolveFn({ entries: 2, totalSize: 200, truncated: false });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual(rb);
  });

  it("propagates errors and does not poison the cache", async () => {
    mocked.mockRejectedValueOnce(new Error("boom"));
    await expect(fetchFolderSize("/error")).rejects.toThrow("boom");
    expect(getCachedFolderSize("/error")).toBeNull();
    // Next call should attempt a fresh fetch.
    mocked.mockResolvedValueOnce({ entries: 1, totalSize: 1, truncated: false });
    await expect(fetchFolderSize("/error")).resolves.toEqual({
      entries: 1,
      totalSize: 1,
      truncated: false,
    });
  });
});
