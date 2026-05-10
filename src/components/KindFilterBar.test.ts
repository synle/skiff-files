import { describe, expect, it } from "vitest";
import { entryMatchesFilter, entryMatchesRecency } from "./KindFilterBar";

describe("entryMatchesFilter", () => {
  it("returns true for empty active list (no filter)", () => {
    expect(entryMatchesFilter("image", [])).toBe(true);
  });

  it("matches when the entry's kind is in any active group", () => {
    expect(entryMatchesFilter("image", ["image"])).toBe(true);
    expect(entryMatchesFilter("text", ["document"])).toBe(true);
    expect(entryMatchesFilter("pdf", ["document"])).toBe(true);
  });

  it("returns false when the entry's kind isn't in any active group", () => {
    expect(entryMatchesFilter("image", ["document"])).toBe(false);
    expect(entryMatchesFilter("audio", ["folder", "image"])).toBe(false);
  });
});

describe("entryMatchesRecency", () => {
  // Use a fixed "now" via Math.floor so the boundary checks are
  // stable across the test run without mocking the clock. We compare
  // against the current calendar day implicitly through Date.now()
  // but pass mtimes that are clearly inside / outside each window.
  const nowSec = Math.floor(Date.now() / 1000);

  it("returns true for null recency (no filter)", () => {
    expect(entryMatchesRecency(nowSec, null)).toBe(true);
    expect(entryMatchesRecency(null, null)).toBe(true);
  });

  it("returns false when mtime is missing + recency is set", () => {
    expect(entryMatchesRecency(null, "today")).toBe(false);
  });

  it("includes a freshly-modified entry in 'today'", () => {
    expect(entryMatchesRecency(nowSec, "today")).toBe(true);
  });

  it("excludes a year-old entry from 'today'", () => {
    expect(entryMatchesRecency(nowSec - 365 * 86400, "today")).toBe(false);
  });

  it("excludes a year-old entry from 'week'", () => {
    expect(entryMatchesRecency(nowSec - 365 * 86400, "week")).toBe(false);
  });

  it("excludes a year-old entry from 'month'", () => {
    expect(entryMatchesRecency(nowSec - 365 * 86400, "month")).toBe(false);
  });
});
