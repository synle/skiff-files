// Tests for the custom seekbar / play-pause / volume controls on
// the audio + video preview bodies. We can't drive the underlying
// HTMLMediaElement's real codecs in jsdom — instead, we mock
// `readBase64` to return a benign empty payload and assert that the
// toolbar surfaces all the controls in the right initial state.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@mui/material";
import MediaBody from "./MediaBody";
import { themeFor } from "../../theme";
import type { Entry } from "../../api/fs";

vi.mock("../../api/client", () => ({
  readBase64: vi.fn(async () => "AAAA"), // 3 bytes of base64.
  readText: vi.fn(async () => ""),
}));

const mkEntry = (kind: "audio" | "video"): Entry => ({
  name: kind === "audio" ? "song.mp3" : "clip.mp4",
  path: kind === "audio" ? "/x/song.mp3" : "/x/clip.mp4",
  kind,
  size: 1024,
  mtime: null,
  isDir: false,
  isSymlink: false,
  isHidden: false,
  mode: null,
});

const r = (entry: Entry) =>
  render(
    <ThemeProvider theme={themeFor("light")}>
      <MediaBody entry={entry} />
    </ThemeProvider>,
  );

describe("MediaBody", () => {
  it("renders Play, Mute, Seek, and Volume controls for audio", async () => {
    r(mkEntry("audio"));
    await waitFor(() => {
      expect(screen.getByLabelText("Play")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Mute")).toBeInTheDocument();
    expect(screen.getByLabelText("Seek")).toBeInTheDocument();
    expect(screen.getByLabelText("Volume")).toBeInTheDocument();
  });
  it("renders the same controls for video", async () => {
    r(mkEntry("video"));
    await waitFor(() => {
      expect(screen.getByLabelText("Play")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Mute")).toBeInTheDocument();
    expect(screen.getByLabelText("Seek")).toBeInTheDocument();
    expect(screen.getByLabelText("Volume")).toBeInTheDocument();
  });
  it("surfaces the loading state before the base64 payload arrives", () => {
    r(mkEntry("video"));
    // Initial render — readBase64 hasn't resolved yet.
    expect(screen.getByText(/Loading preview…/i)).toBeInTheDocument();
  });
});
