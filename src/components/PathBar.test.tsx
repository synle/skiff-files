import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
});
