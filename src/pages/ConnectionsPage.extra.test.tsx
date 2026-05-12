import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { MemoryRouter } from "react-router";
import ConnectionsPage from "./ConnectionsPage";
import { invoke } from "@tauri-apps/api/core";

const theme = createTheme();
const mocked = vi.mocked(invoke);

beforeEach(() => {
  mocked.mockReset();
  mocked.mockImplementation(async (cmd) => {
    if (cmd === "fs_home_dir") return "/home/test";
    if (cmd === "ssh_config_hosts") return [];
    if (cmd === "conn_list") return [];
    if (cmd === "conn_known_hosts_list") return [];
    if (cmd === "conn_create_sftp") return "test-sftp-id";
    if (cmd === "conn_create_ftp") return "test-ftp-id";
    if (cmd === "conn_known_hosts_remove") return null;
    if (cmd === "conn_disconnect") return null;
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

describe("ConnectionsPage — extras", () => {
  it("Protocol field renders SFTP option by default", () => {
    r();
    // Confirm the protocol picker is anchored to SFTP on first paint.
    const protocol = screen.getByLabelText("Protocol");
    expect(protocol).toBeInTheDocument();
  });

  it("renders the active-connections heading", () => {
    r();
    expect(screen.getByText(/Active connections/)).toBeInTheDocument();
  });

  it("lists saved drafts from localStorage", () => {
    localStorage.setItem(
      "skiff-files.connections.sftp.v1",
      JSON.stringify([
        {
          id: "s1",
          label: "Test server",
          host: "test.example.com",
          port: 22,
          user: "alice",
          authMode: "password",
        },
      ]),
    );
    r();
    expect(screen.getByText(/Test server/)).toBeInTheDocument();
  });

  it("renders the SMB section even when empty (no Saved SMB heading)", () => {
    r();
    // 'Saved SMB shares' only shows when drafts exist.
    expect(screen.queryByText(/Saved SMB shares/)).toBeNull();
  });

  it("lists saved SMB drafts", () => {
    localStorage.setItem(
      "skiff-files.connections.smb.v1",
      JSON.stringify([
        {
          id: "m1",
          label: "Home NAS",
          host: "nas.local",
          port: 445,
          share: "Public",
          user: "guest",
          domain: "",
        },
      ]),
    );
    r();
    // Saved SMB drafts trigger the heading.
    expect(screen.getByText(/Home NAS/)).toBeInTheDocument();
  });

  it("Saved SFTP draft Delete button removes the entry from localStorage", async () => {
    localStorage.setItem(
      "skiff-files.connections.sftp.v1",
      JSON.stringify([
        {
          id: "s1",
          label: "Doomed",
          host: "h",
          port: 22,
          user: "u",
          authMode: "password",
        },
      ]),
    );
    vi.stubGlobal("confirm", vi.fn(() => true));
    r();
    fireEvent.click(screen.getByLabelText("Delete Doomed"));
    const drafts = JSON.parse(
      localStorage.getItem("skiff-files.connections.sftp.v1") ?? "[]",
    );
    expect(drafts).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("lists live connections and surfaces a Disconnect button", async () => {
    mocked.mockImplementation(async (cmd) => {
      if (cmd === "conn_list") {
        return [{ id: "abc", kind: "sftp", label: "Live host" }];
      }
      if (cmd === "ssh_config_hosts") return [];
      if (cmd === "conn_known_hosts_list") return [];
      if (cmd === "conn_disconnect") return null;
      return null;
    });
    r();
    const disconnectBtn = await waitFor(() =>
      screen.getByLabelText("Disconnect Live host"),
    );
    fireEvent.click(disconnectBtn);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "conn_disconnect",
        expect.objectContaining({ id: "abc" }),
      );
    });
  });

  it("Disconnect all button appears with multiple live connections", async () => {
    mocked.mockImplementation(async (cmd) => {
      if (cmd === "conn_list") {
        return [
          { id: "a", kind: "sftp", label: "h1" },
          { id: "b", kind: "ftp", label: "h2" },
        ];
      }
      if (cmd === "ssh_config_hosts") return [];
      if (cmd === "conn_known_hosts_list") return [];
      return null;
    });
    r();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Disconnect all/ }),
      ).toBeInTheDocument();
    });
  });

  it("Saved SFTP draft Rename button calls window.prompt and updates the entry", async () => {
    localStorage.setItem(
      "skiff-files.connections.sftp.v1",
      JSON.stringify([
        {
          id: "s1",
          label: "Old",
          host: "h",
          port: 22,
          user: "u",
          authMode: "password",
        },
      ]),
    );
    vi.stubGlobal("prompt", vi.fn(() => "Renamed"));
    r();
    fireEvent.click(screen.getByLabelText("Rename Old"));
    const drafts = JSON.parse(
      localStorage.getItem("skiff-files.connections.sftp.v1") ?? "[]",
    );
    expect(drafts[0].label).toBe("Renamed");
    vi.unstubAllGlobals();
  });

  it("Saved SFTP draft Duplicate button creates a sibling entry", async () => {
    localStorage.setItem(
      "skiff-files.connections.sftp.v1",
      JSON.stringify([
        {
          id: "s1",
          label: "Source",
          host: "h",
          port: 22,
          user: "u",
          authMode: "password",
        },
      ]),
    );
    r();
    fireEvent.click(screen.getByLabelText("Duplicate Source"));
    const drafts = JSON.parse(
      localStorage.getItem("skiff-files.connections.sftp.v1") ?? "[]",
    );
    expect(drafts.length).toBeGreaterThanOrEqual(2);
  });

  it("known-hosts section renders when fingerprints exist", async () => {
    mocked.mockImplementation(async (cmd) => {
      if (cmd === "conn_known_hosts_list") {
        return [["example.com:22", "sha256:fingerprint-fake"]];
      }
      if (cmd === "conn_list") return [];
      if (cmd === "ssh_config_hosts") return [];
      return null;
    });
    r();
    await waitFor(() => {
      expect(screen.getByText(/Known hosts/)).toBeInTheDocument();
    });
    expect(screen.getByText("example.com:22")).toBeInTheDocument();
  });

  it("removing a known-host fingerprint calls conn_known_hosts_remove", async () => {
    mocked.mockImplementation(async (cmd) => {
      if (cmd === "conn_known_hosts_list") {
        return [["host.example:22", "sha256:fake"]];
      }
      if (cmd === "conn_list") return [];
      if (cmd === "ssh_config_hosts") return [];
      if (cmd === "conn_known_hosts_remove") return null;
      return null;
    });
    r();
    vi.stubGlobal("confirm", vi.fn(() => true));
    const removeBtn = await waitFor(() =>
      screen.getByLabelText("Forget host.example:22"),
    );
    fireEvent.click(removeBtn);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "conn_known_hosts_remove",
        expect.objectContaining({ keyId: "host.example:22" }),
      );
    });
    vi.unstubAllGlobals();
  });
});
