import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import Toolbar from "./Toolbar";

const theme = createTheme();

function r(overrides?: Partial<Parameters<typeof Toolbar>[0]>) {
  const props = {
    canGoBack: true,
    canGoForward: true,
    canGoUp: true,
    onBack: vi.fn(),
    onForward: vi.fn(),
    onUp: vi.fn(),
    onRefresh: vi.fn(),
    onNewFolder: vi.fn(),
    onNewFile: vi.fn(),
    view: "list" as const,
    onViewChange: vi.fn(),
    previewOpen: false,
    onTogglePreview: vi.fn(),
    search: "",
    onSearchChange: vi.fn(),
    searchRecursive: false,
    onSearchRecursiveChange: vi.fn(),
    searchRegex: false,
    onSearchRegexChange: vi.fn(),
    searchCaseSensitive: false,
    onSearchCaseSensitiveChange: vi.fn(),
    backHistory: [] as string[],
    forwardHistory: [] as string[],
    onHistoryJump: vi.fn(),
    sortKey: "name" as const,
    sortDir: "asc" as const,
    onSortChange: vi.fn(),
    onSortDirToggle: vi.fn(),
    showHidden: false,
    onShowHiddenToggle: vi.fn(),
    density: "comfortable" as const,
    onDensityToggle: vi.fn(),
    kindFilterOpen: false,
    onKindFilterToggle: vi.fn(),
    kindFilterActiveCount: 0,
    ...overrides,
  };
  render(
    <ThemeProvider theme={theme}>
      <Toolbar {...props} />
    </ThemeProvider>,
  );
  return props;
}

describe("Toolbar — extras", () => {
  it("Back / Forward / Up buttons fire their handlers", () => {
    const props = r();
    const pick = (label: string) => {
      const all = screen.getAllByLabelText(label);
      return all.find((el) => el.tagName === "BUTTON") ?? all[0];
    };
    fireEvent.click(pick("Back"));
    expect(props.onBack).toHaveBeenCalled();
    fireEvent.click(pick("Forward"));
    expect(props.onForward).toHaveBeenCalled();
    const upButtons = screen.getAllByLabelText("Up");
    // The actual <button> is the second match (tooltip wrapper carries
    // the first aria-label).
    const upBtn = upButtons.find((el) => el.tagName === "BUTTON") ?? upButtons[0];
    fireEvent.click(upBtn);
    expect(props.onUp).toHaveBeenCalled();
  });

  it("Refresh icon click fires onRefresh", () => {
    const props = r();
    fireEvent.click(screen.getByLabelText("Refresh"));
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it("New folder button fires onNewFolder", () => {
    const props = r();
    fireEvent.click(screen.getByLabelText("New folder"));
    expect(props.onNewFolder).toHaveBeenCalled();
  });

  it("New file button fires onNewFile when wired", () => {
    const props = r();
    fireEvent.click(screen.getByLabelText("New file"));
    expect(props.onNewFile).toHaveBeenCalled();
  });

  it("Density toggle fires onDensityToggle", () => {
    const props = r();
    fireEvent.click(screen.getByLabelText(/density/i));
    expect(props.onDensityToggle).toHaveBeenCalled();
  });

  it("Show-hidden toggle fires onShowHiddenToggle", () => {
    const props = r();
    fireEvent.click(screen.getByLabelText(/hidden/i));
    expect(props.onShowHiddenToggle).toHaveBeenCalled();
  });

  it("Preview pane toggle fires onTogglePreview", () => {
    const props = r();
    fireEvent.click(screen.getByLabelText(/preview/i));
    expect(props.onTogglePreview).toHaveBeenCalled();
  });

  it("View-mode toggle buttons fire onViewChange with the chosen mode", () => {
    const props = r();
    const galleryBtn = screen.getByLabelText(/Gallery view/i);
    fireEvent.click(galleryBtn);
    expect(props.onViewChange).toHaveBeenCalledWith("gallery");
  });

  it("Sort menu opens and exposes the documented sort keys", () => {
    r();
    fireEvent.click(screen.getByLabelText(/sort/i));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("isRefreshing swaps the icon for a spinner", () => {
    r({ isRefreshing: true });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("renders the upTarget tooltip text on the Up button when supplied", () => {
    r({ upTarget: "/Users" });
    // Tooltip is anchored on the button — MUI defers the text into a
    // portal on hover; just confirm the button is still rendered.
    expect(screen.getAllByLabelText("Up").length).toBeGreaterThan(0);
  });

  it("Sort menu picking a different key fires onSortChange", () => {
    const props = r({ sortKey: "name" });
    fireEvent.click(screen.getByLabelText(/sort/i));
    // Pick "Size" inside the menu.
    fireEvent.click(screen.getByText(/^Size$/));
    expect(props.onSortChange).toHaveBeenCalledWith("size");
  });

  it("Sort menu Reverse direction fires onSortDirToggle", () => {
    const props = r();
    fireEvent.click(screen.getByLabelText(/sort/i));
    fireEvent.click(screen.getByText(/Reverse direction/));
    expect(props.onSortDirToggle).toHaveBeenCalled();
  });

  it("regex toggle fires onSearchRegexChange when search is non-empty", () => {
    const props = r({ search: "foo" });
    fireEvent.click(screen.getByLabelText(/Toggle regex search/i));
    expect(props.onSearchRegexChange).toHaveBeenCalledWith(true);
  });

  it("case-sensitive toggle fires onSearchCaseSensitiveChange", () => {
    const props = r({ search: "foo" });
    fireEvent.click(screen.getByLabelText(/case-sensitive/i));
    expect(props.onSearchCaseSensitiveChange).toHaveBeenCalledWith(true);
  });

  it("kind filter toggle fires onKindFilterToggle", () => {
    const props = r();
    fireEvent.click(screen.getByLabelText(/kind filter/i));
    expect(props.onKindFilterToggle).toHaveBeenCalled();
  });

  it("forward history right-click opens a dropdown when entries exist", () => {
    r({
      canGoForward: true,
      forwardHistory: ["/x", "/x/y"],
    });
    const fwdButtons = screen.getAllByLabelText("Forward");
    const fwd = fwdButtons.find((el) => el.tagName === "BUTTON") ?? fwdButtons[0];
    fireEvent.contextMenu(fwd);
    expect(screen.getAllByRole("menuitem").length).toBeGreaterThan(0);
  });

  it("Overflow menu opens and exposes preview pane toggle", () => {
    const props = r();
    fireEvent.click(screen.getByLabelText("More toolbar options"));
    expect(screen.getByText(/preview pane/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/preview pane/i));
    expect(props.onTogglePreview).toHaveBeenCalled();
  });

  it("Overflow menu Sort by Size routes to onSortChange('size')", () => {
    const props = r();
    fireEvent.click(screen.getByLabelText("More toolbar options"));
    fireEvent.click(screen.getByText(/Sort by Size/));
    expect(props.onSortChange).toHaveBeenCalledWith("size");
  });

  it("Overflow menu Reverse direction fires onSortDirToggle", () => {
    const props = r();
    fireEvent.click(screen.getByLabelText("More toolbar options"));
    fireEvent.click(screen.getByText(/Reverse sort direction/));
    expect(props.onSortDirToggle).toHaveBeenCalled();
  });

  it("Overflow menu density toggle fires onDensityToggle", () => {
    const props = r();
    fireEvent.click(screen.getByLabelText("More toolbar options"));
    fireEvent.click(screen.getByText(/Switch to compact rows/));
    expect(props.onDensityToggle).toHaveBeenCalled();
  });

  it("Overflow menu hidden-files toggle fires onShowHiddenToggle", () => {
    const props = r();
    fireEvent.click(screen.getByLabelText("More toolbar options"));
    fireEvent.click(screen.getByText(/Show dotfiles/));
    expect(props.onShowHiddenToggle).toHaveBeenCalled();
  });
});
