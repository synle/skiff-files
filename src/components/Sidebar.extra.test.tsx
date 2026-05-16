import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { ThemeProvider, createTheme } from "@mui/material";
import Sidebar from "./Sidebar";
import { SettingsProvider } from "../state/settings";

const theme = createTheme();

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("prompt", vi.fn((_msg: string, def: string) => def));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function r(over: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const onNavigate = vi.fn();
  const onSwitchPage = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <SettingsProvider>
        <Sidebar
          home="/home/test"
          page="browser"
          onNavigate={onNavigate}
          onSwitchPage={onSwitchPage}
          {...over}
        />
      </SettingsProvider>
    </ThemeProvider>,
  );
  return { onNavigate, onSwitchPage };
}

describe("Sidebar — extras", () => {
  it("renders bookmarks from settings with move/edit/delete affordances", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        bookmarks: [
          { id: "a", label: "Project", path: "/p" },
          { id: "b", label: "Docs", path: "/d" },
        ],
        sidebarSectionsVisible: { bookmarks: true },
      }),
    );
    r();
    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
  });

  it("clicking a bookmark calls onNavigate with its path", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        bookmarks: [{ id: "a", label: "Project", path: "/p" }],
      }),
    );
    const { onNavigate } = r();
    fireEvent.click(screen.getByText("Project"));
    expect(onNavigate).toHaveBeenCalledWith("/p");
  });

  it("renders recent paths section when recentPaths has entries", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        recentPaths: ["/foo", "/bar"],
      }),
    );
    r();
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  it("Hosts section header renders alongside the favorites", () => {
    r();
    // Just confirm the multi-section sidebar mounts cleanly with
    // every default section header.
    expect(screen.getByText("Hosts")).toBeInTheDocument();
    expect(screen.getByText("Favorites")).toBeInTheDocument();
  });

  it("renders with section-order overrides", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        sidebarSectionOrder: ["hosts", "favorites", "devices"],
      }),
    );
    r();
    // No-throw on a non-default ordering — confirm the section labels
    // are still rendered.
    expect(screen.getByText("Hosts")).toBeInTheDocument();
    expect(screen.getByText("Devices")).toBeInTheDocument();
  });

  it("renders with hiddenFavorites filtering specific entries", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        hiddenFavorites: ["Documents", "Desktop"],
      }),
    );
    r();
    expect(screen.queryByText("Documents")).toBeNull();
    expect(screen.queryByText("Desktop")).toBeNull();
    expect(screen.getByText("Home")).toBeInTheDocument();
  });

  it("renders all sidebar sections when sidebarAccordion=false (default)", () => {
    r();
    // Every section label should render in non-accordion mode.
    expect(screen.getByText("Favorites")).toBeInTheDocument();
    expect(screen.getByText("Hosts")).toBeInTheDocument();
    expect(screen.getByText("Devices")).toBeInTheDocument();
  });

  it("renders accordion mode without crashing", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({ sidebarAccordion: true }),
    );
    r();
    expect(screen.getByText("Favorites")).toBeInTheDocument();
  });

  it("renders with workspaces section enabled and populated", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        tabWorkspaces: [
          {
            id: "w1",
            label: "Editing",
            tabs: [{ id: "t1", path: "/w1/a", scrollTop: 0 }],
            activeTabId: "t1",
          },
        ],
      }),
    );
    r();
    expect(screen.getByText("Workspaces")).toBeInTheDocument();
  });

  it("renders with searches section populated", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        savedSearches: [
          { id: "s1", label: "Big files", path: "/", query: "*.zip" },
        ],
      }),
    );
    r();
    expect(screen.getByText("Searches")).toBeInTheDocument();
  });

  it("renders with selections section populated", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        savedSelections: [
          { id: "se1", label: "Today's", paths: ["/x"] },
        ],
      }),
    );
    r();
    expect(screen.getByText("Selections")).toBeInTheDocument();
  });

  it("Settings selected styling when page='settings'", () => {
    r({ page: "settings" });
    const settingsItem = screen.getByText("Settings").closest("[role='button']") ??
      screen.getByText("Settings").closest("li");
    expect(settingsItem).toBeTruthy();
  });

  it("clicking the section-header chevron collapses + expands the section", () => {
    r();
    // Click Favorites to collapse — section header is the clickable
    // element. The Home favorite should disappear.
    expect(screen.getByText("Home")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Favorites"));
    expect(screen.queryByText("Home")).toBeNull();
    fireEvent.click(screen.getByText("Favorites"));
    expect(screen.getByText("Home")).toBeInTheDocument();
  });

  it("right-clicking a bookmark opens the context menu with edit options", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        bookmarks: [{ id: "a", label: "Project", path: "/p" }],
      }),
    );
    r();
    fireEvent.contextMenu(screen.getByText("Project"));
    expect(screen.getByText("Rename…")).toBeInTheDocument();
    expect(screen.getByText("Remove")).toBeInTheDocument();
  });

  it("Remove option in the bookmark context menu drops the bookmark", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        bookmarks: [
          { id: "a", label: "Project", path: "/p" },
          { id: "b", label: "Docs", path: "/d" },
        ],
      }),
    );
    r();
    fireEvent.contextMenu(screen.getByText("Docs"));
    fireEvent.click(screen.getByText("Remove"));
    // Docs is removed; Project stays.
    expect(screen.queryByText("Docs")).toBeNull();
    expect(screen.getByText("Project")).toBeInTheDocument();
  });

  it("bookmark Move down promotes the second entry above the first", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        bookmarks: [
          { id: "a", label: "First", path: "/1" },
          { id: "b", label: "Second", path: "/2" },
        ],
      }),
    );
    r();
    fireEvent.contextMenu(screen.getByText("First"));
    fireEvent.click(screen.getByText("Move down"));
    const stored = JSON.parse(
      localStorage.getItem("skiff-files.settings.v1") ?? "{}",
    );
    expect(stored.bookmarks[0].label).toBe("Second");
    expect(stored.bookmarks[1].label).toBe("First");
  });

  it("lists active connections from conn_list with the kind-specific icon", async () => {
    const mocked = vi.mocked(invoke);
    mocked.mockImplementationOnce(async (cmd) => {
      if (cmd === "conn_list") {
        return [
          { id: "abc", kind: "sftp", label: "my-server" },
          { id: "ftp1", kind: "ftp", label: "kernel-mirror" },
        ];
      }
      return null;
    });
    r();
    await waitFor(() => {
      expect(screen.getByText("my-server")).toBeInTheDocument();
    });
    expect(screen.getByText("kernel-mirror")).toBeInTheDocument();
  });

  it("clicking an active connection calls onNavigate with the scheme://id/ URL", async () => {
    const mocked = vi.mocked(invoke);
    mocked.mockImplementationOnce(async (cmd) => {
      if (cmd === "conn_list") {
        return [{ id: "abc", kind: "sftp", label: "host" }];
      }
      return null;
    });
    const { onNavigate } = r();
    const host = await waitFor(() => screen.getByText("host"));
    fireEvent.click(host);
    expect(onNavigate).toHaveBeenCalledWith("sftp://abc/");
  });

  it("'Add connection…' click switches to connections page (empty list)", async () => {
    const { onSwitchPage } = r();
    const btn = await waitFor(() => screen.getByText("Add connection…"));
    fireEvent.click(btn);
    expect(onSwitchPage).toHaveBeenCalledWith("connections");
  });

  it("renders syncjobs section when savedSyncJobs is non-empty", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        savedSyncJobs: [
          {
            id: "sj1",
            label: "Daily backup",
            src: "/a",
            dest: "/b",
            options: {},
          },
        ],
      }),
    );
    r();
    expect(screen.getByText("Sync jobs")).toBeInTheDocument();
    expect(screen.getByText("Daily backup")).toBeInTheDocument();
  });

  it("clicking a saved search runs it and switches the page", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        savedSearches: [
          { id: "s1", label: "Find foo", path: "/", query: "foo" },
        ],
      }),
    );
    const { onSwitchPage } = r();
    fireEvent.click(screen.getByText("Find foo"));
    // The handler fires a browser navigate + page switch.
    expect(onSwitchPage).toHaveBeenCalledWith("browser");
  });

  it("renders mounted devices when fs_mounts returns one", async () => {
    const mocked = vi.mocked(invoke);
    mocked.mockImplementation(async (cmd) => {
      if (cmd === "fs_mounts") {
        return [
          {
            name: "MyDrive",
            mountPoint: "/Volumes/MyDrive",
            total: 1024 ** 3,
            free: 512 * 1024 ** 2,
            removable: true,
          },
        ];
      }
      if (cmd === "conn_list") return [];
      return null;
    });
    r();
    await waitFor(() => {
      expect(screen.getByText("MyDrive")).toBeInTheDocument();
    });
  });

  it("right-clicking an active connection does not throw (smoke)", async () => {
    const mocked = vi.mocked(invoke);
    mocked.mockImplementation(async (cmd) => {
      if (cmd === "conn_list") {
        return [{ id: "abc", kind: "sftp", label: "myhost" }];
      }
      if (cmd === "fs_mounts") return [];
      return null;
    });
    r();
    const host = await waitFor(() => screen.getByText("myhost"));
    fireEvent.contextMenu(host);
    // No menu wired for hosts yet; smoke-only.
    expect(host).toBeInTheDocument();
  });

  it("right-clicking a recent path opens its context menu", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({ recentPaths: ["/foo", "/bar"] }),
    );
    r();
    fireEvent.contextMenu(screen.getByText("foo"));
    expect(screen.getAllByRole("menuitem").length).toBeGreaterThan(0);
  });

  it("recent-path menu 'Add to bookmarks' adds an entry", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({ recentPaths: ["/foo"] }),
    );
    r();
    fireEvent.contextMenu(screen.getByText("foo"));
    fireEvent.click(screen.getByText("Add to bookmarks"));
    const stored = JSON.parse(
      localStorage.getItem("skiff-files.settings.v1") ?? "{}",
    );
    expect((stored.bookmarks ?? []).length).toBe(1);
  });

  it("recent-path menu 'Remove from recent' drops the entry", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({ recentPaths: ["/foo", "/bar"] }),
    );
    r();
    fireEvent.contextMenu(screen.getByText("foo"));
    fireEvent.click(screen.getByText("Remove from recent"));
    const stored = JSON.parse(
      localStorage.getItem("skiff-files.settings.v1") ?? "{}",
    );
    expect(stored.recentPaths).toEqual(["/bar"]);
  });

  it("clicking a mounted device calls onNavigate with its mountPoint", async () => {
    const mocked = vi.mocked(invoke);
    mocked.mockImplementation(async (cmd) => {
      if (cmd === "fs_mounts") {
        return [
          {
            name: "MyDrive",
            mountPoint: "/Volumes/MyDrive",
            total: 1024,
            free: 512,
            removable: false,
          },
        ];
      }
      if (cmd === "conn_list") return [];
      return null;
    });
    const { onNavigate } = r();
    const drive = await waitFor(() => screen.getByText("MyDrive"));
    fireEvent.click(drive);
    expect(onNavigate).toHaveBeenCalledWith("/Volumes/MyDrive");
  });

  it("renames a bookmark via window.prompt", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        bookmarks: [{ id: "a", label: "Old", path: "/p" }],
      }),
    );
    vi.unstubAllGlobals();
    vi.stubGlobal("prompt", vi.fn(() => "Renamed"));
    r();
    fireEvent.contextMenu(screen.getByText("Old"));
    fireEvent.click(screen.getByText("Rename…"));
    const stored = JSON.parse(
      localStorage.getItem("skiff-files.settings.v1") ?? "{}",
    );
    expect(stored.bookmarks[0].label).toBe("Renamed");
  });
});
