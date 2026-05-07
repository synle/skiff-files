import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import RenameDialog from "./RenameDialog";

const theme = createTheme();

function r(props?: Partial<Parameters<typeof RenameDialog>[0]>) {
  const onClose = props?.onClose ?? vi.fn();
  const onRename = props?.onRename ?? vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <RenameDialog
        open={props?.open ?? true}
        originalName={props?.originalName ?? "notes.md"}
        originalPath={props?.originalPath ?? "/x/notes.md"}
        onClose={onClose}
        onRename={onRename}
      />
    </ThemeProvider>,
  );
  return { onClose, onRename };
}

describe("RenameDialog", () => {
  it("seeds the input with the original name", () => {
    r();
    const input = screen.getByLabelText("New name") as HTMLInputElement;
    expect(input.value).toBe("notes.md");
  });

  it("Cancel calls onClose without renaming", () => {
    const onRename = vi.fn();
    const { onClose } = r({ onRename });
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("Rename invokes onRename with the trimmed new name", async () => {
    const onRename = vi.fn(async () => {});
    const { onClose } = r({ onRename });
    const input = screen.getByLabelText("New name");
    fireEvent.change(input, { target: { value: "  hello.md  " } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith("hello.md");
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("rejects names containing a path separator", () => {
    const onRename = vi.fn();
    r({ onRename });
    const input = screen.getByLabelText("New name");
    fireEvent.change(input, { target: { value: "evil/name" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByText(/can't contain a path separator/)).toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("Enter submits", async () => {
    const onRename = vi.fn(async () => {});
    r({ onRename });
    const input = screen.getByLabelText("New name");
    fireEvent.change(input, { target: { value: "renamed.md" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith("renamed.md");
    });
  });

  it("identical name closes without invoking", () => {
    const onRename = vi.fn();
    const { onClose } = r({ onRename });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    // Button is disabled when name == original; clicking is a no-op.
    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
