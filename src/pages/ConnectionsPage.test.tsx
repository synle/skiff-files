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

describe("ConnectionsPage", () => {
  it("renders the page title + Add connection button", () => {
    r();
    expect(screen.getByText("Manage Connections")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add connection" }),
    ).toBeInTheDocument();
  });

  it("shows the empty-state copy when no SFTP drafts are saved", () => {
    r();
    expect(screen.getByText("No saved connections.")).toBeInTheDocument();
  });

  it("lists saved SFTP drafts from localStorage", () => {
    localStorage.setItem(
      "skiff-files.connections.sftp.v1",
      JSON.stringify([
        {
          id: "s-1",
          label: "user@example.com:22",
          host: "example.com",
          port: 22,
          user: "user",
          authMode: "password",
        },
      ]),
    );
    r();
    expect(screen.getByText("user@example.com:22")).toBeInTheDocument();
  });

  it("shows live connections from the registry", async () => {
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "conn_list") {
        return [{ id: "live-1", kind: "sftp", label: "user@host:22" }];
      }
      if (cmd === "conn_known_hosts_list") return [];
      if (cmd === "ssh_config_hosts") return [];
      return null;
    });
    r();
    await waitFor(() => {
      expect(screen.getByText("user@host:22")).toBeInTheDocument();
    });
    expect(screen.getByText("SFTP")).toBeInTheDocument();
  });

  it("lists saved SMB drafts when present", () => {
    localStorage.setItem(
      "skiff-files.connections.smb.v1",
      JSON.stringify([
        {
          id: "smb-1",
          label: "admin@nas:445/G",
          host: "nas",
          port: 445,
          user: "admin",
          share: "G",
          domain: "",
        },
      ]),
    );
    r();
    expect(screen.getByText("Saved SMB connections")).toBeInTheDocument();
    expect(screen.getByText("admin@nas:445/G")).toBeInTheDocument();
  });

  it("Disconnect button appears on live connections", async () => {
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "conn_list") {
        return [{ id: "live-1", kind: "sftp", label: "myhost" }];
      }
      if (cmd === "conn_known_hosts_list") return [];
      if (cmd === "ssh_config_hosts") return [];
      return null;
    });
    r();
    await waitFor(() => {
      expect(
        screen.getByLabelText("Disconnect myhost"),
      ).toBeInTheDocument();
    });
  });
});
