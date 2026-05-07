import { describe, it, expect } from "vitest";
import {
  completePath,
  longestCommonPrefix,
  splitForCompletion,
} from "./autocomplete";

describe("splitForCompletion", () => {
  it("splits at the last separator", () => {
    expect(splitForCompletion("/Users/syle/git/file")).toEqual({
      parent: "/Users/syle/git",
      partial: "file",
    });
  });

  it("treats trailing slash as 'list this folder'", () => {
    expect(splitForCompletion("/Users/syle/")).toEqual({
      parent: "/Users/syle",
      partial: "",
    });
  });

  it("treats no-separator input as a partial in the cwd", () => {
    expect(splitForCompletion("foo")).toEqual({ parent: "", partial: "foo" });
  });

  it("normalizes a root-only parent to /", () => {
    expect(splitForCompletion("/foo")).toEqual({
      parent: "/",
      partial: "foo",
    });
  });

  it("supports Windows path separators too", () => {
    expect(splitForCompletion("C:\\Users\\syle\\Desk")).toEqual({
      parent: "C:\\Users\\syle",
      partial: "Desk",
    });
  });
});

describe("longestCommonPrefix", () => {
  it("returns empty for an empty array", () => {
    expect(longestCommonPrefix([])).toBe("");
  });

  it("returns the only string for a single-element array", () => {
    expect(longestCommonPrefix(["foo"])).toBe("foo");
  });

  it("computes the prefix shared by every entry", () => {
    expect(longestCommonPrefix(["foobar", "foobaz", "foobat"])).toBe("fooba");
    expect(longestCommonPrefix(["foo", "bar"])).toBe("");
    expect(longestCommonPrefix(["abc", "abc"])).toBe("abc");
  });
});

describe("completePath", () => {
  const entries = [
    { name: "src", isDir: true },
    { name: "src-tauri", isDir: true },
    { name: "scripts", isDir: true },
    { name: "package.json", isDir: false },
  ];

  it("returns null when nothing matches", () => {
    expect(completePath("/foo/zzz", entries)).toBeNull();
  });

  it("completes a single match fully + appends / for dirs", () => {
    expect(completePath("/foo/sc", entries)).toBe("/foo/scripts/");
  });

  it("completes to LCP for a multi-match", () => {
    // 'sr' matches src + src-tauri → LCP = 'src'
    expect(completePath("/foo/sr", entries)).toBe("/foo/src");
  });

  it("returns null when the LCP would not extend the partial", () => {
    // 'src' matches src + src-tauri → LCP = 'src' which equals the
    // partial; no progress, so no replacement.
    expect(completePath("/foo/src", entries)).toBeNull();
  });

  it("does not append a slash for files", () => {
    expect(completePath("/foo/pack", entries)).toBe("/foo/package.json");
  });

  it("is case-insensitive on the prefix match", () => {
    expect(completePath("/foo/SRC-T", entries)).toBe("/foo/src-tauri/");
  });
});
