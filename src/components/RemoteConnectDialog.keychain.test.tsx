// Pins the save-to-OS-keychain wiring: when the user toggles
// Remember password ON and the global Settings →
// `saveCredentialsToKeychain` flag is true AND the OS keychain
// probe succeeds, the connect dialog MUST persist the secret via
// `credsStore` instead of inlining a plaintext `password` field in
// `Settings.connections`. The opposite arm (toggle off, or
// keychain unavailable, or setting flipped off) keeps the legacy
// plaintext-in-settings.json behavior intact.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { ThemeProvider, createTheme } from "@mui/material";
import { SettingsProvider, useSettings } from "../state/settings";
import RemoteConnectDialog, {
  type RemoteConnectRequest,
} from "./RemoteConnectDialog";

vi.mock("../api/conn", () => ({
  connCreateSftp: vi.fn(async () => "sftp-uuid"),
  connCreateFtp: vi.fn(async () => "ftp-uuid"),
  connCreateSmb: vi.fn(async () => "smb-uuid"),
  smbListShares: vi.fn(async () => []),
}));

const credsStore = vi.fn(async (_id: string, _kind: string, _secret: string) => {});
const credsLoad = vi.fn(async (_id: string, _kind: string) => null as string | null);
const credsDelete = vi.fn(async (_id: string, _kind: string) => {});
const credsCapable = vi.fn(async () => true);

vi.mock("../api/creds", () => ({
  credsStore: (...a: unknown[]) => credsStore(...(a as [string, string, string])),
  credsLoad: (...a: unknown[]) => credsLoad(...(a as [string, string])),
  credsDelete: (...a: unknown[]) => credsDelete(...(a as [string, string])),
  credsCapable: () => credsCapable(),
}));

const theme = createTheme();

beforeEach(() => {
  localStorage.clear();
  credsStore.mockClear();
  credsLoad.mockClear();
  credsDelete.mockClear();
  credsCapable.mockClear();
  credsCapable.mockResolvedValue(true);
});

function ConnectionsProbe() {
  // Exposes the live settings.connections array to the test so it
  // can inspect what got persisted after the connect flow runs.
  const { settings } = useSettings();
  return (
    <div data-testid="connections-json">
      {JSON.stringify(settings.connections)}
    </div>
  );
}

function SettingFlipper({ flag }: { flag: boolean }) {
  // Drives the saveCredentialsToKeychain bit on mount so the
  // dialog's first render reads the desired setting. SettingsProvider
  // initializes to the schema default (true); we override only when
  // the test asks for false.
  const { settings, update } = useSettings();
  useEffect(() => {
    if (settings.saveCredentialsToKeychain !== flag) {
      update("saveCredentialsToKeychain", flag);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flag]);
  return null;
}

function renderDialog(
  request: RemoteConnectRequest,
  saveToKeychain: boolean,
) {
  render(
    <ThemeProvider theme={theme}>
      <SettingsProvider>
        <SettingFlipper flag={saveToKeychain} />
        <RemoteConnectDialog
          open
          request={request}
          onClose={vi.fn()}
          onConnected={vi.fn()}
        />
        <ConnectionsProbe />
      </SettingsProvider>
    </ThemeProvider>,
  );
}

async function fillAndConnect(opts: {
  remember: boolean;
  /** Optional substring of the helper text under the toggle that we
   *  wait for before clicking Connect — guards against a race where
   *  `credsCapable()` hasn't resolved yet and the connect handler
   *  reads a stale `keychainAvailable=false`. */
  expectHelperContains?: string;
}) {
  const userInput = screen.getByLabelText(/User/) as HTMLInputElement;
  fireEvent.change(userInput, { target: { value: "admin" } });
  const passwordInput = screen.getByLabelText(/Password/) as HTMLInputElement;
  fireEvent.change(passwordInput, { target: { value: "hunter2" } });
  // The Remember-password toggle defaults OFF; only flip it ON
  // when the test wants persistence.
  if (opts.remember) {
    fireEvent.click(screen.getByLabelText(/Remember password/));
  }
  if (opts.expectHelperContains) {
    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(opts.expectHelperContains!, "i")),
      ).toBeInTheDocument();
    });
  }
  fireEvent.click(screen.getByRole("button", { name: /Connect/i }));
}

function parseConnections(): Array<{
  id: string;
  password?: string;
  rememberPassword?: boolean;
}> {
  const node = screen.getByTestId("connections-json");
  return JSON.parse(node.textContent ?? "[]");
}

describe("RemoteConnectDialog — Remember password store routing", () => {
  it("keychain ON + capable + Remember ON → credsStore called, settings.json carries no password", async () => {
    renderDialog(
      { scheme: "ftp", host: "10.0.0.1", port: 21, remotePath: "/" },
      true,
    );
    await fillAndConnect({
      remember: true,
      expectHelperContains: "Stored in the OS keychain",
    });
    await waitFor(() => {
      expect(credsStore).toHaveBeenCalledTimes(1);
    });
    expect(credsStore.mock.calls[0][1]).toBe("auth");
    expect(credsStore.mock.calls[0][2]).toBe("hunter2");
    // 0.2.307 — wrapped in waitFor to match the other three tests
    // in this file. CI runners sometimes commit the React state
    // update from `update("connections", ...)` AFTER the credsStore
    // promise resolves; reading parseConnections synchronously
    // raced the re-render and produced an empty list. The store
    // call ordering is unchanged — only the test polls longer.
    await waitFor(() => {
      expect(parseConnections()).toHaveLength(1);
    });
    const rows = parseConnections();
    expect(rows[0].password).toBeUndefined();
    expect(rows[0].rememberPassword).toBe(true);
  });

  it("keychain OFF + Remember ON → settings.json holds the plaintext, no credsStore call", async () => {
    renderDialog(
      { scheme: "ftp", host: "10.0.0.2", port: 21, remotePath: "/" },
      false,
    );
    await fillAndConnect({ remember: true });
    await waitFor(() => {
      const rows = parseConnections();
      expect(rows).toHaveLength(1);
      expect(rows[0].password).toBe("hunter2");
    });
    expect(credsStore).not.toHaveBeenCalled();
    // The opposite store gets cleared so a previously-keychain'd
    // entry doesn't keep a stale copy alive.
    expect(credsDelete).toHaveBeenCalledTimes(1);
  });

  it("keychain unavailable falls back to plaintext even when the setting is on", async () => {
    credsCapable.mockResolvedValueOnce(false);
    renderDialog(
      { scheme: "ftp", host: "10.0.0.3", port: 21, remotePath: "/" },
      true,
    );
    await fillAndConnect({ remember: true });
    await waitFor(() => {
      const rows = parseConnections();
      expect(rows).toHaveLength(1);
      expect(rows[0].password).toBe("hunter2");
    });
    expect(credsStore).not.toHaveBeenCalled();
  });

  it("Remember password OFF → nothing persisted in either store; keychain still gets a defensive delete", async () => {
    renderDialog(
      { scheme: "ftp", host: "10.0.0.4", port: 21, remotePath: "/" },
      true,
    );
    await fillAndConnect({ remember: false });
    await waitFor(() => {
      const rows = parseConnections();
      expect(rows).toHaveLength(1);
      expect(rows[0].rememberPassword).toBeFalsy();
      expect(rows[0].password).toBeUndefined();
    });
    expect(credsStore).not.toHaveBeenCalled();
    expect(credsDelete).toHaveBeenCalledTimes(1);
  });
});
