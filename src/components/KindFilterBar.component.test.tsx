import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import KindFilterBar from "./KindFilterBar";

const theme = createTheme();

function r(over: Partial<Parameters<typeof KindFilterBar>[0]> = {}) {
  const onChange = vi.fn();
  const onTagsChange = vi.fn();
  const onRecencyChange = vi.fn();
  const onClose = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <KindFilterBar
        active={[]}
        onChange={onChange}
        activeTags={[]}
        onTagsChange={onTagsChange}
        activeRecency={null}
        onRecencyChange={onRecencyChange}
        onClose={onClose}
        {...over}
      />
    </ThemeProvider>,
  );
  return { onChange, onTagsChange, onRecencyChange, onClose };
}

describe("KindFilterBar component", () => {
  it("renders one chip per kind group", () => {
    r();
    expect(screen.getByText("Folders")).toBeInTheDocument();
    expect(screen.getByText("Images")).toBeInTheDocument();
    expect(screen.getByText("Documents")).toBeInTheDocument();
    expect(screen.getByText("Archives")).toBeInTheDocument();
  });

  it("clicking a chip toggles it into the active list", () => {
    const { onChange } = r();
    fireEvent.click(screen.getByText("Images"));
    expect(onChange).toHaveBeenCalledWith(["image"]);
  });

  it("clicking an already-active chip removes it (symmetric toggle)", () => {
    const { onChange } = r({ active: ["image"] });
    fireEvent.click(screen.getByText("Images"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("renders a tag-color row when onTagsChange is supplied", () => {
    r({ onTagsChange: vi.fn() });
    // The Tags: caption is the simplest marker of the tag row.
    expect(screen.getByText(/^Tags:/)).toBeInTheDocument();
  });

  it("renders the Recency: caption when onRecencyChange is supplied", () => {
    r({ onRecencyChange: vi.fn() });
    expect(screen.getByText(/^Recency:/)).toBeInTheDocument();
  });

  it("shows a Clear chip when at least one kind is active", () => {
    const { onChange } = r({ active: ["image"] });
    fireEvent.click(screen.getByText("Clear"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("shows a Hide filter row close button when onClose is set", () => {
    const { onClose } = r();
    fireEvent.click(screen.getByLabelText("Hide filter row"));
    expect(onClose).toHaveBeenCalled();
  });

  it("recency chips fire onRecencyChange", () => {
    const onRecencyChange = vi.fn();
    r({ onRecencyChange });
    fireEvent.click(screen.getByText("Today"));
    expect(onRecencyChange).toHaveBeenCalledWith("today");
  });

  it("clicking an already-active recency chip clears it", () => {
    const onRecencyChange = vi.fn();
    r({ onRecencyChange, activeRecency: "today" });
    fireEvent.click(screen.getByText("Today"));
    expect(onRecencyChange).toHaveBeenCalledWith(null);
  });
});
