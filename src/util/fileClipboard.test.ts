import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FILE_CLIPBOARD_EVENT,
  clearFileClipboard,
  getFileClipboard,
  setFileClipboard,
} from "./fileClipboard";

afterEach(() => {
  clearFileClipboard();
});

describe("fileClipboard", () => {
  it("starts empty", () => {
    expect(getFileClipboard()).toBeNull();
  });

  it("setFileClipboard stores a defensive copy of the paths", () => {
    const paths = ["/a", "/b"];
    setFileClipboard(paths, "copy");
    paths.push("/mutated");
    expect(getFileClipboard()).toEqual({
      paths: ["/a", "/b"],
      operation: "copy",
    });
  });

  it("setFileClipboard with an empty list clears the clipboard", () => {
    setFileClipboard(["/a"], "cut");
    setFileClipboard([], "copy");
    expect(getFileClipboard()).toBeNull();
  });

  it("clearFileClipboard nulls out the current entry", () => {
    setFileClipboard(["/a"], "cut");
    clearFileClipboard();
    expect(getFileClipboard()).toBeNull();
  });

  it("dispatches a window event on set and clear (symmetric paths)", () => {
    const listener = vi.fn();
    window.addEventListener(FILE_CLIPBOARD_EVENT, listener);
    try {
      setFileClipboard(["/a"], "copy");
      expect(listener).toHaveBeenCalledTimes(1);
      clearFileClipboard();
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(FILE_CLIPBOARD_EVENT, listener);
    }
  });

  it("preserves the cut operation distinct from copy", () => {
    setFileClipboard(["/a"], "cut");
    expect(getFileClipboard()?.operation).toBe("cut");
    setFileClipboard(["/a"], "copy");
    expect(getFileClipboard()?.operation).toBe("copy");
  });
});
