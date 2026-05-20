// Bootstrap tests for the standalone PreviewWindow page.
//
// The page reads `#preview=<urlEncoded>` from `window.location.hash`
// at module load, stats the path, then renders the same `<Body>`
// component the inline pane + modal use. We mock the `api/client`
// surface so the stat + readBase64 / readText calls don't blow up
// in jsdom.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@mui/material";
import PreviewWindow from "./PreviewWindow";
import { themeFor } from "../theme";
import { SettingsProvider } from "../state/settings";

// Mock the entire api/client surface so the page can render without
// a Tauri bridge. The `stat` helper drives the page; `readBase64` /
// `readText` are pulled in by the downstream `Body` components.
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>(
    "../api/client",
  );
  return {
    ...actual,
    stat: vi.fn(async (path: string) => ({
      name: path.split("/").pop() ?? "x",
      path,
      kind: "text" as const,
      size: 0,
      mtime: null,
      isDir: false,
      isSymlink: false,
      isHidden: false,
      mode: null,
    })),
    readText: vi.fn(async () => "hello"),
    readBase64: vi.fn(async () => ""),
    dirSummary: vi.fn(async () => ({ entries: 0, totalSize: 0, truncated: false })),
  };
});

function r() {
  return render(
    <ThemeProvider theme={themeFor("light")}>
      <SettingsProvider>
        <PreviewWindow />
      </SettingsProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  // Reset the location hash between tests so one test's `#preview=…`
  // doesn't bleed into the next.
  window.location.hash = "";
});

describe("PreviewWindow", () => {
  it("surfaces an error when no #preview= hash is supplied", () => {
    r();
    expect(
      screen.getByText(/No preview path supplied/i),
    ).toBeInTheDocument();
  });
  it("stats the path from the hash and renders the filename", async () => {
    window.location.hash = "#preview=" + encodeURIComponent("/x/notes.md");
    r();
    // The header surfaces the basename; the Body itself shows the
    // text content from the readText mock.
    await waitFor(() => {
      expect(screen.getByText("notes.md")).toBeInTheDocument();
    });
  });
  it("renders a Close button that wires to window.close()", async () => {
    window.location.hash = "#preview=" + encodeURIComponent("/x/notes.md");
    const closeSpy = vi.fn();
    Object.defineProperty(window, "close", {
      configurable: true,
      value: closeSpy,
    });
    r();
    const btn = await screen.findByLabelText(/Close preview window/i);
    btn.click();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
  it("sets the document title to <basename> — Skiff Files", async () => {
    window.location.hash = "#preview=" + encodeURIComponent("/x/notes.md");
    r();
    await waitFor(() => {
      expect(document.title).toMatch(/notes\.md — Skiff Files/);
    });
  });
  it("handles a malformed URL-encoded hash gracefully", () => {
    // `%` without two hex chars after — decodeURIComponent throws.
    // The page should treat that the same as "no path" and surface
    // the error message.
    window.location.hash = "#preview=%E0%A4%A";
    r();
    expect(
      screen.getByText(/No preview path supplied/i),
    ).toBeInTheDocument();
  });
});
