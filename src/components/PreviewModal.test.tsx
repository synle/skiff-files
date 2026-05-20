// Smoke tests for the in-app PreviewModal.
//
// The Body component (imported from PreviewPane) handles its own
// fetch through the Tauri IPC — we mock the api/client module so
// the test environment doesn't blow up on the missing bridge.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import PreviewModal from "./PreviewModal";
import { isPreviewableEntry } from "./PreviewPane";
import type { Entry } from "../api/fs";
import { SettingsProvider } from "../state/settings";

// Body components ping the api/client read* helpers — stub them out
// so the modal renders without a Tauri bridge.
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>(
    "../api/client",
  );
  return {
    ...actual,
    readBase64: vi.fn().mockResolvedValue(""),
    readText: vi.fn().mockResolvedValue(""),
    dirSummary: vi.fn().mockResolvedValue({
      entries: 0,
      totalSize: 0,
      truncated: false,
    }),
  };
});

const theme = createTheme();

function r(props: { entry: Entry | null; onClose?: () => void }) {
  return render(
    <ThemeProvider theme={theme}>
      <SettingsProvider>
        <PreviewModal entry={props.entry} onClose={props.onClose ?? (() => {})} />
      </SettingsProvider>
    </ThemeProvider>,
  );
}

const png: Entry = {
  name: "pic.png",
  path: "/x/pic.png",
  kind: "image",
  size: 4096,
  mtime: 1700000000,
  isDir: false,
  isSymlink: false,
  isHidden: false,
  mode: 0o644,
};
const txt: Entry = {
  name: "notes.md",
  path: "/x/notes.md",
  kind: "markdown",
  size: 100,
  mtime: 1700000000,
  isDir: false,
  isSymlink: false,
  isHidden: false,
  mode: 0o644,
};
const folder: Entry = {
  name: "stuff",
  path: "/x/stuff",
  kind: "folder",
  size: 0,
  mtime: 1700000000,
  isDir: true,
  isSymlink: false,
  isHidden: false,
  mode: 0o755,
};

describe("PreviewModal", () => {
  it("renders nothing when entry is null", () => {
    r({ entry: null });
    expect(screen.queryByText(/Close preview/i)).toBeNull();
  });

  it("renders the file name and a close button when entry is set", () => {
    r({ entry: png });
    // The DialogTitle contains the file name.
    expect(screen.getByText("pic.png")).toBeInTheDocument();
    expect(screen.getByLabelText(/Close preview/i)).toBeInTheDocument();
  });

  it("invokes onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    r({ entry: png, onClose });
    fireEvent.click(screen.getByLabelText(/Close preview/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a text-ish entry's title (markdown surface)", () => {
    r({ entry: txt });
    expect(screen.getByText("notes.md")).toBeInTheDocument();
  });
});

describe("isPreviewableEntry", () => {
  it("returns true for images", () => {
    expect(isPreviewableEntry(png)).toBe(true);
  });
  it("returns true for text-ish kinds (markdown / code / text)", () => {
    expect(isPreviewableEntry(txt)).toBe(true);
    expect(
      isPreviewableEntry({ ...txt, kind: "code", name: "x.ts" }),
    ).toBe(true);
    expect(
      isPreviewableEntry({ ...txt, kind: "text", name: "x.log" }),
    ).toBe(true);
  });
  it("returns true for audio / video / pdf", () => {
    expect(isPreviewableEntry({ ...txt, kind: "audio" })).toBe(true);
    expect(isPreviewableEntry({ ...txt, kind: "video" })).toBe(true);
    expect(isPreviewableEntry({ ...txt, kind: "pdf" })).toBe(true);
  });
  it("returns true for binary / unknown (hex dump fallback)", () => {
    expect(isPreviewableEntry({ ...txt, kind: "binary" })).toBe(true);
    expect(isPreviewableEntry({ ...txt, kind: "unknown" })).toBe(true);
  });
  it("returns false for directories", () => {
    expect(isPreviewableEntry(folder)).toBe(false);
  });
});
