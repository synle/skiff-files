import { describe, expect, it } from "vitest";
import { isImage, mimeForPath } from "./mime";

describe("mimeForPath — every audio/video/image branch", () => {
  it("audio extensions", () => {
    expect(mimeForPath("/a.mp3")).toBe("audio/mpeg");
    expect(mimeForPath("/a.wav")).toBe("audio/wav");
    expect(mimeForPath("/a.ogg")).toBe("audio/ogg");
    expect(mimeForPath("/a.m4a")).toBe("audio/mp4");
    expect(mimeForPath("/a.aac")).toBe("audio/aac");
    expect(mimeForPath("/a.flac")).toBe("audio/flac");
  });

  it("video extensions", () => {
    expect(mimeForPath("/v.mp4")).toBe("video/mp4");
    expect(mimeForPath("/v.webm")).toBe("video/webm");
    expect(mimeForPath("/v.mov")).toBe("video/quicktime");
    expect(mimeForPath("/v.mkv")).toBe("video/x-matroska");
  });

  it("image extensions including the less-common ones", () => {
    expect(mimeForPath("/i.png")).toBe("image/png");
    expect(mimeForPath("/i.jpeg")).toBe("image/jpeg");
    expect(mimeForPath("/i.gif")).toBe("image/gif");
    expect(mimeForPath("/i.webp")).toBe("image/webp");
    expect(mimeForPath("/i.bmp")).toBe("image/bmp");
    expect(mimeForPath("/i.avif")).toBe("image/avif");
    expect(mimeForPath("/i.ico")).toBe("image/x-icon");
  });

  it("isImage rejects audio + video paths", () => {
    expect(isImage("/v.mp4")).toBe(false);
    expect(isImage("/a.mp3")).toBe(false);
  });

  it("isImage is true for SVG (image/svg+xml starts with image/)", () => {
    expect(isImage("/i.svg")).toBe(true);
  });
});
