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

  // Regression for 0.2.129 — `e.key === "."` never matched on macOS US
  // because Shift+. emits ">". Layout-independent matching is critical:
  // accept ".", ">", and `e.code === "Period"` so the binding is stable
  // across layouts.
  it("Cmd/Ctrl+Shift+. fires when key is '.' (US-keyboard literal)", () => {
    render(frame("/"));
    fireEvent.keyDown(window, {
      key: ".",
      ctrlKey: true,
      shiftKey: true,
    });
    // Side effect: showHidden flips. The provider persists to
    // localStorage so we can assert against that without scraping the
    // FileList — keeps the test layout-free.
    const stored = JSON.parse(
      localStorage.getItem("skiff-files.settings.v1") ?? "{}",
    );
    expect(stored.showHidden).toBe(true);
  });

  it("Cmd/Ctrl+Shift+. fires when key is '>' (macOS-emitted Shift+.)", () => {
    render(frame("/"));
    fireEvent.keyDown(window, {
      key: ">",
      ctrlKey: true,
      shiftKey: true,
    });
    const stored = JSON.parse(
      localStorage.getItem("skiff-files.settings.v1") ?? "{}",
    );
    expect(stored.showHidden).toBe(true);
  });

  it("two-pane mode renders a draggable split-bar separator", async () => {
    // Enable two-pane mode before mount so the divider is in the tree.
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({ twoPaneMode: true }),
    );
    render(frame("/"));
    const sep = await screen.findByRole("separator", { name: /Resize panes/ });
    expect(sep).toBeInTheDocument();
  });

  it("dragging the split-bar updates settings.twoPaneSplitRatio", async () => {
    // Container's getBoundingClientRect is mocked to width=800 (above).
    // Dragging the divider to clientX=600 → ratio = 600/800 = 0.75.
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({ twoPaneMode: true, twoPaneSplitRatio: 0.5 }),
    );
    render(frame("/"));
    const sep = await screen.findByRole("separator", { name: /Resize panes/ });
    fireEvent.mouseDown(sep, { clientX: 400 });
    fireEvent(window, new MouseEvent("mousemove", { clientX: 600 }));
    fireEvent(window, new MouseEvent("mouseup"));
    const stored = JSON.parse(
      localStorage.getItem("skiff-files.settings.v1") ?? "{}",
    );
    expect(stored.twoPaneSplitRatio).toBeCloseTo(0.75, 5);
  });

  it("split-bar drag clamps the ratio to [SPLIT_RATIO_MIN, SPLIT_RATIO_MAX]", async () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({ twoPaneMode: true, twoPaneSplitRatio: 0.5 }),
    );
    render(frame("/"));
    const sep = await screen.findByRole("separator", { name: /Resize panes/ });
    fireEvent.mouseDown(sep, { clientX: 400 });
    // Yank far left — would compute negative ratio; clamp floors at 0.15.
    fireEvent(window, new MouseEvent("mousemove", { clientX: -500 }));
    fireEvent(window, new MouseEvent("mouseup"));
    const stored = JSON.parse(
      localStorage.getItem("skiff-files.settings.v1") ?? "{}",
    );
    expect(stored.twoPaneSplitRatio).toBeCloseTo(0.15, 5);
  });

  it("Cmd/Ctrl+Shift+. fires when only e.code is 'Period' (layout-independent)", () => {
    render(frame("/"));
    fireEvent.keyDown(window, {
      key: "Unidentified",
      code: "Period",
      ctrlKey: true,
      shiftKey: true,
    });
    const stored = JSON.parse(
      localStorage.getItem("skiff-files.settings.v1") ?? "{}",
    );
    expect(stored.showHidden).toBe(true);
  });
});
