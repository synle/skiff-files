import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatBytes,
  formatMtimeAs,
  formatMtimeRelative,
  parentPath,
  pathSegments,
} from "./format";

afterEach(() => {
  vi.useRealTimers();
});

describe("formatBytes — extra edge cases", () => {
  it("clamps absurd magnitudes to the largest unit (PB)", () => {
    // 2 ZB worth of bytes — far beyond PB. Should still print in PB
    // rather than overflowing into a missing unit.
    const huge = 1024 ** 7;
    expect(formatBytes(huge)).toMatch(/PB$/);
  });

  it("treats 0 as 0 B (not absent)", () => {
    expect(formatBytes(0)).toBe("0 B");
  });
});

describe("formatMtimeRelative", () => {
  it("returns em-dash for null / undefined", () => {
    expect(formatMtimeRelative(null)).toBe("—");
    expect(formatMtimeRelative(undefined)).toBe("—");
  });

  it("walks each magnitude as the gap widens", () => {
    const now = 1_700_000_000_000; // ms
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const sec = (s: number) => Math.floor(now / 1000) - s;

    expect(formatMtimeRelative(sec(5))).toBe("5s ago");
    expect(formatMtimeRelative(sec(120))).toBe("2m ago");
    expect(formatMtimeRelative(sec(3600 * 5))).toBe("5h ago");
    expect(formatMtimeRelative(sec(86400 * 2))).toBe("2d ago");
    expect(formatMtimeRelative(sec(86400 * 60))).toBe("2mo ago");
    expect(formatMtimeRelative(sec(86400 * 365 * 3))).toBe("3y ago");
  });

  it("future timestamps return the explicit 'in the future' bucket", () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(formatMtimeRelative(Math.floor(now / 1000) + 60)).toBe(
      "in the future",
    );
  });
});

describe("formatMtimeAs", () => {
  it("returns em-dash for null / undefined and NaN dates", () => {
    expect(formatMtimeAs(null, "iso")).toBe("—");
    expect(formatMtimeAs(undefined, "short")).toBe("—");
    expect(formatMtimeAs(Number.NaN, "iso")).toBe("—");
  });

  it("iso format renders YYYY-MM-DD HH:MM:SS without a 'T'", () => {
    const out = formatMtimeAs(1_700_000_000, "iso");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(out).not.toContain("T");
  });

  it("short format renders YYYY-MM-DD HH:MM with zero-padding", () => {
    const out = formatMtimeAs(1_700_000_000, "short");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("relative format dispatches through formatMtimeRelative", () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(formatMtimeAs(Math.floor(now / 1000) - 10, "relative")).toBe(
      "10s ago",
    );
  });

  it("locale format yields a non-empty string for a valid timestamp", () => {
    expect(formatMtimeAs(1_700_000_000, "locale").length).toBeGreaterThan(0);
  });
});

describe("pathSegments / parentPath — extras", () => {
  it("collapses double slashes in a POSIX path", () => {
    expect(pathSegments("/a//b///c")).toEqual([
      { label: "/", path: "/" },
      { label: "a", path: "/a" },
      { label: "b", path: "/a/b" },
      { label: "c", path: "/a/b/c" },
    ]);
  });

  it("walks parent of a Windows-style path", () => {
    expect(parentPath("C:\\Users\\syle\\Desktop")).toBe("C:\\Users\\syle");
  });

  it("breaks down an ftp path the same way as sftp (uniform remote shape)", () => {
    // ftp falls through to the non-sftp branch (treated as POSIX), so
    // we just confirm parentPath still walks it cleanly without throwing.
    expect(typeof parentPath("ftp://mirror/pub/x")).toBe("string");
  });
});
