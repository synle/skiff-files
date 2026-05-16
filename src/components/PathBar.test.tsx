import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import PathBar from "./PathBar";

// Stub the Tauri API surface so committing smb:// in the test
// environment routes through the mocked OS handler instead of an
// undefined invoke. Mirrors what the real fsOpenWithDefault wraps.
vi.mock("../api/fs", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../api/fs");
  return {
    ...actual,
    fsCanonicalize: vi.fn(async (p: string) => p),
    fsRevealInOs: vi.fn(),
    fsOpenWithDefault: vi.fn(async () => {}),
  };
});
vi.mock("../api/client", () => ({ listDir: vi.fn(async () => []) }));
// Friendly-label test for Bug 4 needs connList to resolve a known
// connection. Default no-op for the existing cases.
vi.mock("../api/conn", () => ({
  connList: vi.fn(async () => []),
}));

const theme = createTheme();

function renderBar(props: {
  path?: string;
  onNavigate?: (p: string) => void;
  onHome?: () => void;
}) {
  const onNavigate = props.onNavigate ?? vi.fn();
  const onHome = props.onHome ?? vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <PathBar
        path={props.path ?? "/Users/syle/git"}
        onNavigate={onNavigate}
        onHome={onHome}
      />
    </ThemeProvider>,
  );
  return { onNavigate, onHome };
}

describe("PathBar", () => {
  it("renders one breadcrumb per segment", () => {
    renderBar({ path: "/Users/syle/git" });
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("syle")).toBeInTheDocument();
    expect(screen.getByText("git")).toBeInTheDocument();
  });

  it("clicking a segment calls onNavigate with the absolute prefix", () => {
    const { onNavigate } = renderBar({ path: "/Users/syle/git" });
    fireEvent.click(screen.getByText("syle"));
    expect(onNavigate).toHaveBeenCalledWith("/Users/syle");
  });

  it("home button fires onHome", () => {
    const { onHome } = renderBar({ path: "/" });
    fireEvent.click(screen.getByLabelText("Home"));
    expect(onHome).toHaveBeenCalled();
  });

  it("edit button switches to a text field", () => {
    renderBar({ path: "/Users/syle" });
    fireEvent.click(screen.getByLabelText("Edit path"));
    // The text field replaces the breadcrumb when editing — find the input
    // by role since MUI strips inputProps in some configurations.
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  // smb:// (and sftp:// / ftp:// host-form URLs) now flow through
  // RemoteConnectDialog via the skiff:connect-to-remote window
  // CustomEvent. The OS handoff from 0.2.262 was retired in 0.2.265
  // when the native pavao-free `smb2` backend landed. The dialog
  // resolves the URL to a `<scheme>://<uuid>/...` form and Browser
  // navigates from there.
  it("committing an smb:// path dispatches skiff:connect-to-remote", async () => {
    const listener = vi.fn();
    window.addEventListener("skiff:connect-to-remote", listener);
    const { onNavigate } = renderBar({ path: "/Users/syle" });
    fireEvent.click(screen.getByLabelText("Edit path"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "smb://192.168.1.1/share" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await Promise.resolve();
    await Promise.resolve();
    expect(listener).toHaveBeenCalled();
    const detail = (listener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toMatchObject({
      scheme: "smb",
      host: "192.168.1.1",
      remotePath: "/share",
    });
    expect(onNavigate).not.toHaveBeenCalled();
    window.removeEventListener("skiff:connect-to-remote", listener);
  });

  // Bug 4 — friendly label + chip variants. Each remote scheme
  // (SMB / SFTP / FTP) must produce its own chip text and aria-label,
  // and the raw UUID must NEVER appear as visible text. Only the SMB
  // variant existed before; the SFTP / FTP cases pin the contract
  // for every protocol the address bar handles.
  it("renders an SFTP protocol chip + friendly label in place of the UUID", async () => {
    const { connList } = await import("../api/conn");
    (connList as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "sftp-id", kind: "sftp", label: "user@example.com:22" },
    ]);
    renderBar({ path: "sftp://sftp-id/home/user/file.txt" });
    expect(
      screen.getByLabelText(/sftp connection root/i),
    ).toBeInTheDocument();
    expect(screen.getByText("SFTP")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("user@example.com:22")).toBeInTheDocument(),
    );
    expect(screen.queryByText("sftp-id")).toBeNull();
    expect(screen.getByText("home")).toBeInTheDocument();
    expect(screen.getByText("file.txt")).toBeInTheDocument();
  });

  it("renders an FTP protocol chip + friendly label in place of the UUID", async () => {
    const { connList } = await import("../api/conn");
    (connList as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "ftp-id", kind: "ftp", label: "anonymous@mirror.kernel.org:21" },
    ]);
    renderBar({ path: "ftp://ftp-id/pub/linux/file.iso" });
    expect(
      screen.getByLabelText(/ftp connection root/i),
    ).toBeInTheDocument();
    expect(screen.getByText("FTP")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText("anonymous@mirror.kernel.org:21"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("ftp-id")).toBeNull();
    expect(screen.getByText("pub")).toBeInTheDocument();
    expect(screen.getByText("file.iso")).toBeInTheDocument();
  });

  // Aria-label per scheme — keeps screen readers from saying "smb
  // connection root" on an SFTP URL etc. Three calls, three different
  // labels.
  it("chip aria-label uses the matching scheme name per kind", () => {
    // No connList wait needed — chip renders synchronously from
    // parseLocation, so we can assert the aria-label even with the
    // default empty connList resolution.
    renderBar({ path: "smb://abc/share" });
    expect(screen.getByLabelText("smb connection root")).toBeInTheDocument();
  });

  // UUID-leak guard — when the connection registry has NOT resolved
  // (connList rejected, or the id isn't in the map yet), the chip
  // still renders, but the raw UUID must NOT appear as a visible
  // breadcrumb segment (it gets filtered as the leading segment).
  // The friendly label simply doesn't render yet.
  it("UUID never appears as a visible breadcrumb segment, even before connList resolves", async () => {
    // Mock connList to never resolve in test timing — empty map.
    const { connList } = await import("../api/conn");
    (connList as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    renderBar({ path: "smb://feedface-0000-0000-0000-000000000000/share/x" });
    // UUID must not be in any visible text node.
    expect(
      screen.queryByText(/feedface-0000-0000-0000-000000000000/),
    ).toBeNull();
    // But the share / file segments still render.
    expect(screen.getByText("share")).toBeInTheDocument();
    expect(screen.getByText("x")).toBeInTheDocument();
  });

  // Bug 4 regression — when browsing a remote URL the address bar
  // must show a protocol chip + the registry's friendly label
  // (`admin@192.168.1.1:445/G`) instead of the raw UUID. Mirrors the
  // tab-strip contract.
  it("renders an SMB protocol chip + friendly label in place of the UUID", async () => {
    const { connList } = await import("../api/conn");
    (connList as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "abc-uuid", kind: "smb", label: "admin@192.168.1.1:445/G" },
    ]);
    renderBar({ path: "smb://abc-uuid/folder/file.txt" });
    // Protocol chip carries the backend kind in upper case — renders
    // synchronously regardless of connList.
    expect(
      screen.getByLabelText(/smb connection root/i),
    ).toBeInTheDocument();
    expect(screen.getByText("SMB")).toBeInTheDocument();
    // Friendly label resolves async via connList — wait for it.
    await waitFor(() =>
      expect(
        screen.getByText("admin@192.168.1.1:445/G"),
      ).toBeInTheDocument(),
    );
    // Raw UUID is NOT in the breadcrumb (it lives in the chip
    // tooltip's hidden title attr, but no visible text node).
    expect(screen.queryByText("abc-uuid")).toBeNull();
    // Share-relative segments still render.
    expect(screen.getByText("folder")).toBeInTheDocument();
    expect(screen.getByText("file.txt")).toBeInTheDocument();
  });
});
