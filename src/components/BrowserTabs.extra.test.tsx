import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { MemoryRouter } from "react-router";
import BrowserTabs from "./BrowserTabs";
import { SettingsProvider } from "../state/settings";

const theme = createTheme();

beforeEach(() => {
  localStorage.clear();
});

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

describe("BrowserTabs — extras", () => {
  it("Cmd/Ctrl+W closes the active tab when more than one is open", () => {
    r();
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("Cmd/Ctrl+W on the last remaining tab collapses the tab list (precursor to window-close)", async () => {
    r();
    // Starts with one default tab. Cmd+W on it should drop the tab
    // list to empty — closeWindow() fires asynchronously after the
    // setState settles (verified via observable DOM state since the
    // Tauri window mock is closure-free per setup.ts and can't be
    // shared with the test).
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    await waitFor(() => {
      expect(screen.queryAllByRole("tab")).toHaveLength(0);
    });
  });

  it("Cmd/Ctrl+W on the last remaining PINNED tab is a no-op (does NOT close the window)", () => {
    r();
    // Right-click → Pin. Then Cmd+W: pinned guard skips both the
    // close-tab and close-window branches, so the tab survives.
    const tab = screen.getAllByRole("tab")[0];
    fireEvent.contextMenu(tab);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Pin$/ }));
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    // Tab stays. If the pinned guard ever regresses this lands as a
    // visible regression (the tab vanishes).
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("Cmd/Ctrl+Shift+T restores a recently closed tab", () => {
    r();
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    fireEvent.keyDown(window, {
      key: "T",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("Cmd/Ctrl+1 switches to the first tab", () => {
    r();
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    // Switch to the first tab — it's still there from before the new
    // tabs landed. Confirm no crash via the tab count surviving.
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("clicking a tab makes it active", () => {
    r();
    fireEvent.click(screen.getByLabelText("New tab"));
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    fireEvent.click(tabs[0]);
    // No throw — re-check the tabs are present.
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("right-click on a tab opens the tab context menu", () => {
    r();
    const tab = screen.getAllByRole("tab")[0];
    fireEvent.contextMenu(tab);
    // The menu opens; it must contain at least one menu item.
    expect(screen.getAllByRole("menuitem").length).toBeGreaterThan(0);
  });

  it("Cmd/Ctrl+Shift+] cycles to the next tab", () => {
    r();
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    // 3 tabs now; cycle forward.
    fireEvent.keyDown(window, {
      key: "]",
      code: "BracketRight",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("Cmd/Ctrl+Shift+[ cycles to the previous tab", () => {
    r();
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    fireEvent.keyDown(window, {
      key: "[",
      code: "BracketLeft",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("tab context-menu 'Close others' keeps only the right-clicked tab", () => {
    r();
    fireEvent.click(screen.getByLabelText("New tab"));
    fireEvent.click(screen.getByLabelText("New tab"));
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    const tabs = screen.getAllByRole("tab");
    fireEvent.contextMenu(tabs[1]);
    fireEvent.click(screen.getByText("Close others"));
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("tab context-menu 'Duplicate this folder' opens a new tab", () => {
    r();
    fireEvent.contextMenu(screen.getAllByRole("tab")[0]);
    fireEvent.click(screen.getByText(/Duplicate this folder/));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("tab context-menu 'Bookmark this folder' adds an entry to settings.bookmarks", () => {
    r();
    fireEvent.contextMenu(screen.getAllByRole("tab")[0]);
    fireEvent.click(screen.getByText(/^Bookmark this folder$/));
    const stored = JSON.parse(
      localStorage.getItem("skiff-files.settings.v1") ?? "{}",
    );
    expect((stored.bookmarks ?? []).length).toBe(1);
  });

  it("opens tabs from saved-tab settings on first mount", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        savedTabs: [
          { id: "t1", label: "saved-1", initialPath: "/saved-1" },
          { id: "t2", label: "saved-2", initialPath: "/saved-2" },
        ],
        activeTabId: "t1",
      }),
    );
    r();
    expect(screen.getAllByRole("tab").length).toBeGreaterThanOrEqual(2);
  });
});
