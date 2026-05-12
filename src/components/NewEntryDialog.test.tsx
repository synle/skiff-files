import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import NewEntryDialog from "./NewEntryDialog";

const theme = createTheme();

function r(over: Partial<Parameters<typeof NewEntryDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onSubmit = vi.fn(async () => {});
  render(
    <ThemeProvider theme={theme}>
      <NewEntryDialog
        open
        title="New folder"
        parentPath="/Users/test"
        defaultName="Untitled folder"
        existingNames={new Set()}
        onClose={onClose}
        onSubmit={onSubmit}
        {...over}
      />
    </ThemeProvider>,
  );
  return { onClose, onSubmit };
}

describe("NewEntryDialog", () => {
  it("renders the title and parent path", () => {
    r({ title: "New folder", parentPath: "/Users/test" });
    expect(screen.getByText("New folder")).toBeInTheDocument();
    expect(screen.getByText("/Users/test")).toBeInTheDocument();
  });

  it("Submit fires onSubmit with the trimmed name", async () => {
    const { onSubmit } = r({ defaultName: "Draft" });
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "  My folder  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Microtask flush.
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledWith("My folder");
  });

  it("Escape closes the dialog", () => {
    const { onClose } = r();
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Submit button is disabled when name is empty", () => {
    r({ defaultName: "" });
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("Submit button is disabled when name collides with a sibling", () => {
    r({ defaultName: "taken", existingNames: new Set(["taken"]) });
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    expect(
      screen.getByText(/A file or folder named "taken" already exists/),
    ).toBeInTheDocument();
  });

  it("Submit button is disabled when name contains a path separator", () => {
    r({ defaultName: "" });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "bad/name" },
    });
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    expect(
      screen.getByText(/Name can't contain a path separator/),
    ).toBeInTheDocument();
  });

  it("Cancel button fires onClose", () => {
    const { onClose } = r();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces the rejection from onSubmit as inline error text", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("boom");
    });
    r({ onSubmit });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByText(/boom/)).toBeInTheDocument();
    });
  });

  it("renders nothing when open=false", () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <NewEntryDialog
          open={false}
          title="x"
          parentPath="/x"
          defaultName=""
          existingNames={new Set()}
          onClose={vi.fn()}
          onSubmit={vi.fn(async () => {})}
        />
      </ThemeProvider>,
    );
    expect(container.querySelector("[role=dialog]")).toBeNull();
  });

  it("respects custom submitLabel", () => {
    r({ submitLabel: "Rename" });
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
  });
});
