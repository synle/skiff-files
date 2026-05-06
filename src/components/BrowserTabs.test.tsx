import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { MemoryRouter } from "react-router";
import BrowserTabs from "./BrowserTabs";
import { SettingsProvider } from "../state/settings";

const theme = createTheme();

// jsdom needs a viewport for the virtualized FileList that lives inside
// each Browser; same shim as Browser/FileList tests.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      toJSON: () => "",
    } as DOMRect;
  };
});

function r() {
  return render(
    <SettingsProvider>
      <ThemeProvider theme={theme}>
        <MemoryRouter>
          <BrowserTabs home="/home/test" />
        </MemoryRouter>
      </ThemeProvider>
    </SettingsProvider>,
  );
}

describe("BrowserTabs", () => {
  it("starts with one tab labeled Home", () => {
    r();
    expect(screen.getByRole("tab", { name: /Home/ })).toBeInTheDocument();
  });

  it("clicking the + button opens a second tab", () => {
    r();
    fireEvent.click(screen.getByLabelText("New tab"));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("closes a tab via the close icon", () => {
    r();
    fireEvent.click(screen.getByLabelText("New tab"));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // The close icon on the first tab.
    const closeButtons = screen.getAllByLabelText(/Close tab/);
    fireEvent.click(closeButtons[0]);
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("refuses to close the last remaining tab", () => {
    r();
    // With only one tab, the close icon shouldn't even render.
    expect(screen.queryByLabelText(/Close tab/)).not.toBeInTheDocument();
  });

  it("Cmd/Ctrl+T spawns a new tab", () => {
    r();
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });
});
