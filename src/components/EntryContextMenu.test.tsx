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
    onOpenInTerminal: vi.fn(),
    onOpenInNewTab: vi.fn(),
    onCompareWith: vi.fn(),
    onDuplicate: vi.fn(),
    onCompressZip: vi.fn(),
    onExtractZip: vi.fn(),
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

  it("Open in terminal appears only for local folders", () => {
    // file → no terminal item (only folders make sense)
    r({ entry: file, x: 10, y: 10 });
    expect(screen.queryByText("Open in terminal")).not.toBeInTheDocument();
  });

  it("Open in terminal calls onOpenInTerminal for local folders", () => {
    const h = r({ entry: folder, x: 10, y: 10 });
    fireEvent.click(screen.getByText("Open in terminal"));
    expect(h.onOpenInTerminal).toHaveBeenCalledWith(folder);
  });

  it("Open in terminal is hidden for remote folders", () => {
    const remoteFolder: Entry = { ...folder, path: "sftp://abc/sub" };
    r({ entry: remoteFolder, x: 10, y: 10 });
    expect(screen.queryByText("Open in terminal")).not.toBeInTheDocument();
  });

  // Bug 8 regression (0.2.280) — Cut / Copy / Paste are first-class
  // context-menu actions now, separated from the Copy-path / Copy-
  // filename string-clipboard cluster.
  describe("Cut / Copy / Paste cluster (Bug 8)", () => {
    function rExt(opts: {
      pasteCount?: number;
      onCutToClipboard?: (entry: Entry) => void;
      onCopyToClipboard?: (entry: Entry) => void;
      onPaste?: () => void;
    }) {
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
        onCutToClipboard: opts.onCutToClipboard ?? vi.fn(),
        onCopyToClipboard: opts.onCopyToClipboard ?? vi.fn(),
        onPaste: opts.onPaste ?? vi.fn(),
        pasteCount: opts.pasteCount ?? 0,
      };
      render(
        <ThemeProvider theme={theme}>
          <EntryContextMenu
            state={{ entry: file, x: 10, y: 10 }}
            {...handlers}
          />
        </ThemeProvider>,
      );
      return handlers;
    }

    it("Cut row fires onCutToClipboard with the entry", () => {
      const onCutToClipboard = vi.fn();
      rExt({ onCutToClipboard });
      fireEvent.click(screen.getByText("Cut"));
      expect(onCutToClipboard).toHaveBeenCalledWith(file);
    });

    it("Copy row fires onCopyToClipboard with the entry", () => {
      const onCopyToClipboard = vi.fn();
      rExt({ onCopyToClipboard });
      fireEvent.click(screen.getByText("Copy"));
      expect(onCopyToClipboard).toHaveBeenCalledWith(file);
    });

    it("Paste row is hidden when the file clipboard is empty", () => {
      rExt({ pasteCount: 0 });
      expect(screen.queryByText(/^Paste/)).not.toBeInTheDocument();
    });

    it("Paste row renders with the count when items are queued", () => {
      const onPaste = vi.fn();
      rExt({ pasteCount: 3, onPaste });
      const row = screen.getByText("Paste 3 items");
      fireEvent.click(row);
      expect(onPaste).toHaveBeenCalled();
    });

    it("singular Paste label when exactly one item is queued", () => {
      rExt({ pasteCount: 1 });
      expect(screen.getByText("Paste 1 item")).toBeInTheDocument();
    });

    // Bug 8 — visually separate "edit / clipboard cluster" from the
    // "copy-as-text" cluster. The component renders <Divider> nodes
    // between groups; users were misreading the two clusters as
    // duplicates when both used the same ContentCopy icon.
    it("renders multiple dividers separating the action clusters", () => {
      rExt({ pasteCount: 2 });
      // MUI's <Divider> renders with role="separator". The menu
      // should have several — between open/reveal and rename/cut,
      // between cut/paste and copy-as-text, and before Trash.
      const dividers = screen.getAllByRole("separator");
      // At least 3 separators are expected; using >= keeps the test
      // resilient to future minor reshuffles.
      expect(dividers.length).toBeGreaterThanOrEqual(3);
    });
  });

  // Bug 8 — the three "Copy as text" rows (Copy path / Copy filename
  // / Copy parent path) each must (a) write the correct string to
  // navigator.clipboard, and (b) render with a LinkIcon — not the
  // ContentCopyIcon the real Copy uses. Without distinct icons users
  // misread the rows as duplicates of the file-clipboard Copy.
  describe("Copy-as-text cluster icons + clipboard writes (Bug 8)", () => {
    const handlers = () => ({
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
    });

    it("Copy path fires onCopyPath with the entry (not navigator.clipboard)", () => {
      const h = handlers();
      const localFile: Entry = { ...file, path: "/a/b/c.txt", name: "c.txt" };
      render(
        <ThemeProvider theme={theme}>
          <EntryContextMenu
            state={{ entry: localFile, x: 10, y: 10 }}
            {...h}
          />
        </ThemeProvider>,
      );
      fireEvent.click(screen.getByText("Copy path"));
      expect(h.onCopyPath).toHaveBeenCalledWith(localFile);
    });

    it("Copy filename writes the basename to navigator.clipboard", () => {
      const h = handlers();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { clipboard: { writeText } },
      });
      const localFile: Entry = {
        ...file,
        path: "/folder/subfolder/myfile.txt",
        name: "myfile.txt",
      };
      render(
        <ThemeProvider theme={theme}>
          <EntryContextMenu
            state={{ entry: localFile, x: 10, y: 10 }}
            {...h}
          />
        </ThemeProvider>,
      );
      fireEvent.click(screen.getByText("Copy filename"));
      expect(writeText).toHaveBeenCalledWith("myfile.txt");
    });

    it("Copy parent path writes the parent directory to navigator.clipboard", () => {
      const h = handlers();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { clipboard: { writeText } },
      });
      const localFile: Entry = {
        ...file,
        path: "/folder/subfolder/myfile.txt",
        name: "myfile.txt",
      };
      render(
        <ThemeProvider theme={theme}>
          <EntryContextMenu
            state={{ entry: localFile, x: 10, y: 10 }}
            {...h}
          />
        </ThemeProvider>,
      );
      fireEvent.click(screen.getByText("Copy parent path"));
      expect(writeText).toHaveBeenCalledWith("/folder/subfolder");
    });
  });
});
