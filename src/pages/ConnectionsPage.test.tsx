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
    if (cmd === "conn_create_sftp") return "test-conn-id";
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
  it("renders the new-connection form", () => {
    r();
    expect(screen.getByLabelText(/Host/)).toBeInTheDocument();
    expect(screen.getByLabelText(/User/)).toBeInTheDocument();
    expect(screen.getByText("Connect")).toBeInTheDocument();
  });

  it("disables Connect until host + user are filled", () => {
    r();
    const btn = screen.getByText("Connect");
    expect(btn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Host/), {
      target: { value: "example.com" },
    });
    fireEvent.change(screen.getByLabelText(/User/), {
      target: { value: "alice" },
    });
    expect(btn).not.toBeDisabled();
  });

  it("invokes conn_create_sftp on Connect and saves a draft", async () => {
    r();
    fireEvent.change(screen.getByLabelText(/Host/), {
      target: { value: "example.com" },
    });
    fireEvent.change(screen.getByLabelText(/User/), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText(/Password/), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "conn_create_sftp",
        expect.objectContaining({
          config: expect.objectContaining({
            host: "example.com",
            user: "alice",
            password: "hunter2",
          }),
        }),
      );
    });

    // Draft persisted (no password!).
    const drafts = JSON.parse(
      localStorage.getItem("skiff-files.connections.sftp.v1") ?? "[]",
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].host).toBe("example.com");
    expect(drafts[0]).not.toHaveProperty("password");
  });

  it("shows the empty-state message when no live connections exist", async () => {
    r();
    await waitFor(() => {
      expect(screen.getByText(/No live connections/i)).toBeInTheDocument();
    });
  });

  it("ssh-config import dropdown appears when ~/.ssh/config has hosts", async () => {
    // Override the default mock to return one parsed host.
    const mocked = vi.mocked(invoke);
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
    // Wait for the dropdown to render once `sshConfigHosts()` resolves
    // and the empty-array guard becomes truthy.
    await waitFor(() => {
      expect(
        screen.getByLabelText("Import host from ssh config"),
      ).toBeInTheDocument();
    });
    // The label text "Import from `~/.ssh/config`:" is present too,
    // proving the section rendered.
    expect(screen.getByText(/Import from/)).toBeInTheDocument();
  });

  it("hides the ssh-config dropdown when there are no parseable hosts", async () => {
    r(); // default mock returns [] for ssh_config_hosts
    await waitFor(() => {
      expect(screen.getByText(/Active connections/)).toBeInTheDocument();
    });
    expect(
      screen.queryByLabelText("Import host from ssh config"),
    ).not.toBeInTheDocument();
  });
});

void vi;
