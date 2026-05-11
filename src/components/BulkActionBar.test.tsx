// BulkActionBar tests — pins the always-visible-bar contract added
// in 0.2.253: the bar renders for any selection count, the New
// folder / New file buttons are always present (height-stable), and
// the multi-select cluster only appears when 2+ rows are picked.
// Earlier behavior gated the entire bar on count >= 2 which made
// the layout jump as the user toggled selection.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import BulkActionBar from "./BulkActionBar";

const theme = createTheme();

function r(props: Partial<Parameters<typeof BulkActionBar>[0]>) {
  const merged = {
    count: 0,
    onNewFolder: vi.fn(),
    onNewFile: vi.fn(),
    onCopy: vi.fn(),
    onCut: vi.fn(),
    onDelete: vi.fn(),
    onCompress: vi.fn(),
    onBulkRename: vi.fn(),
    onSetTag: vi.fn(),
    onSaveSelectionGroup: vi.fn(),
    ...props,
  };
  render(
    <ThemeProvider theme={theme}>
      <BulkActionBar {...merged} />
    </ThemeProvider>,
  );
  return merged;
}

describe("BulkActionBar", () => {
  it("renders New folder + New file buttons with zero selection", () => {
    r({ count: 0 });
    expect(
      screen.getByRole("button", { name: "New folder" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New file" }),
    ).toBeInTheDocument();
  });

  it("does not render the bulk-selection cluster with zero selection", () => {
    r({ count: 0 });
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("does not render the bulk-selection cluster with a single selection", () => {
    // Single-select keeps the right-click menu as its primary
    // surface — the bulk cluster is for multi-select only.
    r({ count: 1 });
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "New folder" }),
    ).toBeInTheDocument();
  });

  it("renders bulk verbs once 2+ rows are selected", () => {
    r({ count: 2 });
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cut" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Compress" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("does not render the legacy 'X selected' label or Clear button", () => {
    // 0.2.253 dropped both — the count lives in the status bar and
    // clicking outside clears the selection.
    r({ count: 5 });
    expect(screen.queryByText(/selected/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("New folder click fires onNewFolder", () => {
    const props = r({ count: 0 });
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    expect(props.onNewFolder).toHaveBeenCalledTimes(1);
  });

  it("New file click fires onNewFile", () => {
    const props = r({ count: 0 });
    fireEvent.click(screen.getByRole("button", { name: "New file" }));
    expect(props.onNewFile).toHaveBeenCalledTimes(1);
  });

  it("Delete click fires onDelete (multi-select)", () => {
    const props = r({ count: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });
});
