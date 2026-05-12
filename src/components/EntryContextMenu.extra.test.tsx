import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

const folder: Entry = {
  ...file,
  name: "sub",
  path: "/sub",
  isDir: true,
  kind: "folder",
};

const zip: Entry = {
  ...file,
  name: "bundle.zip",
  path: "/bundle.zip",
  kind: "archive",
};

function r(
  state: { entry: Entry; x: number; y: number } | null,
  over: Partial<Parameters<typeof EntryContextMenu>[0]> = {},
) {
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
    onOpenInTerminal: vi.fn(),
    onOpenInNewTab: vi.fn(),
    onCompareWith: vi.fn(),
    onDuplicate: vi.fn(),
    onCompressZip: vi.fn(),
    onExtractZip: vi.fn(),
    onViewArchive: vi.fn(),
    onSetTag: vi.fn(),
  };
  render(
    <ThemeProvider theme={theme}>
      <EntryContextMenu state={state} {...handlers} {...over} />
    </ThemeProvider>,
  );
  return handlers;
}

describe("EntryContextMenu — extras", () => {
  it("Open on a directory fires onOpen + onClose", () => {
    const h = r({ entry: folder, x: 0, y: 0 });
    fireEvent.click(screen.getByText("Open"));
    expect(h.onOpen).toHaveBeenCalledWith(folder);
    expect(h.onClose).toHaveBeenCalled();
  });

  it("Open in new tab appears only for directories", () => {
    r({ entry: file, x: 0, y: 0 });
    expect(screen.queryByText(/Open in new tab/)).toBeNull();
  });

  it("Open in new tab for a directory fires onOpenInNewTab", () => {
    const h = r({ entry: folder, x: 0, y: 0 });
    fireEvent.click(screen.getByText(/Open in new tab/));
    expect(h.onOpenInNewTab).toHaveBeenCalledWith(folder);
  });

  it("Duplicate fires onDuplicate for local entries", () => {
    const h = r({ entry: file, x: 0, y: 0 });
    fireEvent.click(screen.getByText("Duplicate"));
    expect(h.onDuplicate).toHaveBeenCalledWith(file);
  });

  it("Compress to zip fires onCompressZip for local entries", () => {
    const h = r({ entry: file, x: 0, y: 0 });
    fireEvent.click(screen.getByText(/Compress to zip/));
    expect(h.onCompressZip).toHaveBeenCalledWith(file);
  });

  it("Extract to folder appears only for .zip files", () => {
    const h = r({ entry: zip, x: 0, y: 0 });
    fireEvent.click(screen.getByText("Extract here"));
    expect(h.onExtractZip).toHaveBeenCalledWith(zip);
  });

  it("View contents item only renders for archive files", () => {
    const h = r({ entry: zip, x: 0, y: 0 });
    fireEvent.click(screen.getByText("View contents"));
    expect(h.onViewArchive).toHaveBeenCalledWith(zip);
  });

  it("Compare with appears for files, hidden for folders", () => {
    r({ entry: file, x: 0, y: 0 });
    expect(screen.getByText(/Compare with/)).toBeInTheDocument();
  });

  it("Compare with reads 'Compare with this file' once a base is pending", () => {
    r({ entry: file, x: 0, y: 0 }, { comparePending: true });
    expect(
      screen.getByText("Compare with this file"),
    ).toBeInTheDocument();
  });

  it("Tag color dot click fires onSetTag with the picked color", () => {
    const h = r({ entry: file, x: 0, y: 0 });
    fireEvent.click(screen.getByLabelText("Tag Red"));
    expect(h.onSetTag).toHaveBeenCalledWith(file, "red");
  });

  it("Clear tag button appears when currentTag is set", () => {
    const h = r({ entry: file, x: 0, y: 0 }, { currentTag: "red" });
    fireEvent.click(screen.getByLabelText("Clear tag"));
    expect(h.onSetTag).toHaveBeenCalledWith(file, null);
  });
});
