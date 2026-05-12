import { describe, expect, it } from "vitest";
import { TAG_COLORS, tagColorHex, tagColorLabel } from "./tagColors";

describe("TAG_COLORS", () => {
  it("ships the seven canonical Finder colors in display order", () => {
    expect(TAG_COLORS).toEqual([
      "red",
      "orange",
      "yellow",
      "green",
      "blue",
      "purple",
      "gray",
    ]);
  });
});

describe("tagColorHex", () => {
  it("returns a valid 7-char hex for every tag", () => {
    for (const tag of TAG_COLORS) {
      const hex = tagColorHex(tag);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("returns distinct hex values for each tag", () => {
    const hexes = TAG_COLORS.map(tagColorHex);
    expect(new Set(hexes).size).toBe(TAG_COLORS.length);
  });

  it("returns the right hex for known anchors", () => {
    // Pin a few specific values so a palette tweak surfaces in review.
    expect(tagColorHex("red")).toBe("#ef5350");
    expect(tagColorHex("gray")).toBe("#9e9e9e");
  });
});

describe("tagColorLabel", () => {
  it("capitalizes the first letter", () => {
    expect(tagColorLabel("red")).toBe("Red");
    expect(tagColorLabel("purple")).toBe("Purple");
  });
});
