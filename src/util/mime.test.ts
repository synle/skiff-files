import { describe, it, expect } from "vitest";
import { isImage, mimeForPath } from "./mime";

describe("mimeForPath", () => {
  it("returns the right mime for known extensions", () => {
    expect(mimeForPath("/x/foo.png")).toBe("image/png");
    expect(mimeForPath("/x/foo.JPG")).toBe("image/jpeg");
    expect(mimeForPath("/x/foo.svg")).toBe("image/svg+xml");
    expect(mimeForPath("/x/foo.mp4")).toBe("video/mp4");
    expect(mimeForPath("/x/foo.pdf")).toBe("application/pdf");
  });

  it("returns null for unknown / extensionless paths", () => {
    expect(mimeForPath("/x/foo.xyz")).toBeNull();
    expect(mimeForPath("/x/README")).toBeNull();
  });
});

describe("isImage", () => {
  it("recognizes image extensions", () => {
    expect(isImage("/x/a.png")).toBe(true);
    expect(isImage("/x/a.gif")).toBe(true);
    expect(isImage("/x/a.JPG")).toBe(true);
  });

  it("rejects non-images", () => {
    expect(isImage("/x/a.mp4")).toBe(false);
    expect(isImage("/x/a.txt")).toBe(false);
    expect(isImage("/x/README")).toBe(false);
  });
});
