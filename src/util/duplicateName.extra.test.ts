// Branch-coverage pad for duplicateName.ts. The original suite covers
// the happy paths + the strip-and-replace contract. These add:
//   - sequence-suffix collision: when the bare base + `-2` are both
//     taken, we keep walking up (-3, -4, ...) — exercised here at -4
//     specifically so the loop body in `uniqueDuplicateName` runs.
//   - dotfile + isDir paths through uniqueDuplicateName.
//   - default options (no `now`, no `isDir`) take the implicit
//     `new Date()` clock without throwing.
import { describe, expect, it, vi, afterEach } from "vitest";
import { duplicateName, uniqueDuplicateName } from "./duplicateName";

afterEach(() => {
  vi.useRealTimers();
});

const NOW = new Date(2026, 4, 8, 13, 22);

describe("uniqueDuplicateName — collision walk", () => {
  it("walks past several collision suffixes (-2, -3, -4) before settling", () => {
    const taken = new Set([
      "notes-copy-2026-05-08-13-22.md",
      "notes-copy-2026-05-08-13-22-2.md",
      "notes-copy-2026-05-08-13-22-3.md",
      "notes-copy-2026-05-08-13-22-4.md",
    ]);
    expect(uniqueDuplicateName("notes.md", taken, { now: NOW })).toBe(
      "notes-copy-2026-05-08-13-22-5.md",
    );
  });

  it("collision suffix on a folder lands at the very end (no ext split)", () => {
    const taken = new Set([
      "Project-copy-2026-05-08-13-22",
      "Project-copy-2026-05-08-13-22-2",
    ]);
    expect(
      uniqueDuplicateName("Project", taken, { isDir: true, now: NOW }),
    ).toBe("Project-copy-2026-05-08-13-22-3");
  });

  it("dotfile collisions append the suffix at the end (no ext split)", () => {
    const taken = new Set([".env-copy-2026-05-08-13-22"]);
    // Dotfiles have empty ext via splitExt (dot index 0 → stem only),
    // so the collision suffix lands at the bare end.
    expect(uniqueDuplicateName(".env", taken, { now: NOW })).toBe(
      ".env-copy-2026-05-08-13-22-2",
    );
  });
});

describe("duplicateName — default-options branches", () => {
  it("uses new Date() when no `now` is provided", () => {
    // Pin a fake clock and ensure the produced stamp matches it. This
    // exercises the `options?.now ?? new Date()` fallback branch.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 0, 2, 3, 4));
    const out = duplicateName("a.txt");
    expect(out).toBe("a-copy-2030-01-02-03-04.txt");
  });

  it("uses isDir=false by default (splits ext)", () => {
    // Default isDir false → ext split runs → `.tar.gz` ext kept on the
    // tail because lastIndexOf finds the dot before `gz`.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 0, 2, 3, 4));
    expect(duplicateName("archive.tar.gz")).toBe(
      "archive.tar-copy-2030-01-02-03-04.gz",
    );
  });
});
