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
});
