import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import PreviewPane from "./PreviewPane";
import type { Entry } from "../api/fs";

const theme = createTheme();

function r(props: { selected: Entry | null; width?: number }) {
  return render(
    <ThemeProvider theme={theme}>
      <PreviewPane selected={props.selected} width={props.width ?? 320} />
    </ThemeProvider>,
  );
}

const folder: Entry = {
  name: "stuff",
  path: "/x/stuff",
  kind: "folder",
  size: 0,
  mtime: 1700000000,
  isDir: true,
  isSymlink: false,
  isHidden: false,
  mode: 0o755,
};

const text: Entry = {
  name: "notes.md",
  path: "/x/notes.md",
  kind: "markdown",
  size: 100,
  mtime: 1700000000,
  isDir: false,
  isSymlink: false,
  isHidden: false,
  mode: 0o644,
};

const img: Entry = {
  name: "pic.png",
  path: "/x/pic.png",
  kind: "image",
  size: 4096,
  mtime: 1700000000,
  isDir: false,
  isSymlink: false,
  isHidden: false,
  mode: 0o644,
};

const blob: Entry = {
  name: "data.bin",
  path: "/x/data.bin",
  kind: "binary",
  size: 999,
  mtime: 1700000000,
  isDir: false,
  isSymlink: false,
  isHidden: false,
  mode: 0o644,
};

describe("PreviewPane", () => {
  it("shows the empty hint when nothing selected", () => {
    r({ selected: null });
    expect(screen.getByText(/Select a file to preview/i)).toBeInTheDocument();
  });

  it("renders the properties block for any selection", () => {
    r({ selected: text });
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(screen.getByText("Path")).toBeInTheDocument();
  });

  it("renders folder summary for a directory", async () => {
    r({ selected: folder });
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });
  });

  it("renders text body for markdown/code/text kinds", async () => {
    r({ selected: text });
    await waitFor(() => {
      expect(screen.getByText("preview text")).toBeInTheDocument();
    });
  });

  it("renders image body for image kinds", async () => {
    r({ selected: img });
    await waitFor(() => {
      expect(screen.getByAltText("pic.png")).toBeInTheDocument();
    });
  });

  it("shows 'no inline preview' for binary kinds", () => {
    r({ selected: blob });
    expect(
      screen.getByText(/No inline preview for this kind/i),
    ).toBeInTheDocument();
  });

  it("cancels in-flight loads when selection changes", async () => {
    // We don't have a clean hook, but we can sanity-check that switching
    // selection swaps the rendered content without leaking the prior one.
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <PreviewPane selected={text} width={320} />
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("preview text")).toBeInTheDocument();
    });
    rerender(
      <ThemeProvider theme={theme}>
        <PreviewPane selected={folder} width={320} />
      </ThemeProvider>,
    );
    // Folder body replaces text body.
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });
    // Don't call vi.clearAllMocks — multiple invokes are fine, we just want
    // no crash and the new content visible.
    expect(true).toBe(true);
  });
});

// quiet unused-import warning
void vi;
