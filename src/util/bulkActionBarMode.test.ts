// Regression tests for the BulkActionBar dense-mode resolver
// (Bug 6). Three modes wired in 0.2.278:
//   - "auto"   → mirrors the pre-0.2.278 behavior, dense iff
//                two-pane mode (labels wrap at half-width).
//   - "labels" → always labeled, even in two-pane mode.
//   - "icons"  → always icon-only with tooltips.
// Without this resolver baked into a pure helper, the three-mode
// matrix could silently drift back to the boolean ternary that
// shipped pre-Bug 6.
import { describe, expect, it } from "vitest";
import { resolveBulkActionBarDense } from "./bulkActionBarMode";

describe("resolveBulkActionBarDense", () => {
  it("auto: dense iff two-pane mode (mirrors the 0.2.270 default)", () => {
    expect(resolveBulkActionBarDense("auto", false)).toBe(false);
    expect(resolveBulkActionBarDense("auto", true)).toBe(true);
  });

  it("labels: never dense, regardless of pane mode", () => {
    expect(resolveBulkActionBarDense("labels", false)).toBe(false);
    expect(resolveBulkActionBarDense("labels", true)).toBe(false);
  });

  it("icons: always dense, regardless of pane mode", () => {
    expect(resolveBulkActionBarDense("icons", false)).toBe(true);
    expect(resolveBulkActionBarDense("icons", true)).toBe(true);
  });
});
