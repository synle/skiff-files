import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import ShortcutsModal from "./ShortcutsModal";
import { SettingsProvider } from "../state/settings";

const theme = createTheme();

function r() {
  return render(
    <SettingsProvider>
      <ThemeProvider theme={theme}>
        <ShortcutsModal />
      </ThemeProvider>
    </SettingsProvider>,
  );
}

describe("ShortcutsModal", () => {
  it("is closed by default", () => {
    r();
    expect(screen.queryByText("Keyboard shortcuts")).not.toBeInTheDocument();
  });

  it("opens on `?` key", () => {
    r();
    fireEvent.keyDown(window, { key: "?", code: "Slash", shiftKey: true });
    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument();
  });

  it("closes on `?` key after opening (toggle)", async () => {
    r();
    fireEvent.keyDown(window, { key: "?", code: "Slash", shiftKey: true });
    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "?", code: "Slash", shiftKey: true });
    // MUI Dialog has an exit transition — wait for the modal to leave
    // the DOM rather than asserting synchronously.
    await waitFor(() => {
      expect(screen.queryByText("Keyboard shortcuts")).not.toBeInTheDocument();
    });
  });

  it("closes via the close button", async () => {
    r();
    fireEvent.keyDown(window, { key: "?", code: "Slash", shiftKey: true });
    fireEvent.click(screen.getByLabelText("Close shortcuts"));
    await waitFor(() => {
      expect(screen.queryByText("Keyboard shortcuts")).not.toBeInTheDocument();
    });
  });

  it("ignores `?` typed inside an input", () => {
    render(
      <SettingsProvider>
        <ThemeProvider theme={theme}>
          <input data-testid="input" />
          <ShortcutsModal />
        </ThemeProvider>
      </SettingsProvider>,
    );
    const input = screen.getByTestId("input") as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: "?" });
    expect(screen.queryByText("Keyboard shortcuts")).not.toBeInTheDocument();
  });

  it("renders the documented binding groups", () => {
    r();
    fireEvent.keyDown(window, { key: "?", code: "Slash", shiftKey: true });
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Selection")).toBeInTheDocument();
    expect(screen.getByText("View")).toBeInTheDocument();
  });
});
