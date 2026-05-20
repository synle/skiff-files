// Tests for the custom seekbar / play-pause / volume controls on
// the audio + video preview bodies. We can't drive the underlying
// HTMLMediaElement's real codecs in jsdom — instead, we mock
// `readBase64` to return a benign empty payload and assert that the
// toolbar surfaces all the controls in the right initial state.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  it("clicking Play invokes the media element's play()", async () => {
    // jsdom's HTMLMediaElement.play() is a no-op stub that resolves
    // to undefined and never sets `paused = false`. We monkey-patch
    // it to flip a flag so we can observe the call without faking
    // the entire element.
    const playSpy = vi.fn(async () => {});
    const origPlay = HTMLMediaElement.prototype.play;
    const origPause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = playSpy;
    HTMLMediaElement.prototype.pause = vi.fn();
    r(mkEntry("audio"));
    const playBtn = await screen.findByLabelText("Play");
    fireEvent.click(playBtn);
    expect(playSpy).toHaveBeenCalledTimes(1);
    HTMLMediaElement.prototype.play = origPlay;
    HTMLMediaElement.prototype.pause = origPause;
  });
  it("Mute toggles the icon's aria-label", async () => {
    r(mkEntry("audio"));
    const muteBtn = await screen.findByLabelText("Mute");
    fireEvent.click(muteBtn);
    // After clicking, the label flips to Unmute.
    await waitFor(() => {
      expect(screen.getByLabelText("Unmute")).toBeInTheDocument();
    });
    // Clicking again flips back.
    fireEvent.click(screen.getByLabelText("Unmute"));
    await waitFor(() => {
      expect(screen.getByLabelText("Mute")).toBeInTheDocument();
    });
  });
  it("formats the time readout as m:ss / m:ss", async () => {
    r(mkEntry("audio"));
    // Initial state — both sides are 0:00 / 0:00.
    await waitFor(() => {
      expect(screen.getByText(/0:00 \/ 0:00/)).toBeInTheDocument();
    });
  });
});

beforeEach(() => {
  // jsdom doesn't implement scrollIntoView; some MUI Slider
  // interactions touch it. Stubbing on the prototype keeps the
  // tests below free of per-test boilerplate.
  if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }
});
