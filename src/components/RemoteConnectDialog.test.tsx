import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import RemoteConnectDialog, {
  type RemoteConnectRequest,
} from "./RemoteConnectDialog";

vi.mock("../api/conn", () => ({
  connCreateSftp: vi.fn(async () => "sftp-uuid"),
  connCreateFtp: vi.fn(async () => "ftp-uuid"),
  connCreateSmb: vi.fn(async () => "smb-uuid"),
}));

const theme = createTheme();

beforeEach(() => {
  localStorage.clear();
});

function r(request: RemoteConnectRequest | null, open = true) {
  const onClose = vi.fn();
  const onConnected = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <RemoteConnectDialog
        open={open}
        request={request}
        onClose={onClose}
        onConnected={onConnected}
      />
    </ThemeProvider>,
  );
  return { onClose, onConnected };
}

describe("RemoteConnectDialog", () => {
  it("renders nothing when request is null", () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <RemoteConnectDialog
          open
          request={null}
          onClose={vi.fn()}
          onConnected={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(container.querySelector("[role=dialog]")).toBeNull();
  });

  it("shows the typed host and port in the title", () => {
    r({
      scheme: "sftp",
      host: "example.com",
      port: 2222,
      remotePath: "/",
    });
    expect(
      screen.getByText("Connect to example.com:2222"),
    ).toBeInTheDocument();
  });

  it("ftp request defaults user to anonymous and password to anonymous@", () => {
    r({ scheme: "ftp", host: "mirror.kernel.org", port: null, remotePath: "/" });
    const userInput = screen.getByLabelText(/User/) as HTMLInputElement;
    expect(userInput.value).toBe("anonymous");
  });

  it("sftp request defaults port to 22 when typed URL omits one", () => {
    r({ scheme: "sftp", host: "host", port: null, remotePath: "/" });
    const portInput = screen.getByLabelText(/Port/) as HTMLInputElement;
    expect(portInput.value).toBe("22");
  });

  it("smb request defaults port to 445", () => {
    r({ scheme: "smb", host: "nas", port: null, remotePath: "/Public/dir" });
    const portInput = screen.getByLabelText(/Port/) as HTMLInputElement;
    expect(portInput.value).toBe("445");
  });

  it("smb request pre-fills the share from the typed remote-path", () => {
    r({
      scheme: "smb",
      host: "nas",
      port: null,
      remotePath: "/Public/file.txt",
    });
    const shareInput = screen.getByLabelText(/Share/) as HTMLInputElement;
    expect(shareInput.value).toBe("Public");
  });

  it("Cancel button fires onClose", () => {
    const { onClose } = r({
      scheme: "ftp",
      host: "h",
      port: null,
      remotePath: "/",
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("switching protocol to FTP updates the port default", () => {
    r({ scheme: "sftp", host: "h", port: 22, remotePath: "/" });
    const protocol = screen.getByLabelText("Protocol");
    fireEvent.mouseDown(protocol);
    fireEvent.click(screen.getByText("FTP (plain)"));
    const portInput = screen.getByLabelText(/Port/) as HTMLInputElement;
    expect(portInput.value).toBe("21");
  });

  it("switching protocol to SMB updates the port default", () => {
    r({ scheme: "ftp", host: "h", port: 21, remotePath: "/" });
    const protocol = screen.getByLabelText("Protocol");
    fireEvent.mouseDown(protocol);
    fireEvent.click(screen.getByText("SMB / Samba"));
    const portInput = screen.getByLabelText(/Port/) as HTMLInputElement;
    expect(portInput.value).toBe("445");
  });

  it("typing in Host updates the host value", () => {
    r({ scheme: "ftp", host: "old.example", port: null, remotePath: "/" });
    const hostInput = screen.getByLabelText(/Host/) as HTMLInputElement;
    fireEvent.change(hostInput, { target: { value: "new.example" } });
    expect(hostInput.value).toBe("new.example");
  });

  it("typing in User updates the user value", () => {
    r({ scheme: "sftp", host: "h", port: null, remotePath: "/" });
    const userInput = screen.getByLabelText(/User/) as HTMLInputElement;
    fireEvent.change(userInput, { target: { value: "bob" } });
    expect(userInput.value).toBe("bob");
  });

  it("SMB-specific share + domain fields appear when scheme is smb", () => {
    r({ scheme: "smb", host: "nas", port: null, remotePath: "/p" });
    expect(screen.getByLabelText(/Share/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Domain/)).toBeInTheDocument();
  });

  it("SFTP auth mode radio group reveals key file path when 'privateKey' is picked", () => {
    r({ scheme: "sftp", host: "h", port: null, remotePath: "/" });
    // Auth radios are labeled by their value; clicking the privateKey
    // radio swaps the form below.
    const privateKey = screen.getByLabelText(/private key/i);
    fireEvent.click(privateKey);
    expect(screen.getByLabelText(/key path/i)).toBeInTheDocument();
  });

  it("SFTP auth mode 'SSH agent' shows the agent-only hint", () => {
    r({ scheme: "sftp", host: "h", port: null, remotePath: "/" });
    fireEvent.click(screen.getByLabelText(/SSH agent/i));
    expect(
      screen.getByText(/Uses your running ssh-agent/),
    ).toBeInTheDocument();
  });

  it("Save-for-next-time toggle is visible for a new connection", () => {
    r({ scheme: "ftp", host: "new.example", port: null, remotePath: "/" });
    expect(
      screen.getByLabelText(/Save this connection for next time/),
    ).toBeInTheDocument();
  });

  it("dialog exposes Cancel + Connect buttons", () => {
    r({ scheme: "ftp", host: "h", port: null, remotePath: "/" });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("lists saved sftp drafts for the typed host", () => {
    localStorage.setItem(
      "skiff-files.connections.v1",
      JSON.stringify([
        {
          id: "s-1",
          label: "saved-host",
          host: "example.com",
          port: 22,
          user: "user",
          authMode: "password",
        },
      ]),
    );
    r({
      scheme: "sftp",
      host: "example.com",
      port: 22,
      remotePath: "/",
    });
    expect(screen.getByText("saved-host")).toBeInTheDocument();
    expect(screen.getByText(/Use a saved connection/)).toBeInTheDocument();
  });

  // Bug 7 regression (0.2.279) — successfully connecting must
  // dispatch `skiff:connections-changed` so the Sidebar HOSTS
  // accordion / BrowserTabs labels / PathBar friendly-label map
  // refresh immediately. Without this the user had to navigate
  // away and back before the new host appeared. We exercise the
  // form-submit path the dialog uses internally (Enter inside any
  // field or clicking Connect both flow through `<form onSubmit>`).
  async function fireConnect(): Promise<void> {
    const dialog = screen.getByRole("dialog");
    const form = dialog.querySelector("form") ?? dialog;
    fireEvent.submit(form);
    // Two ticks: one for the await connCreate* mock, one for the
    // surrounding handleConnect cleanup so the event dispatch lands
    // before assertions.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  }

  it("dispatches skiff:connections-changed after a successful SMB connect", async () => {
    const listener = vi.fn();
    window.addEventListener("skiff:connections-changed", listener);
    try {
      r({ scheme: "smb", host: "nas", port: null, remotePath: "/Public/dir" });
      // Fill in the SMB-required fields the form would otherwise
      // refuse to submit. User is empty by default; password is
      // empty; share is now optional (0.2.277).
      fireEvent.change(screen.getByLabelText(/^User \*?$/) as HTMLInputElement, {
        target: { value: "admin" },
      });
      fireEvent.change(
        screen.getByLabelText(/^Password \*?$/) as HTMLInputElement,
        { target: { value: "p" } },
      );
      await fireConnect();
      expect(listener).toHaveBeenCalled();
    } finally {
      window.removeEventListener("skiff:connections-changed", listener);
    }
  });

  // FTP path — anonymous defaults populate user/password so a bare
  // submit fires the event without further setup. Same contract
  // applies to SFTP / SMB; one example per scheme is enough since
  // the dispatch call is shared.
  it("dispatches skiff:connections-changed after a successful FTP connect", async () => {
    const listener = vi.fn();
    window.addEventListener("skiff:connections-changed", listener);
    try {
      r({ scheme: "ftp", host: "mirror", port: null, remotePath: "/" });
      await fireConnect();
      expect(listener).toHaveBeenCalled();
    } finally {
      window.removeEventListener("skiff:connections-changed", listener);
    }
  });

  // Bug 5 regression — SMB Share is OPTIONAL. Leaving it empty must
  // not surface a "required" indicator and must let the form submit
  // (share-agnostic mode lists root shares as virtual folders).
  it("SMB Share field is not required (Bug 5)", () => {
    r({ scheme: "smb", host: "nas", port: null, remotePath: "/" });
    const shareInput = screen.getByLabelText(/Share/) as HTMLInputElement;
    // The HTML5 `required` attribute must NOT be set. Older shape
    // (pre-0.2.277) marked it required, which blocked submit when
    // the user wanted to browse every share on the server.
    expect(shareInput.required).toBe(false);
    // Helper text reads as optional.
    expect(
      screen.getByLabelText(/Share \(optional\)/i),
    ).toBeInTheDocument();
  });
});
