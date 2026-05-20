// Audio / video preview body with a custom seekbar + play/pause +
// time readout.
//
// We render the file via a hidden `<video>` / `<audio>` element
// pointed at a base64 data URL (same approach the legacy AVBody used)
// and surface our own controls so the seekbar looks consistent
// across platforms — every webview ships slightly different native
// controls, and the seek bar in particular tends to be tiny on
// macOS WKWebView vs. WebView2.
//
// Mode prop sizes the media element: "inline" caps the video at
// 240 px tall so the right-hand pane keeps the properties block
// visible; "modal" lets it bloom to ~60vh.
//
// Backend support: the webview's native codec table determines what
// plays. Tauri's WKWebView on macOS handles H.264 / AAC / MP3 /
// WAV / OGG; WebView2 on Windows handles H.264 / AAC / MP3 / WAV;
// WebKitGTK on Linux is the weakest (H.264 only when the system
// codec is installed). We don't transcode — surface a "no decoder"
// fallback when the element errors.
import {
  Box,
  IconButton,
  Slider,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import { useEffect, useRef, useState } from "react";
import { readBase64 } from "../../api/client";
import type { Entry } from "../../api/fs";
import { mimeForPath } from "../../util/mime";

interface Props {
  entry: Entry;
  mode?: "inline" | "modal";
}

/** Format seconds → `m:ss` or `h:mm:ss`. Used by the time readout
 *  next to the seek bar. Non-finite values (NaN / Infinity) become
 *  `--:--` so loading state doesn't flash bogus times. */
function formatTime(t: number): string {
  if (!isFinite(t) || t < 0) return "--:--";
  const total = Math.floor(t);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export default function MediaBody({ entry, mode = "inline" }: Props) {
  const isVideo = entry.kind === "video";
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [muted, setMuted] = useState<boolean>(false);
  /** When the user grabs the seek thumb, we suspend the
   *  currentTime → state update so the slider can preview a position
   *  without snapping back on every metadata tick. Cleared on
   *  mouseup. */
  const [scrubbing, setScrubbing] = useState<boolean>(false);
  const [scrubTime, setScrubTime] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    readBase64(entry.path)
      .then((b64) => {
        if (cancelled) return;
        const mime = mimeForPath(entry.path) ?? "application/octet-stream";
        setSrc(`data:${mime};base64,${b64}`);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [entry.path]);

  // Hook the media element's events once it mounts. We re-run when
  // the src changes because the element is recreated by React (the
  // key changes via the URL change).
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    const onTime = () => {
      if (!scrubbing) setCurrentTime(el.currentTime);
    };
    const onMeta = () => {
      // Some containers (HEVC in WebView2) report a finite duration
      // only on `durationchange` rather than `loadedmetadata`; we
      // hook both via the same handler so whichever fires first
      // populates the slider's max.
      if (isFinite(el.duration)) setDuration(el.duration);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => {
      setError(
        "Codec not supported by the system webview. Try opening in the OS default app.",
      );
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("error", onError);
    };
  }, [src, scrubbing]);

  // Apply controlled volume + muted to the underlying element.
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
  }, [volume, muted, src]);

  if (error) {
    return (
      <Typography variant="caption" color="error">
        {error}
      </Typography>
    );
  }
  if (!src) {
    return (
      <Typography variant="caption" color="text.secondary">
        Loading preview…
      </Typography>
    );
  }

  const togglePlay = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => {
        /* play() can reject under autoplay rules; user just retries */
      });
    } else {
      el.pause();
    }
  };

  const onSeekChange = (_: Event, value: number | number[]) => {
    if (Array.isArray(value)) return;
    setScrubbing(true);
    setScrubTime(value);
  };
  const onSeekCommit = (_: Event | React.SyntheticEvent, value: number | number[]) => {
    if (Array.isArray(value)) return;
    const el = mediaRef.current;
    if (el && isFinite(value)) el.currentTime = value;
    setCurrentTime(value);
    setScrubbing(false);
  };

  const displayTime = scrubbing ? scrubTime : currentTime;
  // Inline + modal heights — same as the legacy AVBody for video;
  // audio renders without a viewport box so heights are irrelevant.
  const videoMaxHeight = mode === "modal" ? "60vh" : 240;

  return (
    <Box>
      {isVideo ? (
        <Box
          component="video"
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          src={src}
          // Native controls hidden — we render our own seekbar +
          // play/pause + volume below. Keeping `playsInline` so iOS
          // builds (if we ever ship one) don't autoplay full-screen.
          // `preload="metadata"` lets us populate duration quickly.
          preload="metadata"
          playsInline
          sx={{
            maxWidth: "100%",
            maxHeight: videoMaxHeight,
            width: "100%",
            borderRadius: 1,
            display: "block",
            bgcolor: "common.black",
          }}
        />
      ) : (
        // Audio: render a thin "now-playing" strip with the filename
        // and time, since there's no visual content. The media element
        // itself is invisible — the seekbar / play button below drive
        // it.
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 96,
            bgcolor: "action.hover",
            borderRadius: 1,
            px: 2,
          }}
        >
          <Box
            component="audio"
            ref={mediaRef as React.RefObject<HTMLAudioElement>}
            src={src}
            preload="metadata"
            sx={{ display: "none" }}
          />
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            }}
          >
            {playing ? "▶" : "❚❚"} {entry.name}
          </Typography>
        </Box>
      )}
      <Stack
        direction="row"
        spacing={1}
        sx={{ mt: 1, alignItems: "center" }}
      >
        <Tooltip title={playing ? "Pause (Space)" : "Play (Space)"}>
          <IconButton
            size="small"
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <PauseIcon fontSize="small" />
            ) : (
              <PlayArrowIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        <Typography
          variant="caption"
          sx={{
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            color: "text.secondary",
            minWidth: 88,
            textAlign: "right",
          }}
          aria-live="polite"
        >
          {formatTime(displayTime)} / {formatTime(duration)}
        </Typography>
        <Slider
          size="small"
          // Slider can't accept Infinity / NaN as `max`. Default to 1
          // while metadata is still loading so the thumb stays at the
          // origin instead of jumping wildly.
          max={duration > 0 && isFinite(duration) ? duration : 1}
          step={0.05}
          value={displayTime}
          onChange={onSeekChange}
          onChangeCommitted={onSeekCommit}
          aria-label="Seek"
          // Snap-on-key — arrow keys nudge ±5s / Shift+arrow ±15s.
          onKeyDown={(e) => {
            const el = mediaRef.current;
            if (!el) return;
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              el.currentTime = Math.max(
                0,
                el.currentTime - (e.shiftKey ? 15 : 5),
              );
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              el.currentTime = Math.min(
                duration || el.currentTime + 5,
                el.currentTime + (e.shiftKey ? 15 : 5),
              );
            }
          }}
          sx={{ flex: 1, minWidth: 80 }}
        />
        <Tooltip title={muted ? "Unmute" : "Mute"}>
          <IconButton
            size="small"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? (
              <VolumeOffIcon fontSize="small" />
            ) : (
              <VolumeUpIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        <Slider
          size="small"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(_, v) => {
            if (Array.isArray(v)) return;
            setVolume(v);
            if (v > 0 && muted) setMuted(false);
          }}
          aria-label="Volume"
          sx={{ width: 80 }}
        />
      </Stack>
    </Box>
  );
}
