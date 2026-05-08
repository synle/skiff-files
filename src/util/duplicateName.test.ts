// duplicateName tests — pin down the exact stamp shape + the
// strip-and-replace semantics for re-duplicates. Uses a fixed
// `now` so the assertions are deterministic.

import { describe, it, expect } from "vitest";
import { duplicateName, uniqueDuplicateName } from "./duplicateName";

const NOW = new Date(2026, 4, 8, 13, 22); // 2026-05-08 13:22 local

describe("duplicateName", () => {
  it("appends -copy-YYYY-MM-DD-HH-MM to a file (preserves extension)", () => {
    expect(duplicateName("notes.md", { now: NOW })).toBe(
      "notes-copy-2026-05-08-13-22.md",
    );
  });

  it("appends suffix to a folder (no extension split)", () => {
    expect(duplicateName("My Project", { isDir: true, now: NOW })).toBe(
      "My Project-copy-2026-05-08-13-22",
    );
  });

  it("strips a previous -copy-<timestamp> suffix before re-appending", () => {
    const once = duplicateName("notes.md", { now: NOW });
    // Pretend the user re-duplicates 5 minutes later.
    const later = new Date(2026, 4, 8, 13, 27);
    expect(duplicateName(once, { now: later })).toBe(
      "notes-copy-2026-05-08-13-27.md",
    );
  });

  it("strip-and-replace also works for folders", () => {
    const once = duplicateName("My Project", { isDir: true, now: NOW });
    const later = new Date(2026, 4, 8, 14, 0);
    expect(
      duplicateName(once, { isDir: true, now: later }),
    ).toBe("My Project-copy-2026-05-08-14-00");
  });

  it("uses 2-digit zero-padded month / day / hour / minute", () => {
    const earlyJan = new Date(2026, 0, 3, 5, 7);
    expect(duplicateName("a.txt", { now: earlyJan })).toBe(
      "a-copy-2026-01-03-05-07.txt",
    );
  });

  it("dotfiles (no real extension) keep their leading dot", () => {
    expect(duplicateName(".env", { now: NOW })).toBe(
      ".env-copy-2026-05-08-13-22",
    );
  });

  it("does NOT strip a suffix that just looks similar", () => {
    // -copy-2026 alone (without full timestamp) shouldn't match.
    expect(duplicateName("backup-copy-2026.txt", { now: NOW })).toBe(
      "backup-copy-2026-copy-2026-05-08-13-22.txt",
    );
  });

  it("strips a -copy-<ts>-N collision suffix before re-appending", () => {
    // Bug: `untitled-copy-2026-05-08-13-32-2.txt` → after re-dup
    // used to become `untitled-copy-…-32-2-copy-…-22.txt`.
    expect(
      duplicateName("untitled-copy-2026-05-08-13-32-2.txt", { now: NOW }),
    ).toBe("untitled-copy-2026-05-08-13-22.txt");
  });

  it("strips multiple stacked -copy-<ts> suffixes", () => {
    // If a previous bug produced a doubled-up name, the next
    // duplicate should clean it back to the original.
    expect(
      duplicateName(
        "notes-copy-2026-05-08-13-22-2-copy-2026-05-08-13-32.md",
        { now: NOW },
      ),
    ).toBe("notes-copy-2026-05-08-13-22.md");
  });
});

describe("uniqueDuplicateName", () => {
  it("returns the base name when no collision", () => {
    expect(
      uniqueDuplicateName("notes.md", new Set(), { now: NOW }),
    ).toBe("notes-copy-2026-05-08-13-22.md");
  });

  it("appends -2 on a same-minute collision", () => {
    const taken = new Set(["notes-copy-2026-05-08-13-22.md"]);
    expect(uniqueDuplicateName("notes.md", taken, { now: NOW })).toBe(
      "notes-copy-2026-05-08-13-22-2.md",
    );
  });

  it("walks past -2, -3 etc.", () => {
    const taken = new Set([
      "notes-copy-2026-05-08-13-22.md",
      "notes-copy-2026-05-08-13-22-2.md",
      "notes-copy-2026-05-08-13-22-3.md",
    ]);
    expect(uniqueDuplicateName("notes.md", taken, { now: NOW })).toBe(
      "notes-copy-2026-05-08-13-22-4.md",
    );
  });

  it("collision suffix lands BEFORE the extension", () => {
    const taken = new Set(["a-copy-2026-05-08-13-22.txt"]);
    const out = uniqueDuplicateName("a.txt", taken, { now: NOW });
    expect(out).toMatch(/\.txt$/);
    expect(out).toBe("a-copy-2026-05-08-13-22-2.txt");
  });
});
