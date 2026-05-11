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

  // smb:// is special-cased in commit(): no in-app navigation,
  // instead fire fsOpenWithDefault so the OS handler (Finder /
  // Explorer) mounts the share through its native auth flow.
  // Pre-0.2.262 the path fell through to list_dir(smb://...) and
  // surfaced a misleading "No such file or directory" error.
  it("committing an smb:// path routes to the OS handler, not in-app nav", async () => {
    const fsModule = await import("../api/fs");
    const fsOpenWithDefault = vi.mocked(fsModule.fsOpenWithDefault);
    fsOpenWithDefault.mockClear();
    const { onNavigate } = renderBar({ path: "/Users/syle" });
    fireEvent.click(screen.getByLabelText("Edit path"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "smb://192.168.1.1" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    // Flush the microtask + the await inside commit().
    await Promise.resolve();
    await Promise.resolve();
    expect(fsOpenWithDefault).toHaveBeenCalledWith("smb://192.168.1.1");
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
