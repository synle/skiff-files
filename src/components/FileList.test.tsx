import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import FileList from "./FileList";
import type { Entry } from "../api/fs";

// jsdom doesn't lay anything out, so the virtualizer thinks the scroll
// container is 0×0 and renders no rows. Patch the bounding-rect / scroll
// readouts so it sees a viewport big enough to render every row.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 600,
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      toJSON: () => "",
    } as DOMRect;
  };
});

const theme = createTheme();

const ENTRIES: Entry[] = [
  {
    name: "alpha.txt",
    path: "/x/alpha.txt",
    kind: "text",
    size: 100,
    mtime: 1700000000,
    isDir: false,
    isSymlink: false,
    isHidden: false,
    mode: 0o644,
  },
  {
    name: "zeta.md",
    path: "/x/zeta.md",
    kind: "markdown",
    size: 50,
    mtime: 1700001000,
    isDir: false,
    isSymlink: false,
    isHidden: false,
    mode: 0o644,
  },
  {
    name: "child-folder",
    path: "/x/child-folder",
    kind: "folder",
    size: 0,
    mtime: 1700002000,
    isDir: true,
    isSymlink: false,
    isHidden: false,
    mode: 0o755,
  },
];

function renderList(props?: Partial<Parameters<typeof FileList>[0]>) {
  const onSortChange = props?.onSortChange ?? vi.fn();
  const onOpenDir = props?.onOpenDir ?? vi.fn();
  const onPrimarySelect = props?.onPrimarySelect ?? vi.fn();
  const onSelectionChange = props?.onSelectionChange ?? vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <div style={{ height: 600 }}>
        <FileList
          entries={props?.entries ?? ENTRIES}
          sortKey={props?.sortKey ?? "name"}
          sortDir={props?.sortDir ?? "asc"}
          onSortChange={onSortChange}
          onOpenDir={onOpenDir}
          onPrimarySelect={onPrimarySelect}
          onSelectionChange={onSelectionChange}
          isActive={props?.isActive ?? true}
          density={props?.density ?? "comfortable"}
          showExtensions={props?.showExtensions ?? "always"}
          groupFoldersFirst={props?.groupFoldersFirst ?? true}
          onOpenDirInNewTab={props?.onOpenDirInNewTab}
        />
      </div>
    </ThemeProvider>,
  );
  return { onSortChange, onOpenDir, onPrimarySelect, onSelectionChange };
}

describe("FileList", () => {
  it("renders one row per entry", () => {
    renderList();
    expect(screen.getAllByTestId("file-row")).toHaveLength(3);
  });

  it("places folders before files regardless of sort", () => {
    renderList({ sortKey: "name", sortDir: "asc" });
    const rows = screen.getAllByTestId("file-row");
    expect(rows[0].textContent).toContain("child-folder");
  });

  it("intermixes folders + files when groupFoldersFirst=false", () => {
    // Sorting by name asc: alpha.txt < child-folder < zeta.md.
    renderList({
      sortKey: "name",
      sortDir: "asc",
      groupFoldersFirst: false,
    });
    const rows = screen.getAllByTestId("file-row");
    expect(rows[0].textContent).toContain("alpha.txt");
    expect(rows[1].textContent).toContain("child-folder");
    expect(rows[2].textContent).toContain("zeta.md");
  });

  it("clicking a column header calls onSortChange", () => {
    const { onSortChange } = renderList();
    fireEvent.click(screen.getByText(/Size/));
    expect(onSortChange).toHaveBeenCalledWith("size");
  });

  it("double-clicking a folder calls onOpenDir", () => {
    const { onOpenDir } = renderList();
    const folderRow = screen
      .getAllByTestId("file-row")
      .find((r) => r.textContent?.includes("child-folder"));
    expect(folderRow).toBeTruthy();
    fireEvent.doubleClick(folderRow!);
    expect(onOpenDir).toHaveBeenCalled();
  });

  it("single-clicking a row fires onPrimarySelect with that entry", () => {
    const { onPrimarySelect } = renderList();
    const row = screen
      .getAllByTestId("file-row")
      .find((r) => r.textContent?.includes("alpha.txt"))!;
    fireEvent.click(row);
    expect(onPrimarySelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "alpha.txt" }),
    );
  });

  it("reports the multi-selection set via onSelectionChange", () => {
    const onSelectionChange = vi.fn();
    renderList({ onSelectionChange });
    const row = screen
      .getAllByTestId("file-row")
      .find((r) => r.textContent?.includes("alpha.txt"))!;
    fireEvent.click(row);
    // Last call has the new selection. Previous calls may include the
    // initial empty array from the mount-time effect.
    const last = onSelectionChange.mock.calls.at(-1)?.[0];
    expect(last).toContain("/x/alpha.txt");
  });

  it("hides extensions when showExtensions='never'", () => {
    renderList({ showExtensions: "never" });
    expect(screen.queryByText("alpha.txt")).not.toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });

  it("whenAmbiguous keeps extension for unknown kinds, hides for known", () => {
    const entries: Entry[] = [
      // Recognizable kind (text) → extension hidden.
      { ...ENTRIES[0], name: "alpha.txt", path: "/x/alpha.txt", kind: "text" },
      // Unknown kind → extension kept so the user can tell what it is.
      {
        ...ENTRIES[0],
        name: "weird.xyz",
        path: "/x/weird.xyz",
        kind: "binary",
      },
    ];
    renderList({ entries, showExtensions: "whenAmbiguous" });
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("weird.xyz")).toBeInTheDocument();
  });

  it("shows the empty-folder message when no entries", () => {
    renderList({ entries: [] });
    expect(screen.getByText(/Empty folder/i)).toBeInTheDocument();
  });

  it("Cmd/Ctrl+A selects all visible entries", () => {
    const onSelectionChange = vi.fn();
    renderList({ onSelectionChange });
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    const last = onSelectionChange.mock.calls.at(-1)?.[0];
    expect(last).toHaveLength(3);
  });

  it("Escape clears the selection", () => {
    const onSelectionChange = vi.fn();
    renderList({ onSelectionChange });
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(onSelectionChange.mock.calls.at(-1)?.[0]).toHaveLength(3);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onSelectionChange.mock.calls.at(-1)?.[0]).toHaveLength(0);
  });

  it("middle-click on a folder fires onOpenDirInNewTab", () => {
    const onOpenDirInNewTab = vi.fn();
    renderList({ onOpenDirInNewTab });
    const folderRow = screen
      .getAllByTestId("file-row")
      .find((r) => r.textContent?.includes("child-folder"))!;
    fireEvent.mouseDown(folderRow, { button: 1 });
    expect(onOpenDirInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ name: "child-folder" }),
    );
  });

  it("middle-click on a file does NOT fire onOpenDirInNewTab", () => {
    const onOpenDirInNewTab = vi.fn();
    renderList({ onOpenDirInNewTab });
    const fileRow = screen
      .getAllByTestId("file-row")
      .find((r) => r.textContent?.includes("alpha.txt"))!;
    fireEvent.mouseDown(fileRow, { button: 1 });
    expect(onOpenDirInNewTab).not.toHaveBeenCalled();
  });

  it("Enter on a focused folder fires onOpenDir", () => {
    const { onOpenDir } = renderList();
    // child-folder is sorted first (folders-on-top), so focusedIdx=0.
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpenDir).toHaveBeenCalled();
    const arg = (onOpenDir as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(arg.name).toBe("child-folder");
  });

  it("ArrowDown moves focus + reports new primary selection", () => {
    const onPrimarySelect = vi.fn();
    renderList({ onPrimarySelect });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    const last = onPrimarySelect.mock.calls.at(-1)?.[0];
    expect(last?.name).toBe("alpha.txt");
  });

  it("does NOT respond to keypresses when isActive=false", () => {
    const onSelectionChange = vi.fn();
    renderList({ isActive: false, onSelectionChange });
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    const last = onSelectionChange.mock.calls.at(-1)?.[0];
    expect(last ?? []).toHaveLength(0);
  });
});
