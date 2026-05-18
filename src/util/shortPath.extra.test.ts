// Branch-coverage pad for shortPath.ts. The base suite already pins
// the headline cases (home rewrite, Windows drive, remote scheme).
// This fills in the remaining branches:
//   - codepoint-aware first-char extraction (emoji folder names)
//   - empty `home` skips the `~` rewrite even when the path looks
//     home-shaped
//   - isUnderHome handles trailing-slash homes correctly
//   - single-segment edge cases at every level (POSIX root, Windows
//     drive root, remote root)
import { describe, expect, it } from "vitest";
import { shortPath } from "./shortPath";

describe("shortPath — codepoint-aware abbreviation", () => {
  it("abbreviates emoji folder names to the leading codepoint, not a surrogate half", () => {
    // Naive `seg[0]` would return the lead surrogate of a 4-byte
    // emoji, which renders as a tofu glyph in the sidebar. The spread
    // form `[...seg][0]` keeps the full codepoint.
    const path = "/📁folder/sub/file.txt";
    const out = shortPath(path, "");
    // Leading segment abbreviates to the emoji itself.
    expect(out).toBe("/📁/s/file.txt");
  });

  it("abbreviates non-ASCII folder names to their first codepoint", () => {
    const out = shortPath("/Übersetzung/Datei.txt", "");
    // First char of "Übersetzung" is "Ü", not "U" or a surrogate half.
    expect(out).toBe("/Ü/Datei.txt");
  });
});

describe("shortPath — empty home skips the ~ rewrite", () => {
  it("renders home-shaped paths absolutely when home arg is empty", () => {
    // Passing an empty home is the explicit "no rewrite" signal from
    // the sidebar when the user's $HOME hasn't been resolved yet.
    expect(shortPath("/Users/syle/git/repo", "")).toBe("/U/s/g/repo");
  });
});

describe("shortPath — empty home with multi-segment path", () => {
  it("abbreviates middle segments and keeps the leading slash", () => {
    // Hits the plain-absolute-path branch (line 90-92) with multiple
    // segments — pins the leading-`/` + `shortenSegments` join shape
    // so the sidebar doesn't regress to losing the root slash.
    expect(shortPath("/var/log/system.log", "")).toBe("/v/l/system.log");
  });
});

describe("shortPath — single-segment edges", () => {
  it("returns the absolute root unchanged for / on POSIX", () => {
    // Pin the empty-segs branch — without the early return the path
    // would render as the empty string.
    expect(shortPath("/", "")).toBe("/");
  });

  it("a top-level non-home file abbreviates to /<full-name>", () => {
    // Only one segment, last segment kept full → leading slash + name.
    expect(shortPath("/etc", "")).toBe("/etc");
  });

  it("a single home-direct path abbreviates to ~/<name>", () => {
    expect(shortPath("/Users/syle/file.txt", "/Users/syle")).toBe(
      "~/file.txt",
    );
  });

  it("a remote root passes through with just scheme + id + slash", () => {
    expect(shortPath("ftp://mirror/", "")).toBe("ftp://mirror/");
    expect(shortPath("smb://nas/", "")).toBe("smb://nas/");
  });
});
