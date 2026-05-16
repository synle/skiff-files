// Regression tests for the rubber-band hit-test. Bug 9 (0.2.281)
// was a missing scrollbar-gutter skip: the rubber-band onMouseDown
// in FileList preventDefault'd clicks on the scrollbar track, so
// dragging the scrollbar thumb didn't scroll the (very long) list.
// Without these tests the bug could silently come back if someone
// rewrites the handler without remembering the gutter rule.
import { describe, expect, it } from "vitest";
import { shouldStartRubberBand } from "./rubberBandHitTest";

/** Helper — build a container with a 600x400 box, a 15px-wide
 *  scrollbar gutter on the right, and no horizontal gutter. */
function box(): import("./rubberBandHitTest").RubberBandContainerLike {
  return {
    rect: { left: 0, top: 0, right: 600, bottom: 400 },
    clientWidth: 585, // 600 - 15px gutter
    clientHeight: 400,
  };
}

describe("shouldStartRubberBand", () => {
  it("starts on a click inside the content area", () => {
    expect(shouldStartRubberBand(100, 100, box())).toBe(true);
  });

  it("skips a click on the vertical scrollbar gutter (Bug 9)", () => {
    // Anywhere in xRel >= clientWidth (the rightmost 15px) is the
    // gutter — must NOT start the drag.
    expect(shouldStartRubberBand(590, 100, box())).toBe(false);
    expect(shouldStartRubberBand(599, 200, box())).toBe(false);
  });

  it("skips a click on the horizontal scrollbar gutter", () => {
    const b = { ...box(), clientHeight: 385 }; // 15px gutter at bottom
    expect(shouldStartRubberBand(100, 390, b)).toBe(false);
  });

  it("skips clicks outside the container bbox entirely", () => {
    const b = box();
    expect(shouldStartRubberBand(-1, 100, b)).toBe(false);
    expect(shouldStartRubberBand(700, 100, b)).toBe(false);
    expect(shouldStartRubberBand(100, -1, b)).toBe(false);
    expect(shouldStartRubberBand(100, 500, b)).toBe(false);
  });

  it("starts at the top-left corner of the content area", () => {
    // Boundary check — left=0, top=0 is inside.
    expect(shouldStartRubberBand(0, 0, box())).toBe(true);
  });

  it("does NOT start exactly on the gutter boundary", () => {
    // xRel === clientWidth lands on the first pixel of the gutter.
    expect(shouldStartRubberBand(585, 100, box())).toBe(false);
  });
});
