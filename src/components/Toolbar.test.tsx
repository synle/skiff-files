import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import Toolbar from "./Toolbar";

const theme = createTheme();

function r(overrides?: Partial<Parameters<typeof Toolbar>[0]>) {
  const props = {
    canGoBack: false,
    canGoForward: false,
    canGoUp: true,
    onBack: vi.fn(),
    onForward: vi.fn(),
    onUp: vi.fn(),
    onRefresh: vi.fn(),
    onNewFolder: vi.fn(),
    view: "list" as const,
    onViewChange: vi.fn(),
    previewOpen: false,
    onTogglePreview: vi.fn(),
    search: "",
    onSearchChange: vi.fn(),
    searchRecursive: false,
    onSearchRecursiveChange: vi.fn(),
    backHistory: [],
    forwardHistory: [],
    onHistoryJump: vi.fn(),
    ...overrides,
  };
  render(
    <ThemeProvider theme={theme}>
      <Toolbar {...props} />
    </ThemeProvider>,
  );
  return props;
}

describe("Toolbar search", () => {
  it("renders the search input", () => {
    r();
    expect(screen.getByLabelText("Search current folder")).toBeInTheDocument();
  });

  it("typing fires onSearchChange", () => {
    const props = r();
    fireEvent.change(screen.getByLabelText("Search current folder"), {
      target: { value: "foo" },
    });
    expect(props.onSearchChange).toHaveBeenCalledWith("foo");
  });

  it("Esc clears the search", () => {
    const props = r({ search: "foo" });
    fireEvent.keyDown(screen.getByLabelText("Search current folder"), {
      key: "Escape",
    });
    expect(props.onSearchChange).toHaveBeenCalledWith("");
  });

  it("clear button appears when search is non-empty", () => {
    const props = r({ search: "foo" });
    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(props.onSearchChange).toHaveBeenCalledWith("");
  });

  it("clear button is hidden when search is empty", () => {
    r();
    expect(screen.queryByLabelText("Clear search")).not.toBeInTheDocument();
  });

  it("recursive toggle fires onSearchRecursiveChange", () => {
    const props = r();
    fireEvent.click(screen.getByLabelText("Toggle recursive search"));
    expect(props.onSearchRecursiveChange).toHaveBeenCalledWith(true);
  });

  it("placeholder text changes when recursive search is on", () => {
    r({ searchRecursive: true });
    expect(
      screen.getByPlaceholderText(/Find in subfolders/),
    ).toBeInTheDocument();
  });

  it("right-click on Back opens a history dropdown when entries exist", () => {
    r({
      canGoBack: true,
      backHistory: ["/a", "/a/b", "/a/b/c"],
    });
    fireEvent.contextMenu(screen.getByLabelText("Back"));
    // Reversed in the menu — so the most recent (deepest) appears first.
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toBe("c");
  });

  it("clicking a history item calls onHistoryJump with the right step count", () => {
    const props = r({
      canGoBack: true,
      backHistory: ["/a", "/a/b", "/a/b/c"],
    });
    fireEvent.contextMenu(screen.getByLabelText("Back"));
    const items = screen.getAllByRole("menuitem");
    // Click the second one (= "b") — that's 2 steps back.
    fireEvent.click(items[1]);
    expect(props.onHistoryJump).toHaveBeenCalledWith("back", 2);
  });

  it("does not open the dropdown when history is empty", () => {
    r({ canGoBack: true, backHistory: [] });
    fireEvent.contextMenu(screen.getByLabelText("Back"));
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });
});
