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
  render(
    <ThemeProvider theme={theme}>
      <div style={{ height: 600 }}>
        <FileList
          entries={props?.entries ?? ENTRIES}
          sortKey={props?.sortKey ?? "name"}
          sortDir={props?.sortDir ?? "asc"}
          onSortChange={onSortChange}
          onOpenDir={onOpenDir}
          density={props?.density ?? "comfortable"}
          showExtensions={props?.showExtensions ?? true}
        />
      </div>
    </ThemeProvider>,
  );
  return { onSortChange, onOpenDir };
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

  it("hides extensions when showExtensions=false", () => {
    renderList({ showExtensions: false });
    expect(screen.queryByText("alpha.txt")).not.toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });

  it("shows the empty-folder message when no entries", () => {
    renderList({ entries: [] });
    expect(screen.getByText(/Empty folder/i)).toBeInTheDocument();
  });
});
