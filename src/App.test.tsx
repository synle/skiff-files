import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import App from "./App";
import { ThemeProvider, createTheme } from "@mui/material";
import { SettingsProvider } from "./state/settings";

const theme = createTheme();

// Settings persist via localStorage; clear between tests so a previous
// test's setting (e.g. sidebarVisible=false from the toggle test) can't
// leak into the next.
beforeEach(() => {
  localStorage.clear();
});

// Match the FileList test fixture — jsdom doesn't lay things out, so the
// virtualizer needs a coaxed bounding rect.
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

function frame(initialPath: string) {
  return (
    <SettingsProvider>
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={[initialPath]}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    </SettingsProvider>
  );
}

describe("App", () => {
  it("renders the sidebar with Favorites + Hosts + Devices sections", () => {
    render(frame("/"));
    expect(screen.getByText("Favorites")).toBeInTheDocument();
    expect(screen.getByText("Hosts")).toBeInTheDocument();
    expect(screen.getByText("Devices")).toBeInTheDocument();
  });

  it("renders the Settings page when navigated to /settings", () => {
    render(frame("/settings"));
    expect(
      screen.getByRole("heading", { name: "Settings", level: 4 }),
    ).toBeInTheDocument();
  });

  it("Settings page has the theme selector", () => {
    render(frame("/settings"));
    expect(screen.getByLabelText(/Theme$/)).toBeInTheDocument();
  });

  it("Cmd/Ctrl+B hides the sidebar", async () => {
    render(frame("/"));
    expect(screen.getByText("Favorites")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    await waitFor(() => {
      expect(screen.queryByText("Favorites")).not.toBeInTheDocument();
    });
  });
});
