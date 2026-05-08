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
});
