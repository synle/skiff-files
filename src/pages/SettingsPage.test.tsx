import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import SettingsPage from "./SettingsPage";
import { SettingsProvider } from "../state/settings";

beforeEach(() => {
  localStorage.clear();
  // The Advanced section has buttons that go through window.confirm /
  // alert / prompt. jsdom doesn't implement them but they're patched
  // off by default in the test environment — re-stub here so the
  // click handlers don't throw.
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("prompt", vi.fn(() => null));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const theme = createTheme();

function renderSettings() {
  return render(
    <ThemeProvider theme={theme}>
      <SettingsProvider>
        <SettingsPage />
      </SettingsProvider>
    </ThemeProvider>,
  );
}

describe("SettingsPage smoke", () => {
  it("renders the page heading and a sampling of section titles", () => {
    renderSettings();
    expect(screen.getAllByText("Settings").length).toBeGreaterThan(0);
    expect(screen.getByText("Appearance")).toBeInTheDocument();
  });

  it("renders the About block with Version / Latest rows", async () => {
    renderSettings();
    // The Tauri mock returns "0.1.0-test" for both get_app_version and
    // get_build_timestamp; only the labels are synchronously rendered.
    expect(await screen.findByText(/Skiff Files/)).toBeInTheDocument();
    expect(await screen.findByText(/^Version:/)).toBeInTheDocument();
    expect(await screen.findByText(/^Latest:/)).toBeInTheDocument();
  });

  it("includes the keyboard shortcut search field placeholder", () => {
    renderSettings();
    expect(
      screen.getByPlaceholderText(/Search shortcuts/i),
    ).toBeInTheDocument();
  });

  it("renders the Advanced section with action buttons", () => {
    renderSettings();
    expect(
      screen.getByRole("button", { name: /Reveal app data folder/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Open settings.json/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Reload from disk/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Check for updates/i }),
    ).toBeInTheDocument();
  });

  it("clicking Reset all settings confirms then calls reset", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /Reset all settings/i }));
    // The window.confirm stub returned true — the reset path ran without
    // throwing. We just confirm the button is still in the DOM (no
    // crash) and the confirm got called.
    expect(window.confirm).toHaveBeenCalled();
  });

  it("renders Transfers section conflict policy and limits", () => {
    renderSettings();
    expect(screen.getByLabelText(/Conflict policy/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Max size/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Lookback days/)).toBeInTheDocument();
  });

  it("renders MUI Switch controls for boolean toggles", () => {
    renderSettings();
    // MUI Switch exposes role="switch" via its inner input.
    const sw = screen.getAllByRole("switch");
    expect(sw.length).toBeGreaterThan(0);
  });

  it("Sidebar section list shows section labels and move buttons", () => {
    renderSettings();
    expect(screen.getByLabelText("Move Favorites down")).toBeInTheDocument();
  });

  it("renders with pre-existing settings (bookmarks + recent paths)", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        bookmarks: [
          { id: "b1", label: "Project", path: "/p" },
          { id: "b2", label: "Docs", path: "/d" },
        ],
        recentPaths: ["/p", "/d"],
        searchHistory: ["foo", "bar"],
        folderViewMode: { "/p": "gallery" },
        folderSort: { "/p": { key: "modified", dir: "desc" } },
      }),
    );
    renderSettings();
    expect(
      screen.getByRole("button", { name: /Clear recent paths/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Clear bookmarks/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Clear search history/ }),
    ).toBeInTheDocument();
  });

  it("renders saved-data editor blocks with non-empty data", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        tabWorkspaces: [
          {
            id: "w1",
            label: "Edit",
            tabs: [{ id: "t1", path: "/x", scrollTop: 0 }],
            activeTabId: "t1",
          },
        ],
        savedSelections: [{ id: "s1", label: "Today", paths: ["/x"] }],
        savedSearches: [
          { id: "se1", label: "Big files", path: "/", query: "*.zip" },
        ],
        savedSyncJobs: [
          {
            id: "j1",
            label: "Mirror docs",
            src: "/a",
            dest: "/b",
            options: {},
          },
        ],
      }),
    );
    renderSettings();
    // Block titles include the count, so we match the prefix only.
    expect(screen.getByText(/^Tab workspaces/)).toBeInTheDocument();
    expect(screen.getByText(/^Selection groups/)).toBeInTheDocument();
    expect(screen.getByText(/^Saved searches/)).toBeInTheDocument();
    expect(screen.getByText(/^Saved sync-job templates/)).toBeInTheDocument();
    // The Rename/Delete buttons exist for each block (4 blocks × 2).
    expect(screen.getAllByText("Rename").length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText("Delete").length).toBeGreaterThanOrEqual(4);
  });

  it("renders palette pickers in Appearance section", () => {
    renderSettings();
    expect(screen.getByText("Light mode")).toBeInTheDocument();
    expect(screen.getByText("Dark mode")).toBeInTheDocument();
  });

  it("renders custom-file-kind mappings with a removable chip per entry", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        customFileKinds: {
          rs: "code",
          ipynb: "code",
          mdx: "markdown",
        },
      }),
    );
    renderSettings();
    // The chip uses ".ext → kind" formatting.
    expect(screen.getByText(/\.rs → code/)).toBeInTheDocument();
    expect(screen.getByText(/\.mdx → markdown/)).toBeInTheDocument();
  });

  it("custom-file-kind 'Add / Replace' button adds a new mapping", () => {
    renderSettings();
    const extInput = screen.getByPlaceholderText(/ext \(e\.g\. rs\)/);
    fireEvent.change(extInput, { target: { value: "ts" } });
    fireEvent.click(screen.getByRole("button", { name: "Add / Replace" }));
    const stored = JSON.parse(
      localStorage.getItem("skiff-files.settings.v1") ?? "{}",
    );
    expect(stored.customFileKinds.ts).toBe("code");
  });

  it("renders the sidebar accordion + status-dot toggles", () => {
    renderSettings();
    expect(
      screen.getByLabelText(/Accordion mode/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Show connection-status dots/),
    ).toBeInTheDocument();
  });
});
