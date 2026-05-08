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

  it("renders the Settings page when the Settings sidebar link is clicked", () => {
    render(frame("/"));
    fireEvent.click(screen.getByText("Settings"));
    expect(
      screen.getByRole("heading", { name: "Settings", level: 4 }),
    ).toBeInTheDocument();
  });

  it("Settings page has the theme selector", () => {
    render(frame("/"));
    fireEvent.click(screen.getByText("Settings"));
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

  it("Cmd/Ctrl+\\ toggles the sidebar (user-preferred binding)", async () => {
    render(frame("/"));
    expect(screen.getByText("Favorites")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    await waitFor(() => {
      expect(screen.queryByText("Favorites")).not.toBeInTheDocument();
    });
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText("Favorites")).toBeInTheDocument();
    });
  });

  it("Cmd/Ctrl+Shift+\\ does not toggle the sidebar (reserved for split view)", () => {
    render(frame("/"));
    expect(screen.getByText("Favorites")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true, shiftKey: true });
    // Sidebar stays visible — Shift variant routes to twoPaneMode instead.
    expect(screen.getByText("Favorites")).toBeInTheDocument();
  });
});
