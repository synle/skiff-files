// Pins the PathPickerField contract: controlled text input + Browse
// button + debounced existence-check warning. Without these tests
// the Browse / validation wiring could silently regress to a plain
// TextField the next time the dialog is touched.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import PathPickerField from "./PathPickerField";

// Mock fsStat — the field calls it for existence validation. Each
// test overrides the implementation as needed.
vi.mock("../api/fs", () => ({
  fsStat: vi.fn(async () => ({ name: "ok" })),
}));

const theme = createTheme();

function r(over: Partial<Parameters<typeof PathPickerField>[0]> = {}) {
  const onChange = over.onChange ?? vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <PathPickerField
        label={over.label ?? "Private key path"}
        value={over.value ?? ""}
        onChange={onChange}
        mode={over.mode}
        required={over.required}
        placeholder={over.placeholder ?? "~/.ssh/id_ed25519"}
        helperText={over.helperText}
        filters={over.filters}
      />
    </ThemeProvider>,
  );
  return { onChange };
}

describe("PathPickerField", () => {
  it("renders the text input + a Browse button", () => {
    r();
    expect(screen.getByLabelText(/Private key path/)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Browse for file/),
    ).toBeInTheDocument();
  });

  it("typing into the input fires onChange with the new value", () => {
    const { onChange } = r();
    fireEvent.change(screen.getByLabelText(/Private key path/) as HTMLInputElement, {
      target: { value: "/tmp/key" },
    });
    expect(onChange).toHaveBeenCalledWith("/tmp/key");
  });

  it("surfaces a 'path doesn't exist' warning when fsStat rejects", async () => {
    const { fsStat } = await import("../api/fs");
    (fsStat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ENOENT"),
    );
    r({ value: "/does/not/exist" });
    // Debounced by 350ms in the component; waitFor polls up to its
    // default 1s budget which is enough.
    await waitFor(
      () =>
        expect(
          screen.getByText(/doesn['']t exist/i),
        ).toBeInTheDocument(),
      { timeout: 1500 },
    );
  });

  it("hides the warning when fsStat resolves", async () => {
    r({ value: "/exists" });
    // Wait for the debounce + the resolved fsStat — no warning
    // should appear. We assert that the warning text is NEVER
    // present within a generous window.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.queryByText(/doesn['']t exist/i)).not.toBeInTheDocument();
  });

  it("empty value is idle — no validation message rendered", async () => {
    const { fsStat } = await import("../api/fs");
    (fsStat as ReturnType<typeof vi.fn>).mockClear();
    r({ value: "" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.queryByText(/doesn['']t exist/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Checking/i)).not.toBeInTheDocument();
    // Empty input must not even hit fsStat — debounce should bail
    // out early. Defensive check; the rule is "no probe on empty".
    expect(fsStat).not.toHaveBeenCalled();
  });

  it("directory mode swaps the Browse aria-label", () => {
    r({ mode: "directory" });
    expect(
      screen.getByLabelText(/Browse for folder/),
    ).toBeInTheDocument();
  });

  it("respects the required prop", () => {
    r({ required: true });
    const input = screen.getByLabelText(/Private key path/) as HTMLInputElement;
    expect(input.required).toBe(true);
  });
});
