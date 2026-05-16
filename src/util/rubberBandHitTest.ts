// Pure hit-test for the FileList rubber-band selection. Decides
// whether a mousedown at (clientX, clientY) inside a scroll container
// should start a rubber-band drag, or whether it landed on the
// scrollbar gutter / outside the container and must be ignored so
// the native scrollbar drag still works (Bug 9, image #19/#20:
// dragging the scrollbar in a 4800-file SMB folder failed to move
// the view because the rubber-band handler `preventDefault`'d it).
//
// Two virtualizers in `FileList.tsx` (gallery + list view) both
// share this rule; extracting it here means the math has a single
// test target.

/** Minimal scroll-container shape — accepts a real `HTMLElement` at
 *  runtime and a hand-rolled stub in tests. */
export interface RubberBandContainerLike {
  /** Page-space bounding rect (the value `el.getBoundingClientRect()`
   *  returns at runtime). Tests pass a plain object. */
  rect: { left: number; top: number; right: number; bottom: number };
  /** Inner content width (excludes the vertical scrollbar gutter). */
  clientWidth: number;
  /** Inner content height (excludes the horizontal scrollbar gutter). */
  clientHeight: number;
}

/** True iff a mousedown at (clientX, clientY) should *start* the
 *  rubber-band drag. Returns false when the click landed on the
 *  scrollbar gutter or outside the container — callers must then
 *  early-return WITHOUT calling `preventDefault`, so the native
 *  scrollbar drag survives. */
export function shouldStartRubberBand(
  clientX: number,
  clientY: number,
  container: RubberBandContainerLike,
): boolean {
  const { rect } = container;
  // Outside the container's page-space rect → no.
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return false;
  }
  // On the vertical scrollbar gutter (right of `clientWidth`) or
  // the horizontal scrollbar gutter (below `clientHeight`) → no.
  // `clientWidth` / `clientHeight` exclude the scrollbar tracks, so
  // the gutter sits between them and the right / bottom edge.
  const xRel = clientX - rect.left;
  const yRel = clientY - rect.top;
  if (xRel >= container.clientWidth || yRel >= container.clientHeight) {
    return false;
  }
  return true;
}
