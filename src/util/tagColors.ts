// Color tokens for Finder-style file tags. Keep this central so the
// FileList row dot, the Sidebar / future filter UI, and the
// EntryContextMenu submenu all read from the same palette.
import type { TagColor } from "../state/settings";

/** All seven Finder-style colors in canonical display order. The
 *  context-menu submenu and any future "filter by tag" surface read
 *  from this list, so the order is the user-facing order. */
export const TAG_COLORS: TagColor[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "gray",
];

/** Resolve a tag to a CSS color. Picked to read well on both light
 *  and dark backgrounds without per-mode swap (a small dot doesn't
 *  need contrast tuning the way a full text run would). */
export function tagColorHex(tag: TagColor): string {
  switch (tag) {
    case "red":
      return "#ef5350";
    case "orange":
      return "#ff9800";
    case "yellow":
      return "#fdd835";
    case "green":
      return "#66bb6a";
    case "blue":
      return "#42a5f5";
    case "purple":
      return "#ab47bc";
    case "gray":
      return "#9e9e9e";
  }
}

/** Pretty label for the Settings / context-menu listing. */
export function tagColorLabel(tag: TagColor): string {
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}
