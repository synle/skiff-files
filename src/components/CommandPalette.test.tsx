import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import CommandPalette, { type CommandAction } from "./CommandPalette";

const theme = createTheme();

function renderPalette(
  open: boolean,
  actions: CommandAction[],
  onClose = vi.fn(),
) {
  render(
    <ThemeProvider theme={theme}>
      <CommandPalette open={open} onClose={onClose} actions={actions} />
    </ThemeProvider>,
  );
  return { onClose };
}

function action(over: Partial<CommandAction>): CommandAction {
  return { id: "x", label: "Do X", run: vi.fn(), ...over };
}

describe("CommandPalette", () => {
  it("renders nothing visible when closed", () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <CommandPalette open={false} onClose={vi.fn()} actions={[action({})]} />
      </ThemeProvider>,
    );
    // Dialog renders nothing into the DOM when open=false.
    expect(container.querySelector("[role=combobox]")).toBeNull();
  });

  it("renders every action label when open", () => {
    renderPalette(true, [
      action({ id: "a", label: "Toggle theme" }),
      action({ id: "b", label: "New tab" }),
    ]);
    expect(screen.getByText("Toggle theme")).toBeInTheDocument();
    expect(screen.getByText("New tab")).toBeInTheDocument();
  });

  it("filters by case-insensitive substring across label / hint / keywords", () => {
    renderPalette(true, [
      action({ id: "a", label: "Theme: Light" }),
      action({ id: "b", label: "Open Settings", hint: "Cmd+," }),
      action({ id: "c", label: "Other", keywords: "matchme" }),
    ]);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "MATCHME" } });
    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.queryByText("Theme: Light")).toBeNull();
  });

  it("ArrowDown / Enter runs the highlighted action and closes", () => {
    const runA = vi.fn();
    const runB = vi.fn();
    const onClose = vi.fn();
    renderPalette(
      true,
      [
        action({ id: "a", label: "First", run: runA }),
        action({ id: "b", label: "Second", run: runB }),
      ],
      onClose,
    );
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runB).toHaveBeenCalledTimes(1);
    expect(runA).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("ArrowUp does not underflow below 0", () => {
    const runA = vi.fn();
    renderPalette(true, [action({ id: "a", label: "First", run: runA })]);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runA).toHaveBeenCalled();
  });

  it("Escape closes without running anything", () => {
    const run = vi.fn();
    const onClose = vi.fn();
    renderPalette(true, [action({ run })], onClose);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(run).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking an item runs it and closes", () => {
    const run = vi.fn();
    const onClose = vi.fn();
    renderPalette(true, [action({ id: "a", label: "Clickable", run })], onClose);
    fireEvent.click(screen.getByText("Clickable"));
    expect(run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("disabled actions can't be run via click or Enter", () => {
    const run = vi.fn();
    const onClose = vi.fn();
    renderPalette(
      true,
      [action({ id: "a", label: "Nope", disabled: true, run })],
      onClose,
    );
    fireEvent.click(screen.getByText("Nope"));
    expect(run).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(run).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows 'No matches' when the filter excludes every action", () => {
    renderPalette(true, [action({ id: "a", label: "Only one" })]);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "zzzzzz" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("renders the action hint as secondary text when set", () => {
    renderPalette(true, [
      action({ id: "a", label: "Open Settings", hint: "Cmd+," }),
    ]);
    expect(screen.getByText("Cmd+,")).toBeInTheDocument();
  });
});
