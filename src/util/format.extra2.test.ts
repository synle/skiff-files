// Branch-coverage pad for format.ts. Hits the corners the earlier
// suites left uncovered:
//   - formatMtime: NaN unix-second short-circuits to "—" (the OS
//     occasionally hands us NaN-as-mtime when a stat fails inside a
//     mount, and we used to render "Invalid Date" instead).
//   - formatMtimeRelative: non-finite diff (Infinity input) short-
//     circuits to "—" — same root cause; protects the breadcrumb
//     tooltip from rendering "NaNs ago".
//   - pathSegments: smb:// and ftp:// produce per-scheme breadcrumb
//     segments. Without an explicit case the PathBar would walk the
//     user past the share root — exactly bug #74–76. The
//     `.extra.test.ts` suite covered the parentPath side; this pads
//     out the segments-side branch.
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  formatMtime,
  formatMtimeAs,
  formatMtimeRelative,
  pathSegments,
} from "./format";

afterEach(() => {
  vi.useRealTimers();
});

describe("formatMtime — NaN guard", () => {
  it("renders '—' for NaN unix seconds rather than 'Invalid Date'", () => {
    // Surfaced when an underlying stat() bubbled NaN up through the
    // engine (some SMB drivers do this on permission-denied files).
    expect(formatMtime(Number.NaN)).toBe("—");
  });

  it("renders '—' for explicit null and undefined inputs", () => {
    // Sanity check, even though format.test.ts covers the same path —
    // keeps the NaN regression in the same suite as the explicit-null
    // path so any future single-file refactor sees them together.
    expect(formatMtime(null)).toBe("—");
    expect(formatMtime(undefined)).toBe("—");
  });
});

describe("formatMtimeRelative — non-finite guard", () => {
  it("renders '—' when diff is non-finite (Infinity input)", () => {
    // Date(Infinity * 1000) yields an Invalid Date whose getTime() is
    // NaN, so the (nowSec - unixSeconds) subtraction blows up to
    // -Infinity. The guard returns "—" rather than letting the
    // negative-Infinity fall through to "in the future".
    expect(formatMtimeRelative(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatMtimeRelative(Number.NEGATIVE_INFINITY)).toBe("—");
  });

  it("renders '—' when unixSeconds is NaN", () => {
    expect(formatMtimeRelative(Number.NaN)).toBe("—");
  });

  it("formatMtimeAs('relative') propagates the non-finite guard", () => {
    expect(formatMtimeAs(Number.POSITIVE_INFINITY, "relative")).toBe("—");
  });
});

describe("pathSegments — smb:// scheme", () => {
  it("produces per-segment breadcrumbs with the smb:// scheme + connection id intact", () => {
    expect(pathSegments("smb://nas-1/Public/folder/file.txt")).toEqual([
      { label: "nas-1", path: "smb://nas-1/" },
      { label: "Public", path: "smb://nas-1/Public" },
      { label: "folder", path: "smb://nas-1/Public/folder" },
      { label: "file.txt", path: "smb://nas-1/Public/folder/file.txt" },
    ]);
  });

  it("renders an smb root with just the id", () => {
    expect(pathSegments("smb://nas-1/")).toEqual([
      { label: "nas-1", path: "smb://nas-1/" },
    ]);
  });

  it("handles smb without trailing slash (single-token after scheme)", () => {
    // Edge case from the address bar — user typed `smb://host` with
    // no trailing `/`. Should still produce the root segment so the
    // breadcrumb renders.
    expect(pathSegments("smb://host")).toEqual([
      { label: "host", path: "smb://host/" },
    ]);
  });
});

describe("pathSegments — ftp:// scheme", () => {
  it("produces per-segment breadcrumbs with the ftp:// scheme intact", () => {
    expect(pathSegments("ftp://mirror-1/pub/release/file.iso")).toEqual([
      { label: "mirror-1", path: "ftp://mirror-1/" },
      { label: "pub", path: "ftp://mirror-1/pub" },
      { label: "release", path: "ftp://mirror-1/pub/release" },
      { label: "file.iso", path: "ftp://mirror-1/pub/release/file.iso" },
    ]);
  });

  it("renders an ftp root with just the id", () => {
    expect(pathSegments("ftp://mirror-1/")).toEqual([
      { label: "mirror-1", path: "ftp://mirror-1/" },
    ]);
  });
});

describe("pathSegments — Windows edge cases", () => {
  it("returns only the drive segment for a bare drive root", () => {
    // Earlier shape would have produced just the drive — pin it so
    // any future refactor doesn't accidentally tack on an empty
    // segment when the drive root is the whole path.
    const segs = pathSegments("C:\\");
    expect(segs).toHaveLength(1);
    expect(segs[0].label).toBe("C:");
    expect(segs[0].path).toBe("C:\\");
  });
});
