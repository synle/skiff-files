// EXIF Orientation tag → CSS transform mapping.
//
// JPEG / HEIC files commonly carry an Orientation tag (1–8) that
// every photo viewer is expected to honor on display. Phone cameras
// write rotated sensors with an Orientation tag instead of rotating
// pixel data, so a landscape shot from an iPhone is encoded portrait
// + orientation=6 ("rotate 90° CW for display"). Without this mapping
// the user sees the same picture sideways here vs Photos.app.
//
// Values:
//   1 — upright, no transform.
//   2 — mirrored horizontally.
//   3 — rotated 180°.
//   4 — mirrored vertically.
//   5 — mirrored horizontally then rotated 90° CCW.
//   6 — rotated 90° CW.
//   7 — mirrored horizontally then rotated 90° CW.
//   8 — rotated 90° CCW.
//
// We return a CSS `transform` string (or `null` for the no-op case)
// rather than discrete rotation + scale numbers so the consumer can
// concatenate it with its own zoom transform in a single matrix.

/** Map an EXIF orientation value to the CSS `transform` snippet that
 *  re-uprights the image. Returns `null` for orientation 1 (already
 *  upright) and for any value outside the 1–8 valid range. */
export function orientationToCssTransform(
  orientation: number | null | undefined,
): string | null {
  switch (orientation) {
    case 2:
      return "scaleX(-1)";
    case 3:
      return "rotate(180deg)";
    case 4:
      return "scaleY(-1)";
    case 5:
      return "scaleX(-1) rotate(270deg)";
    case 6:
      return "rotate(90deg)";
    case 7:
      return "scaleX(-1) rotate(90deg)";
    case 8:
      return "rotate(270deg)";
    default:
      return null;
  }
}

/** True when the orientation tag implies the displayed dimensions
 *  are swapped relative to the natural pixel dimensions (i.e. the
 *  image was captured in portrait sensor mode but should display
 *  landscape, or vice versa). Used by the wrapper layout so the
 *  bounding box for the rotated image picks up the swapped
 *  width / height. */
export function orientationSwapsDimensions(
  orientation: number | null | undefined,
): boolean {
  return (
    orientation === 5 ||
    orientation === 6 ||
    orientation === 7 ||
    orientation === 8
  );
}
