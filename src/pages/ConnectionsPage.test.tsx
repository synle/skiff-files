// Tests for the merged Manage Connections page. The old page had a
// two-section split — "Active connections" (live Rust registry) on
// top, "Saved SFTP / FTP / SMB connections" below in localStorage —
// and disconnect/delete semantics were tangled across the two. The
// new shape is ONE list per saved connection, sourced from
// `Settings.connections`, with a status pill computed from the live
// registry and three row actions (Connect/Disconnect, Edit, Delete).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { ThemeProvider, createTheme } from "@mui/material";
import { SettingsProvider } from "../state/settings";
import ConnectionsPage from "./ConnectionsPage";

const theme = createTheme();
const mockedInvoke = vi.mocked(invoke);

function r() {
  return render(
    <ThemeProvider theme={theme}>
      <SettingsProvider>
        <ConnectionsPage />
      </SettingsProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockedInvoke.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConnectionsPage (merged list)", () => {
  it("renders the page title + Add connection button", () => {
    r();
    expect(screen.getByText("Manage Connections")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add connection" }),
    ).toBeInTheDocument();
  });

  it("shows the empty-state copy when no connections are saved", () => {
    r();
    expect(screen.getByText(/No connections yet/)).toBeInTheDocument();
  });

  it("lists every saved connection from settings.connections", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        connections: [
          {
            id: "s-1",
            kind: "sftp",
            label: "user@example.com:22",
            host: "example.com",
            port: 22,
            user: "user",
            authMode: "password",
            rememberPassword: false,
          },
          {
            id: "m-1",
            kind: "smb",
            label: "admin@nas:445/G",
            host: "nas",
            port: 445,
            user: "admin",
            share: "G",
            rememberPassword: false,
          },
        ],
      }),
    );
    r();
    expect(screen.getByText("user@example.com:22")).toBeInTheDocument();
    expect(screen.getByText("admin@nas:445/G")).toBeInTheDocument();
    expect(screen.getByText("SFTP")).toBeInTheDocument();
    expect(screen.getByText("SMB")).toBeInTheDocument();
  });

  it("marks a connection as Connected when it appears in the live registry", async () => {
    // 0.2.309: ids are canonical URL form (`user@host`). The saved
    // row + live registry slot must share the same id for the
    // "Connected" pill to render — the migration loader rewrites
    // any pre-0.2.309 synthetic id, so we author both ends with the
    // post-migration shape.
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        connections: [
          {
            id: "user@host",
            kind: "sftp",
            label: "user@host:22",
            host: "host",
            port: 22,
            user: "user",
            authMode: "password",
            rememberPassword: false,
          },
        ],
      }),
    );
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "conn_list") {
        return [{ id: "user@host", kind: "sftp", label: "user@host:22" }];
      }
      if (cmd === "conn_known_hosts_list") return [];
      return null;
    });
    r();
    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
  });

  it("Delete button opens a confirmation dialog and removes the entry on confirm", async () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        connections: [
          {
            id: "to-delete",
            kind: "ftp",
            label: "mirror",
            host: "mirror",
            port: 21,
            user: "anonymous",
            rememberPassword: false,
          },
        ],
      }),
    );
    mockedInvoke.mockResolvedValue([]);
    r();
    fireEvent.click(screen.getByLabelText("Delete mirror"));
    expect(screen.getByText(/Delete "mirror"\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Delete/i }));
    await waitFor(() => {
      expect(screen.queryByText("mirror")).not.toBeInTheDocument();
    });
    const stored = JSON.parse(
      localStorage.getItem("skiff-files.settings.v1") ?? "{}",
    );
    expect(stored.connections).toEqual([]);
  });

  it("Edit button opens the dialog pre-filled with the connection's details", async () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        connections: [
          {
            id: "edit-1",
            kind: "sftp",
            label: "alice@srv:22",
            host: "srv",
            port: 22,
            user: "alice",
            authMode: "password",
            rememberPassword: false,
          },
        ],
      }),
    );
    mockedInvoke.mockResolvedValue([]);
    r();
    fireEvent.click(screen.getByLabelText("Edit alice@srv:22"));
    await waitFor(() => {
      const userInput = screen.getByLabelText(/User/) as HTMLInputElement;
      expect(userInput.value).toBe("alice");
    });
    const hostInput = screen.getByLabelText(/Host/) as HTMLInputElement;
    expect(hostInput.value).toBe("srv");
  });

  it("Saved password badge renders when rememberPassword is true", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        connections: [
          {
            id: "pw-1",
            kind: "ftp",
            label: "ftpsrv",
            host: "ftpsrv",
            port: 21,
            user: "anonymous",
            rememberPassword: true,
            password: "anonymous@",
          },
        ],
      }),
    );
    r();
    expect(screen.getByText("Saved password")).toBeInTheDocument();
  });

  it("migrates legacy per-kind drafts into Settings.connections on first load", () => {
    localStorage.setItem(
      "skiff-files.connections.v1",
      JSON.stringify([
        {
          id: "legacy-sftp",
          label: "legacy@host:22",
          host: "host",
          port: 22,
          user: "legacy",
          authMode: "password",
        },
      ]),
    );
    localStorage.setItem(
      "skiff-files.connections.ftp.v1",
      JSON.stringify([
        {
          id: "legacy-ftp",
          label: "ftpmirror",
          host: "ftpmirror",
          port: 21,
          user: "anonymous",
        },
      ]),
    );
    r();
    expect(screen.getByText("legacy@host:22")).toBeInTheDocument();
    expect(screen.getByText("ftpmirror")).toBeInTheDocument();
  });
});
