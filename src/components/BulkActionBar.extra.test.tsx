import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import BulkActionBar from "./BulkActionBar";

const theme = createTheme();

function r(props: Partial<Parameters<typeof BulkActionBar>[0]>) {
  const merged = {
    count: 0,
    onNewFolder: vi.fn(),
    onNewFile: vi.fn(),
    onClearSelection: vi.fn(),
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

describe("BulkActionBar — extras", () => {
  it("Copy click fires onCopy (multi)", () => {
    const props = r({ count: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(props.onCopy).toHaveBeenCalledTimes(1);
  });

  it("Cut click fires onCut (multi)", () => {
    const props = r({ count: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Cut" }));
    expect(props.onCut).toHaveBeenCalledTimes(1);
  });

  it("Compress click fires onCompress (multi)", () => {
    const props = r({ count: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Compress" }));
    expect(props.onCompress).toHaveBeenCalledTimes(1);
  });

  it("Rename click fires onBulkRename (multi)", () => {
    const props = r({ count: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(props.onBulkRename).toHaveBeenCalledTimes(1);
  });

  it("Save group button appears with multi-selection + handler", () => {
    const props = r({ count: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Save group" }));
    expect(props.onSaveSelectionGroup).toHaveBeenCalledTimes(1);
  });

  it("Tag dropdown opens and picking a color fires onSetTag with the color", () => {
    const props = r({ count: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Tag" }));
    fireEvent.click(screen.getByText("Red"));
    expect(props.onSetTag).toHaveBeenCalledWith("red");
  });

  it("Tag dropdown 'Clear tag' fires onSetTag with null", () => {
    const props = r({ count: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Tag" }));
    fireEvent.click(screen.getByText("Clear tag"));
    expect(props.onSetTag).toHaveBeenCalledWith(null);
  });
});
