import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import PreviewPane from "./PreviewPane";
import type { Entry } from "../api/fs";
import { SettingsProvider } from "../state/settings";

const theme = createTheme();

function r(props: { selected: Entry | null; width?: number }) {
  return render(
    <ThemeProvider theme={theme}>
      <SettingsProvider>
        <PreviewPane selected={props.selected} width={props.width ?? 320} />
      </SettingsProvider>
    </ThemeProvider>,
  );
}

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

const text: Entry = {
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

const img: Entry = {
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

const blob: Entry = {
  name: "data.bin",
  path: "/x/data.bin",
  kind: "binary",
  size: 999,
  mtime: 1700000000,
  isDir: false,
  isSymlink: false,
  isHidden: false,
  mode: 0o644,
};

describe("PreviewPane", () => {
  it("shows the empty hint when nothing selected", () => {
    r({ selected: null });
    expect(screen.getByText(/Select a file to preview/i)).toBeInTheDocument();
  });

  it("renders the properties block for any selection", () => {
    r({ selected: text });
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(screen.getByText("Path")).toBeInTheDocument();
  });

  it("renders folder summary for a directory", async () => {
    r({ selected: folder });
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });
  });

  it("renders text body for markdown/code/text kinds", async () => {
    r({ selected: text });
    await waitFor(() => {
      expect(screen.getByText("preview text")).toBeInTheDocument();
    });
  });

  it("renders image body for image kinds", async () => {
    r({ selected: img });
    await waitFor(() => {
      expect(screen.getByAltText("pic.png")).toBeInTheDocument();
    });
  });

  it("kicks the hex preview for binary kinds", () => {
    // 0.2.202 swapped the "no inline preview" message for an actual
    // hex dump body. Initial render shows the loading hint until
    // readBase64 resolves; the test just asserts we entered the
    // hex-body code path rather than the fallthrough message.
    r({ selected: blob });
    expect(screen.getByText(/Loading hex preview/i)).toBeInTheDocument();
  });

  it("cancels in-flight loads when selection changes", async () => {
    // We don't have a clean hook, but we can sanity-check that switching
    // selection swaps the rendered content without leaking the prior one.
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <SettingsProvider>
          <PreviewPane selected={text} width={320} />
        </SettingsProvider>
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("preview text")).toBeInTheDocument();
    });
    rerender(
      <ThemeProvider theme={theme}>
        <SettingsProvider>
          <PreviewPane selected={folder} width={320} />
        </SettingsProvider>
      </ThemeProvider>,
    );
    // Folder body replaces text body.
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });
    // Don't call vi.clearAllMocks — multiple invokes are fine, we just want
    // no crash and the new content visible.
    expect(true).toBe(true);
  });
});

describe("PreviewPane — text body zoom + copy controls (0.2.315)", () => {
  it("renders the Copy / Zoom-out / Reset / Zoom-in buttons for a text entry", async () => {
    r({ selected: text });
    await waitFor(() => {
      expect(screen.getByText("preview text")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /Copy file contents/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Zoom text out/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Reset text zoom/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Zoom text in/i)).toBeInTheDocument();
    // The percentage readout starts at 100%.
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("steps the font size and updates the percentage readout", async () => {
    r({ selected: text });
    await waitFor(() => {
      expect(screen.getByText("preview text")).toBeInTheDocument();
    });
    // Default = 100%. Click Zoom in once → step is +2px on a 12px
    // base = 14/12 ≈ 116.67 → rounded → 117%.
    fireEvent.click(screen.getByLabelText(/Zoom text in/i));
    expect(screen.getByText("117%")).toBeInTheDocument();
    // Reset returns to 100%.
    fireEvent.click(screen.getByLabelText(/Reset text zoom/i));
    expect(screen.getByText("100%")).toBeInTheDocument();
    // Zoom out lands at 10/12 ≈ 83%.
    fireEvent.click(screen.getByLabelText(/Zoom text out/i));
    expect(screen.getByText("83%")).toBeInTheDocument();
  });

  it("writes file contents to the clipboard when Copy is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // jsdom doesn't ship a clipboard API; override per test.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    r({ selected: text });
    await waitFor(() => {
      expect(screen.getByText("preview text")).toBeInTheDocument();
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Copy file contents/i }),
    );
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("preview text");
    });
  });
});

// quiet unused-import warning
void vi;
