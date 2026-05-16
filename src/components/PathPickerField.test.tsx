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

  // Symmetric path to the "warning when fsStat rejects" test —
  // clearing the input must wipe the warning, not leave a stale
  // message stuck under a now-empty field.
  it("clears the warning when the value transitions to empty", async () => {
    const { fsStat } = await import("../api/fs");
    (fsStat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ENOENT"));
    // Render once with a bad path so the warning fires.
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <PathPickerField
          label="Private key path"
          value="/does/not/exist"
          onChange={vi.fn()}
        />
      </ThemeProvider>,
    );
    await waitFor(
      () =>
        expect(
          screen.getByText(/doesn['']t exist/i),
        ).toBeInTheDocument(),
      { timeout: 1500 },
    );
    // Re-render with an empty value — warning must clear.
    rerender(
      <ThemeProvider theme={theme}>
        <PathPickerField
          label="Private key path"
          value=""
          onChange={vi.fn()}
        />
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByText(/doesn['']t exist/i)).not.toBeInTheDocument();
    });
  });

  // Debounce contract — rapid typing must coalesce into ONE fsStat
  // call (after the final keystroke), not one per keystroke. Without
  // this the keychain / SSH-key picker would spam the Rust side on
  // every keystroke and flicker the warning between "checking" and
  // "missing".
  it("debounces rapid value changes into a single fsStat probe", async () => {
    const { fsStat } = await import("../api/fs");
    const stat = fsStat as ReturnType<typeof vi.fn>;
    stat.mockClear();
    stat.mockResolvedValue({ name: "ok" });
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <PathPickerField label="P" value="/a" onChange={vi.fn()} />
      </ThemeProvider>,
    );
    // Three quick re-renders within the 350ms debounce window —
    // none should fire fsStat yet.
    rerender(
      <ThemeProvider theme={theme}>
        <PathPickerField label="P" value="/ab" onChange={vi.fn()} />
      </ThemeProvider>,
    );
    rerender(
      <ThemeProvider theme={theme}>
        <PathPickerField label="P" value="/abc" onChange={vi.fn()} />
      </ThemeProvider>,
    );
    rerender(
      <ThemeProvider theme={theme}>
        <PathPickerField label="P" value="/abcd" onChange={vi.fn()} />
      </ThemeProvider>,
    );
    // Wait past the 350ms debounce.
    await new Promise((resolve) => setTimeout(resolve, 500));
    // Exactly one call, for the final value.
    expect(stat).toHaveBeenCalledTimes(1);
    expect(stat).toHaveBeenLastCalledWith("/abcd");
  });
});
