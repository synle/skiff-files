import { describe, expect, it } from "vitest";
import { completePath, splitForCompletion } from "./autocomplete";

describe("splitForCompletion — empty input branch", () => {
  it("returns an all-empty result for an empty string", () => {
    expect(splitForCompletion("")).toEqual({ parent: "", partial: "" });
  });
});

describe("completePath — no-parent branch", () => {
  it("emits the tail alone when there's no parent (cwd-style input)", () => {
    // Partial 'sr' with no separator → splitForCompletion returns
    // parent: "", which exercises the joinAfterSplit fast-path.
    // 'sr' matches src + scripts → LCP 's'? Actually no: scripts vs src
    // share only 's'. But the partial 'sr' is already longer than 's',
    // so LCP <= partial → null (no progress). Use a partial that does
    // make progress instead.
    expect(
      completePath("s", [
        { name: "src", isDir: true },
        { name: "src-tauri", isDir: true },
      ]),
    ).toBe("src");
  });

  it("emits the tail with a trailing / for single-dir match when parent is empty", () => {
    expect(
      completePath("sr", [{ name: "src", isDir: true }]),
    ).toBe("src/");
  });
});
