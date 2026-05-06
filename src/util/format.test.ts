import { describe, it, expect } from "vitest";
import { formatBytes, formatMtime, parentPath, pathSegments } from "./format";

describe("formatBytes", () => {
  it("returns bytes literally below 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("scales to KB / MB / GB with one-decimal precision under 10", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(1024 * 1024 * 1.5)).toBe("1.5 MB");
    expect(formatBytes(1024 * 1024 * 50)).toBe("50 MB");
    expect(formatBytes(1024 ** 3 * 2)).toBe("2.0 GB");
  });

  it("returns em-dash for invalid input", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("formatMtime", () => {
  it("returns em-dash for null/undefined", () => {
    expect(formatMtime(null)).toBe("—");
    expect(formatMtime(undefined)).toBe("—");
  });

  it("returns a non-empty string for a valid unix second", () => {
    // Locale-dependent — assert non-empty only.
    expect(formatMtime(1700000000)).not.toBe("—");
    expect(formatMtime(1700000000).length).toBeGreaterThan(0);
  });
});

describe("pathSegments", () => {
  it("breaks down a POSIX path", () => {
    expect(pathSegments("/Users/syle/git")).toEqual([
      { label: "/", path: "/" },
      { label: "Users", path: "/Users" },
      { label: "syle", path: "/Users/syle" },
      { label: "git", path: "/Users/syle/git" },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(pathSegments("")).toEqual([]);
  });

  it("breaks down a Windows path with drive letter", () => {
    const segs = pathSegments("C:\\Users\\syle\\Desktop");
    expect(segs[0].label).toBe("C:");
    expect(segs[0].path).toBe("C:\\");
    expect(segs.at(-1)?.label).toBe("Desktop");
  });
});

describe("parentPath", () => {
  it("returns the parent of a POSIX path", () => {
    expect(parentPath("/Users/syle/git")).toBe("/Users/syle");
    expect(parentPath("/Users")).toBe("/");
  });

  it("returns the path itself at the root", () => {
    expect(parentPath("/")).toBe("/");
  });

  it("handles empty input as identity", () => {
    expect(parentPath("")).toBe("");
  });

  it("walks up an sftp path", () => {
    expect(parentPath("sftp://abc/home/foo/bar")).toBe("sftp://abc/home/foo");
    expect(parentPath("sftp://abc/home")).toBe("sftp://abc/");
  });

  it("stops at the sftp root", () => {
    expect(parentPath("sftp://abc/")).toBe("sftp://abc/");
  });
});

describe("pathSegments — sftp", () => {
  it("breaks down an sftp path with the connection id as the first segment", () => {
    const segs = pathSegments("sftp://abc/home/foo");
    expect(segs).toEqual([
      { label: "abc", path: "sftp://abc/" },
      { label: "home", path: "sftp://abc/home" },
      { label: "foo", path: "sftp://abc/home/foo" },
    ]);
  });

  it("renders an sftp root with just the id", () => {
    const segs = pathSegments("sftp://abc/");
    expect(segs).toEqual([{ label: "abc", path: "sftp://abc/" }]);
  });
});
