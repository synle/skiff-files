// Unit tests for the EXIF orientation → CSS transform mapping.
// Covers the 8 valid orientation values + the no-op fallthroughs
// (null / undefined / out-of-range).
import { describe, expect, it } from "vitest";
import {
  orientationSwapsDimensions,
  orientationToCssTransform,
} from "./exifOrientation";

describe("orientationToCssTransform", () => {
  it("returns null for upright (1) and missing orientations", () => {
    expect(orientationToCssTransform(1)).toBeNull();
    expect(orientationToCssTransform(null)).toBeNull();
    expect(orientationToCssTransform(undefined)).toBeNull();
    expect(orientationToCssTransform(0)).toBeNull();
    expect(orientationToCssTransform(9)).toBeNull();
    expect(orientationToCssTransform(-1)).toBeNull();
  });
  it("maps each 90° rotation to a `rotate(<deg>)` snippet", () => {
    // Rotation-only cases: 3, 6, 8.
    expect(orientationToCssTransform(3)).toBe("rotate(180deg)");
    expect(orientationToCssTransform(6)).toBe("rotate(90deg)");
    expect(orientationToCssTransform(8)).toBe("rotate(270deg)");
  });
  it("maps mirror cases with the right scale + rotate composition", () => {
    expect(orientationToCssTransform(2)).toBe("scaleX(-1)");
    expect(orientationToCssTransform(4)).toBe("scaleY(-1)");
    expect(orientationToCssTransform(5)).toBe("scaleX(-1) rotate(270deg)");
    expect(orientationToCssTransform(7)).toBe("scaleX(-1) rotate(90deg)");
  });
});

describe("orientationSwapsDimensions", () => {
  it("returns true only for 90° rotation cases (5/6/7/8)", () => {
    expect(orientationSwapsDimensions(5)).toBe(true);
    expect(orientationSwapsDimensions(6)).toBe(true);
    expect(orientationSwapsDimensions(7)).toBe(true);
    expect(orientationSwapsDimensions(8)).toBe(true);
  });
  it("returns false for upright / 180° / mirror-only / missing", () => {
    expect(orientationSwapsDimensions(1)).toBe(false);
    expect(orientationSwapsDimensions(2)).toBe(false);
    expect(orientationSwapsDimensions(3)).toBe(false);
    expect(orientationSwapsDimensions(4)).toBe(false);
    expect(orientationSwapsDimensions(null)).toBe(false);
    expect(orientationSwapsDimensions(undefined)).toBe(false);
  });
});
