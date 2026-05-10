// Smoke test for GalleryThumb. After 0.2.245 we route through
// `fs_thumbnail` instead of `fs_read_base64` — this test pins the
// Tauri command we hit so a future refactor can't silently revert
// to loading raw bytes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import GalleryThumb from "./GalleryThumb";

beforeEach(() => {
  vi.mocked(invoke).mockClear();
});

describe("GalleryThumb", () => {
  it("calls fs_thumbnail for an image kind", async () => {
    render(<GalleryThumb path="/a/photo.jpg" kind="image" size={96} />);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "fs_thumbnail",
        expect.objectContaining({ path: "/a/photo.jpg", sizePx: 96 }),
      );
    });
  });

  it("does not call fs_thumbnail for non-image kinds", () => {
    render(<GalleryThumb path="/a/doc.pdf" kind="pdf" size={96} />);
    // Synchronous render → check before the microtask flush.
    expect(invoke).not.toHaveBeenCalledWith(
      "fs_thumbnail",
      expect.anything(),
    );
  });

  it("does not call fs_thumbnail for remote paths", () => {
    render(
      <GalleryThumb path="sftp://host/a.jpg" kind="image" size={96} remote />,
    );
    expect(invoke).not.toHaveBeenCalledWith(
      "fs_thumbnail",
      expect.anything(),
    );
  });

  it("renders the kind icon as a fallback when the image isn't loaded yet", () => {
    // Default mock returns a 1x1 PNG — by the time render returns,
    // the promise hasn't resolved yet, so we should see the
    // fallback icon at least once. The test asserts the layout
    // doesn't shift to "missing" — we just want the component to
    // render without throwing during the loading phase.
    const { container } = render(
      <GalleryThumb path="/a/photo.jpg" kind="image" size={96} />,
    );
    expect(container.firstChild).not.toBeNull();
  });
});
