// Pins the address-bar UUID-leak fix: when the current path is a
// remote `<scheme>://<uuid>/...` URL, the address bar — both in
// breadcrumb display and in the editable text input — must surface
// the FRIENDLY form (`smb://admin@host:445/G/sub`). UUIDs are an
// internal routing key; leaking them into the input caused two real
// bugs:
//   - Image #3 of the 0.2.305 issue: clicking a file forwarded the
//     UUID URL to `fs_open_with_default`, which macOS Finder then
//     resolved as a hostname and surfaced "df204a67-… server not
//     found". The OS-handoff fix lives in `osHandoff.ts`; this file
//     pins the address-bar display half so the UUID never reaches
//     the user-facing input in the first place.
//   - Image #4 of the same issue: hitting the pencil pre-filled the
//     TextField with the raw UUID URL, which is meaningless to the
//     user and (when they pressed Enter) re-triggered the connect
//     dialog instead of round-tripping silently.
//
// The friendly form must also COMMIT back to the canonical UUID
// path when the same active connection is on file, so the user can
// edit the tail of a remote URL without re-opening the connect
// dialog every time.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import PathBar from "./PathBar";

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

vi.mock("../api/conn", () => ({
  connList: vi.fn(async () => [
    {
      id: "df204a67-a012-4d96-aadd-8e48a1da5f40",
      kind: "smb",
      label: "admin@192.168.1.1:445/G",
    },
  ]),
}));

const theme = createTheme();

function renderBar(path: string, onNavigate = vi.fn()) {
  render(
    <ThemeProvider theme={theme}>
      <PathBar path={path} onNavigate={onNavigate} onHome={vi.fn()} />
    </ThemeProvider>,
  );
  return { onNavigate };
}

describe("PathBar — UUID never leaks into the editable input", () => {
  it("pencil → input shows friendly host form, not the UUID", async () => {
    renderBar("smb://df204a67-a012-4d96-aadd-8e48a1da5f40/sub/file.png");
    // Wait for the mocked connList to resolve so the connMap is
    // populated before we open the input.
    await waitFor(() => {
      expect(screen.getByText(/admin@192\.168\.1\.1/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("Edit path"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("smb://admin@192.168.1.1:445/G/sub/file.png");
    expect(input.value).not.toContain("df204a67");
  });

  it("commit of the friendly form on an active connection navigates to the canonical UUID URL without prompting", async () => {
    const onNavigate = vi.fn();
    renderBar(
      "smb://df204a67-a012-4d96-aadd-8e48a1da5f40/sub",
      onNavigate,
    );
    // Wait for connList.
    await waitFor(() => {
      expect(screen.getByText(/admin@192\.168\.1\.1/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("Edit path"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "smb://admin@192.168.1.1:445/G/other-folder" },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith(
        "smb://df204a67-a012-4d96-aadd-8e48a1da5f40/other-folder",
      );
    });
  });

  it("commit of a friendly URL that does NOT match any active connection still flows through the connect dialog", async () => {
    const onNavigate = vi.fn();
    renderBar("/Users/syle", onNavigate);
    fireEvent.click(screen.getByLabelText("Edit path"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    // Different host — not in the active map → connect-dialog event.
    const listener = vi.fn();
    window.addEventListener("skiff:connect-to-remote", listener);
    fireEvent.change(input, {
      target: { value: "smb://admin@10.0.0.5:445/share" },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(listener).toHaveBeenCalled();
    });
    window.removeEventListener("skiff:connect-to-remote", listener);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("local paths still pass through unchanged", async () => {
    renderBar("/Users/syle/Desktop");
    fireEvent.click(screen.getByLabelText("Edit path"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("/Users/syle/Desktop");
  });
});
