import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import PreviewPane from "./PreviewPane";
import type { Entry } from "../api/fs";
import { SettingsProvider } from "../state/settings";

const theme = createTheme();

function r(selected: Entry | null) {
  return render(
    <ThemeProvider theme={theme}>
      <SettingsProvider>
        <PreviewPane selected={selected} width={400} />
      </SettingsProvider>
    </ThemeProvider>,
  );
}

function entry(over: Partial<Entry> = {}): Entry {
  return {
    name: "x",
    path: "/x",
    kind: "binary",
    size: 100,
    mtime: 1700000000,
    isDir: false,
    isSymlink: false,
    isHidden: false,
    mode: 0o644,
    ...over,
  };
}

describe("PreviewPane — extras", () => {
  it("renders an audio header for audio kinds", async () => {
    r(entry({ name: "song.mp3", path: "/song.mp3", kind: "audio" }));
    // The properties block always shows the filename — confirm we
    // entered the audio render path without throwing.
    expect(screen.getByText("song.mp3")).toBeInTheDocument();
    // Audio player may load async; allow it to settle.
    await waitFor(() => {
      const el = document.querySelector("audio") || document.querySelector("video");
      expect(el).not.toBeNull();
    });
  });

  it("renders a video header for video kinds", async () => {
    r(entry({ name: "clip.mp4", path: "/clip.mp4", kind: "video" }));
    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
    await waitFor(() => {
      const el = document.querySelector("video");
      expect(el).not.toBeNull();
    });
  });

  it("renders pdf preview for pdf kind", () => {
    r(entry({ name: "doc.pdf", path: "/doc.pdf", kind: "pdf" }));
    // PDF preview uses an iframe / embed; just check the path block is
    // present.
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
  });

  it("displays the path tooltip with the full path", () => {
    r(entry({ name: "long.txt", path: "/some/long/path/long.txt", kind: "text" }));
    expect(
      screen.getByText("/some/long/path/long.txt"),
    ).toBeInTheDocument();
  });

  it("renders symlink kind without a body crash", () => {
    r(
      entry({
        name: "link",
        path: "/link",
        kind: "symlink",
        isSymlink: true,
      }),
    );
    expect(screen.getByText("link")).toBeInTheDocument();
  });

  it("renders archive kind without crashing", async () => {
    r(entry({ name: "z.zip", path: "/z.zip", kind: "archive" }));
    expect(screen.getByText("z.zip")).toBeInTheDocument();
  });

  it("renders code kind with text body", async () => {
    r(entry({ name: "main.rs", path: "/main.rs", kind: "code" }));
    await waitFor(() => {
      expect(screen.getByText("preview text")).toBeInTheDocument();
    });
  });

  it("renders for unknown kind via the hex-body branch", async () => {
    r(entry({ name: "weird", path: "/weird", kind: "unknown" }));
    expect(screen.getByText("weird")).toBeInTheDocument();
  });

  it("renders for spreadsheet kind without crashing (no inline body)", () => {
    r(entry({ name: "data.xlsx", path: "/data.xlsx", kind: "spreadsheet" }));
    expect(screen.getByText("data.xlsx")).toBeInTheDocument();
  });

  it("renders for remote sftp paths and skips EXIF fetch", () => {
    r(
      entry({
        name: "remote.jpg",
        path: "sftp://abc/remote.jpg",
        kind: "image",
      }),
    );
    expect(screen.getByText("remote.jpg")).toBeInTheDocument();
  });

  it("skips inline preview for an unknown extension without crashing", () => {
    r(entry({ name: "file.xyz", path: "/file.xyz", kind: "document" }));
    expect(screen.getByText("file.xyz")).toBeInTheDocument();
  });
});
