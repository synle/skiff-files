// ConfirmDialog tests — exists primarily because the user hit a
// regression where Move-to-Trash was silently no-op'ing (window.confirm
// suppressed by Tauri webview). Now Move-to-Trash routes through this
// modal, so we lock the behavior in with a test.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import ConfirmDialog from "./ConfirmDialog";

const theme = createTheme();

function r(props?: Partial<Parameters<typeof ConfirmDialog>[0]>) {
  const onCancel = props?.onCancel ?? vi.fn();
  const onConfirm = props?.onConfirm ?? vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <ConfirmDialog
        open={props?.open ?? true}
        title={props?.title ?? "Move to Trash"}
        message={props?.message ?? 'Move to Trash "foo.txt"?'}
        confirmLabel={props?.confirmLabel}
        destructive={props?.destructive}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    </ThemeProvider>,
  );
  return { onCancel, onConfirm };
}

describe("ConfirmDialog", () => {
  it("renders title + message when open", () => {
    r();
    expect(screen.getByText("Move to Trash")).toBeInTheDocument();
    expect(screen.getByText('Move to Trash "foo.txt"?')).toBeInTheDocument();
  });

  it("nothing renders when closed", () => {
    r({ open: false });
    expect(screen.queryByText("Move to Trash")).not.toBeInTheDocument();
  });

  it("Cancel button fires onCancel", () => {
    const { onCancel, onConfirm } = r();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Confirm button fires onConfirm (default label)", () => {
    const { onConfirm, onCancel } = r();
    // The button label defaults to "Confirm"
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Custom confirm label is rendered + clickable", () => {
    const { onConfirm } = r({ confirmLabel: "Move to Trash" });
    // There are two "Move to Trash" texts (title + button); use
    // role to disambiguate.
    fireEvent.click(
      screen.getByRole("button", { name: "Move to Trash" }),
    );
    expect(onConfirm).toHaveBeenCalled();
  });
});
