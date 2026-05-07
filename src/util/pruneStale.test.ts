import { describe, it, expect, vi } from "vitest";
import { pruneStaleBookmarks, pruneStalePaths } from "./pruneStale";

/** Stub stat that resolves for the named survivors and rejects for
 *  everything else. */
function statStub(survivors: string[]) {
  return vi.fn(async (p: string) => {
    if (survivors.includes(p)) return {};
    throw new Error("ENOENT");
  });
}

describe("pruneStalePaths", () => {
  it("drops paths whose stat rejects", async () => {
    const out = await pruneStalePaths(
      ["/keep", "/dead", "/also-keep"],
      statStub(["/keep", "/also-keep"]),
    );
    expect(out).toEqual(["/keep", "/also-keep"]);
  });

  it("returns the same reference when nothing was pruned", async () => {
    const input = ["/a", "/b"];
    const out = await pruneStalePaths(input, statStub(["/a", "/b"]));
    expect(out).toBe(input);
  });

  it("returns the same (empty) reference for an empty input", async () => {
    const input: string[] = [];
    const out = await pruneStalePaths(input, statStub([]));
    expect(out).toBe(input);
  });

  it("never stat's remote paths and keeps them as-is", async () => {
    const stat = vi.fn(async () => {
      throw new Error("should not be called");
    });
    const out = await pruneStalePaths(["sftp://abc/x"], stat);
    expect(out).toEqual(["sftp://abc/x"]);
    expect(stat).not.toHaveBeenCalled();
  });
});

describe("pruneStaleBookmarks", () => {
  it("drops bookmark objects whose path no longer stats", async () => {
    const out = await pruneStaleBookmarks(
      [
        { id: "1", label: "kept", path: "/keep" },
        { id: "2", label: "dead", path: "/dead" },
      ],
      statStub(["/keep"]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("1");
  });

  it("preserves non-path fields for kept bookmarks", async () => {
    const input = [{ id: "1", label: "x", path: "/keep" }];
    const out = await pruneStaleBookmarks(input, statStub(["/keep"]));
    expect(out[0]).toEqual(input[0]);
  });

  it("keeps remote bookmarks without stat'ing", async () => {
    const stat = vi.fn(async () => {
      throw new Error("should not be called");
    });
    const out = await pruneStaleBookmarks(
      [{ id: "1", label: "remote", path: "sftp://abc/x" }],
      stat,
    );
    expect(out).toHaveLength(1);
    expect(stat).not.toHaveBeenCalled();
  });
});
