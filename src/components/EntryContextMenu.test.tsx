import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import EntryContextMenu from "./EntryContextMenu";
import type { Entry } from "../api/fs";

const theme = createTheme();

const file: Entry = {
  name: "x.txt",
  path: "/x.txt",
  kind: "text",
  size: 5,
  mtime: null,
  isDir: false,
  isSymlink: false,
  isHidden: false,
  mode: null,
};

const folder: Entry = { ...file, name: "sub", path: "/sub", isDir: true, kind: "folder" };

function r(state: { entry: Entry; x: number; y: number } | null) {
  const handlers = {
    onClose: vi.fn(),
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onTrash: vi.fn(),
    onCopyPath: vi.fn(),
    onProperties: vi.fn(),
    onBookmark: vi.fn(),
    onOpenWithDefault: vi.fn(),
    onRevealInOs: vi.fn(),
  };
  render(
    <ThemeProvider theme={theme}>
      <EntryContextMenu state={state} {...handlers} />
    </ThemeProvider>,
  );
  return handlers;
}

describe("EntryContextMenu", () => {
  it("renders nothing when state is null", () => {
    r(null);
    expect(screen.queryByText("Rename…")).not.toBeInTheDocument();
  });

  it("shows Open only for directories", () => {
    r({ entry: file, x: 10, y: 10 });
    expect(screen.queryByText("Open")).not.toBeInTheDocument();
    expect(screen.getByText("Rename…")).toBeInTheDocument();
  });

  it("shows Open + Rename + Move to Trash for a directory", () => {
    r({ entry: folder, x: 10, y: 10 });
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Rename…")).toBeInTheDocument();
    expect(screen.getByText("Move to Trash")).toBeInTheDocument();
  });

  it("Rename calls onRename + onClose", () => {
    const h = r({ entry: file, x: 10, y: 10 });
    fireEvent.click(screen.getByText("Rename…"));
    expect(h.onRename).toHaveBeenCalledWith(file);
    expect(h.onClose).toHaveBeenCalled();
  });

  it("Move to Trash calls onTrash", () => {
    const h = r({ entry: file, x: 10, y: 10 });
    fireEvent.click(screen.getByText("Move to Trash"));
    expect(h.onTrash).toHaveBeenCalledWith(file);
  });

  it("Copy path calls onCopyPath", () => {
    const h = r({ entry: file, x: 10, y: 10 });
    fireEvent.click(screen.getByText("Copy path"));
    expect(h.onCopyPath).toHaveBeenCalledWith(file);
  });

  it("Properties calls onProperties", () => {
    const h = r({ entry: file, x: 10, y: 10 });
    fireEvent.click(screen.getByText("Properties…"));
    expect(h.onProperties).toHaveBeenCalledWith(file);
  });

  it("Add to bookmarks shows only for directories and calls onBookmark", () => {
    // Files don't get the bookmark item.
    const h1 = r({ entry: file, x: 10, y: 10 });
    expect(screen.queryByText("Add to bookmarks")).not.toBeInTheDocument();
    expect(h1.onBookmark).not.toHaveBeenCalled();
  });

  it("directories show Add to bookmarks and call onBookmark", () => {
    const h = r({ entry: folder, x: 10, y: 10 });
    fireEvent.click(screen.getByText("Add to bookmarks"));
    expect(h.onBookmark).toHaveBeenCalledWith(folder);
  });

  it("file shows Open with default + Reveal in OS for local entries", () => {
    const h = r({ entry: file, x: 10, y: 10 });
    expect(screen.getByText("Open with default app")).toBeInTheDocument();
    expect(screen.getByText("Reveal in OS")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open with default app"));
    expect(h.onOpenWithDefault).toHaveBeenCalledWith(file);
  });

  it("hides OS-shell items for remote (sftp://) entries", () => {
    const remote: Entry = { ...file, path: "sftp://abc/x.txt" };
    r({ entry: remote, x: 10, y: 10 });
    expect(
      screen.queryByText("Open with default app"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Reveal in OS")).not.toBeInTheDocument();
  });

  it("Reveal in OS calls onRevealInOs for local entries", () => {
    const h = r({ entry: folder, x: 10, y: 10 });
    fireEvent.click(screen.getByText("Reveal in OS"));
    expect(h.onRevealInOs).toHaveBeenCalledWith(folder);
  });
});
