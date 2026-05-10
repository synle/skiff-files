// Sidebar tests — focus on the regressions the user has hit:
//   - Section header click toggling collapsed state (was broken
//     because SectionHeader was defined inline in the parent
//     component, which made React tear it down + remount it on
//     every render, dropping the click handler).
//   - Static nav buttons (Settings / Transfers / Connections)
//     correctly call `onSwitchPage` so we don't regress to the
//     react-router path that silently no-op'd.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import Sidebar from "./Sidebar";
import { SettingsProvider } from "../state/settings";

const theme = createTheme();

beforeEach(() => {
  localStorage.clear();
});

function r(props?: Partial<Parameters<typeof Sidebar>[0]>) {
  const onNavigate = props?.onNavigate ?? vi.fn();
  const onSwitchPage = props?.onSwitchPage ?? vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <SettingsProvider>
        <Sidebar
          home="/home/test"
          page="browser"
          onSwitchPage={onSwitchPage}
          onNavigate={onNavigate}
          {...props}
        />
      </SettingsProvider>
    </ThemeProvider>,
  );
  return { onNavigate, onSwitchPage };
}

describe("Sidebar", () => {
  it("renders the headline section labels", () => {
    r();
    expect(screen.getByText("Favorites")).toBeInTheDocument();
    expect(screen.getByText("Hosts")).toBeInTheDocument();
    expect(screen.getByText("Devices")).toBeInTheDocument();
  });

  it("clicking the Favorites header toggles its collapsed state", () => {
    r();
    // Initially expanded — Home is rendered inside Favorites.
    expect(screen.getByText("Home")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Favorites"));
    // After collapse, the children should disappear.
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Favorites"));
    expect(screen.getByText("Home")).toBeInTheDocument();
  });

  it("Settings nav button calls onSwitchPage('settings')", () => {
    const { onSwitchPage } = r();
    fireEvent.click(screen.getByText("Settings"));
    expect(onSwitchPage).toHaveBeenCalledWith("settings");
  });

  it("Transfers nav button calls onSwitchPage('transfers')", () => {
    const { onSwitchPage } = r();
    fireEvent.click(screen.getByText("Transfers"));
    expect(onSwitchPage).toHaveBeenCalledWith("transfers");
  });

  it("clicking a Favorite calls onNavigate with the joined path", () => {
    const { onNavigate } = r({ home: "/home/test" });
    // Inside Favorites, click Home — it should fire onNavigate
    // with the home path (basename mode).
    const favsList = screen
      .getByText("Favorites")
      .parentElement?.parentElement;
    if (!favsList) throw new Error("Favorites group not found");
    fireEvent.click(within(favsList).getByText("Home"));
    expect(onNavigate).toHaveBeenCalled();
  });

  // Regression for 0.2.131 — `Settings.hiddenFavorites` filters
  // hardcoded favorites out of the sidebar so users can hide
  // individual entries (Home / Desktop / Documents / Downloads /
  // Trash) without nuking the whole section.
  it("hides favorites listed in Settings.hiddenFavorites", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({ hiddenFavorites: ["Desktop", "Downloads"] }),
    );
    r();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.queryByText("Desktop")).not.toBeInTheDocument();
    expect(screen.queryByText("Downloads")).not.toBeInTheDocument();
    expect(screen.getByText("Documents")).toBeInTheDocument();
  });

  // Regression for 0.2.130 — section header gets a hover-only ×
  // icon that hides the entire section. Settings → Sidebar is the
  // only way to bring it back.
  it("section hide × button writes sidebarSectionsVisible[id]=false", () => {
    r();
    // The hide icon has aria-label "Hide Favorites section".
    const hideBtn = screen.getByLabelText("Hide Favorites section");
    fireEvent.click(hideBtn);
    const stored = JSON.parse(
      localStorage.getItem("skiff-files.settings.v1") ?? "{}",
    );
    expect(stored.sidebarSectionsVisible.favorites).toBe(false);
    // The Favorites label should also disappear from the DOM.
    expect(screen.queryByText("Favorites")).not.toBeInTheDocument();
  });

  // Regression for 0.2.131 — bookmarks ship with inline ↑↓× icons
  // PLUS a context menu that mirrors the actions. The menu's
  // disabled state must agree with the inline buttons so users
  // don't see "Move up" enabled at index 0.
  it("right-click on the first bookmark shows Move up disabled", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        bookmarks: [
          { id: "a", label: "A", path: "/a" },
          { id: "b", label: "B", path: "/b" },
        ],
      }),
    );
    r();
    fireEvent.contextMenu(screen.getByText("A"));
    const moveUp = screen.getByText("Move up").closest("li");
    expect(moveUp).toHaveAttribute("aria-disabled", "true");
    const moveDown = screen.getByText("Move down").closest("li");
    expect(moveDown).not.toHaveAttribute("aria-disabled", "true");
  });

  it("right-click on the last bookmark shows Move down disabled", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        bookmarks: [
          { id: "a", label: "A", path: "/a" },
          { id: "b", label: "B", path: "/b" },
        ],
      }),
    );
    r();
    fireEvent.contextMenu(screen.getByText("B"));
    const moveDown = screen.getByText("Move down").closest("li");
    expect(moveDown).toHaveAttribute("aria-disabled", "true");
  });

  // Regression for 0.2.238 — `Settings.sidebarSectionOrder` drives
  // each section's CSS `order` so the visual stack reflects the
  // user's preferred ordering. We don't assert pixel positions
  // here (jsdom doesn't lay things out); we assert the `order`
  // style numbers, which the layout engine consumes.
  it("applies CSS order from sidebarSectionOrder", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        // Put hosts first, devices second, then favorites — the
        // exact inverse of the built-in default for the three
        // visible sections.
        sidebarSectionOrder: ["hosts", "devices", "favorites"],
        bookmarks: [],
      }),
    );
    r();
    // Find the wrapper Box for each visible section by walking up
    // from the header label. The wrapper is the Box that carries
    // `style.order` — it's the parent (skipping the header's
    // `<button>` and inline label-flex Box).
    const wrapperFor = (label: string): HTMLElement => {
      let el: HTMLElement | null = screen.getByText(label);
      while (el && (el.style?.order ?? "") === "") {
        el = el.parentElement;
      }
      if (!el) throw new Error(`No order wrapper for ${label}`);
      return el;
    };
    expect(wrapperFor("Hosts").style.order).toBe("0");
    expect(wrapperFor("Devices").style.order).toBe("1");
    expect(wrapperFor("Favorites").style.order).toBe("2");
  });

  // Empty array = built-in default order (favorites→…→devices).
  it("uses built-in default order when sidebarSectionOrder is empty", () => {
    r();
    const wrapperFor = (label: string): HTMLElement => {
      let el: HTMLElement | null = screen.getByText(label);
      while (el && (el.style?.order ?? "") === "") {
        el = el.parentElement;
      }
      if (!el) throw new Error(`No order wrapper for ${label}`);
      return el;
    };
    // SIDEBAR_SECTION_DEFAULT_ORDER puts favorites first (index 0),
    // hosts at index 7, devices at index 8.
    expect(wrapperFor("Favorites").style.order).toBe("0");
    expect(wrapperFor("Hosts").style.order).toBe("7");
    expect(wrapperFor("Devices").style.order).toBe("8");
  });
});
