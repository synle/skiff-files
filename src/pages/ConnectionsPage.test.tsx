import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { MemoryRouter } from "react-router";
import ConnectionsPage from "./ConnectionsPage";
import { invoke } from "@tauri-apps/api/core";

const theme = createTheme();
const mocked = vi.mocked(invoke);

/** Reset mock call history AND implementation so a previous test's
 *  mockImplementation override doesn't bleed in. We re-apply the
 *  default-mock subset this file's tests need. */
beforeEach(() => {
  mocked.mockReset();
  mocked.mockImplementation(async (cmd, _args) => {
    if (cmd === "fs_home_dir") return "/home/test";
    if (cmd === "fs_list_dir") return [];
    if (cmd === "ssh_config_hosts") return [];
    if (cmd === "conn_list") return [];
    if (cmd === "conn_disconnect") return null;
    if (cmd === "conn_known_hosts_list") return [];
    if (cmd === "conn_known_hosts_remove") return null;
    if (cmd === "settings_load") return null;
    return null;
  });
  localStorage.clear();
});

function r() {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <ConnectionsPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe("ConnectionsPage", () => {
  it("renders the page heading + Add-connection button", () => {
    r();
    expect(screen.getByText("Manage Connections")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Add connection/i }),
    ).toBeInTheDocument();
  });

  it("opens the unified RemoteConnectDialog when Add connection is clicked", () => {
    r();
    fireEvent.click(screen.getByRole("button", { name: /Add connection/i }));
    // RemoteConnectDialog renders its own protocol picker. We just
    // assert the dialog showed up by finding its role.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the empty-state message when no live connections exist", async () => {
    r();
    await waitFor(() => {
      expect(screen.getByText(/No live connections/i)).toBeInTheDocument();
    });
  });

  it("does not render the legacy inline ssh-config import dropdown", async () => {
    // ssh-config import now lives in RemoteConnectDialog; the page
    // itself no longer reads ~/.ssh/config.
    mocked.mockImplementation(async (cmd) => {
      if (cmd === "ssh_config_hosts") {
        return [
          {
            name: "myserver",
            hostName: "example.com",
            user: "alice",
            port: 2222,
            identityFile: "~/.ssh/id_rsa",
          },
        ];
      }
      if (cmd === "conn_list") return [];
      if (cmd === "conn_known_hosts_list") return [];
      return null;
    });
    r();
    await waitFor(() => {
      expect(screen.getByText("Manage Connections")).toBeInTheDocument();
    });
    expect(
      screen.queryByLabelText("Import host from ssh config"),
    ).not.toBeInTheDocument();
  });
});

void vi;
