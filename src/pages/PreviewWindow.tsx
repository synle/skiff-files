// Standalone preview window — rendered as the entire root when the
// app bootstraps with `#preview=<urlEncoded-path>` in the URL.
// Spawned by the `window_open_preview` Rust command from the
// in-app PreviewModal's "Open in window" button (and from the
// keyboard chord when the modal is already open).
//
// The point of this page existing is to give the user a dedicated
// OS-level window for one file's preview — useful for staging
// multiple previews side-by-side, or for keeping a preview visible
// while the main window is doing something else.
//
// We render only the `<Body>` component from PreviewPane (which
// already handles every kind) plus a thin filename header. No
// sidebar, no tabs, no path bar — that's the explicit value of this
// separate window vs. just resizing the main app.
import { Box, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { Body } from "../components/PreviewPane";
import IconForKind from "../components/IconForKind";
import { fsImageExif, type Entry, type ImageExif } from "../api/fs";
import { stat } from "../api/client";

/** Parse `#preview=<urlEncoded>` from the current URL hash. Returns
 *  the decoded path or null when the hash isn't a preview hash. */
function readPreviewPathFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  const m = /[#&]preview=([^&]+)/.exec(hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

export default function PreviewWindow() {
  const initialPath = readPreviewPathFromHash();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageExif, setImageExif] = useState<ImageExif | null>(null);

  useEffect(() => {
    if (!initialPath) {
      setError("No preview path supplied (#preview=<path> missing).");
      return;
    }
    let cancelled = false;
    stat(initialPath)
      .then((e) => {
        if (cancelled) return;
        setEntry(e);
        // Set the window title to the basename so taskbar / dock
        // entries are useful. Rust seeds an initial title, but it
        // doesn't know the file's display name until stat lands.
        try {
          document.title = `${e.name} — Skiff Files`;
        } catch {
          /* noop */
        }
      })
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [initialPath]);

  // Best-effort EXIF lookup — same gate the inline PreviewPane uses
  // so the orientation transform applies in the standalone window
  // too. Remote paths bail (the EXIF command is local-only).
  useEffect(() => {
    setImageExif(null);
    if (!entry || entry.isDir) return;
    if (entry.path.startsWith("sftp://")) return;
    if (!/\.(jpe?g|tiff?|heic|heif|webp|png)$/i.test(entry.path)) return;
    let cancelled = false;
    void fsImageExif(entry.path)
      .then((e) => {
        if (cancelled) return;
        const hasAny = Object.values(e).some((v) => v != null);
        setImageExif(hasAny ? e : null);
      })
      .catch(() => {
        /* best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }
  if (!entry) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading…</Typography>
      </Box>
    );
  }
  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          px: 2,
          py: 1,
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <IconForKind kind={entry.kind} fontSize="medium" />
        <Typography
          variant="subtitle1"
          sx={{ flex: 1, wordBreak: "break-all", fontWeight: 500 }}
          title={entry.path}
        >
          {entry.name}
        </Typography>
        <Tooltip title="Close (Cmd/Ctrl+W)">
          <IconButton
            size="small"
            onClick={() => window.close()}
            aria-label="Close preview window"
          >
            {/* Inline close X — avoids pulling another icon import in
             *  this single-purpose page. The standard CloseIcon glyph
             *  would render the same SVG path. */}
            ✕
          </IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        <Body
          entry={entry}
          onImageDimensions={() => {
            /* standalone window doesn't render a properties block */
          }}
          mode="modal"
          exifOrientation={imageExif?.orientation ?? null}
        />
      </Box>
    </Box>
  );
}
