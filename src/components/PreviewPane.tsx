// Right-side preview pane. Renders different content per FileKind:
//   - Folder → recursive entry count + total size (cancellable scan)
//   - Image  → inline data URL preview
//   - Text/code/markdown → first 256 KB of the file
//   - Anything else → properties block only
//
// Selection-driven: the parent passes the currently selected Entry. We
// cancel any in-flight load if selection changes mid-fetch — important
// because `fs_dir_summary` can take seconds on large trees.
import { Box, Divider, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { type DirSummary, type Entry } from "../api/fs";
import { dirSummary, readBase64, readText } from "../api/client";
import { formatBytes, formatMtime } from "../util/format";
import { isImage, mimeForPath } from "../util/mime";
import {
  PREVIEW_WIDTH_MAX,
  PREVIEW_WIDTH_MIN,
  useSettings,
} from "../state/settings";
import IconForKind from "./IconForKind";

interface Props {
  /** Currently focused / selected entry. `null` = nothing selected. */
  selected: Entry | null;
  /** Pane width in pixels. The parent owns resize; we just consume the value. */
  width: number;
}

/** Stretchy "label: value" row, used for the properties block. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", gap: 1 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ width: 80, flexShrink: 0 }}
      >
        {label}
      </Typography>
      <Typography variant="caption" sx={{ wordBreak: "break-all" }}>
        {value}
      </Typography>
    </Box>
  );
}

/** Image-specific preview body. Loads on selection change; tracks cancel. */
function ImageBody({ entry }: { entry: Entry }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(null);
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
  return (
    <Box
      component="img"
      src={src}
      alt={entry.name}
      sx={{
        maxWidth: "100%",
        maxHeight: 360,
        borderRadius: 1,
        display: "block",
      }}
    />
  );
}

/** Text-file preview body. Capped at the server-side limit. */
function TextBody({ entry }: { entry: Entry }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    readText(entry.path)
      .then((t) => !cancelled && setText(t))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [entry.path]);

  if (error) {
    return (
      <Typography variant="caption" color="error">
        {error}
      </Typography>
    );
  }
  if (text == null) {
    return (
      <Typography variant="caption" color="text.secondary">
        Loading…
      </Typography>
    );
  }
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 1,
        maxHeight: 360,
        overflow: "auto",
        bgcolor: "action.hover",
        borderRadius: 1,
        fontSize: "0.75rem",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {text}
    </Box>
  );
}

/** Folder summary body — recursive count + total size. */
function FolderBody({ entry }: { entry: Entry }) {
  const [summary, setSummary] = useState<DirSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setError(null);
    dirSummary(entry.path)
      .then((s) => !cancelled && setSummary(s))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [entry.path]);

  if (error) {
    return (
      <Typography variant="caption" color="error">
        {error}
      </Typography>
    );
  }
  if (!summary) {
    return (
      <Typography variant="caption" color="text.secondary">
        Scanning…
      </Typography>
    );
  }
  const prefix = summary.truncated ? "≥" : "";
  return (
    <Stack spacing={0.5}>
      <Field
        label="Items"
        value={`${prefix}${summary.entries.toLocaleString()}`}
      />
      <Field
        label="Total size"
        value={`${prefix}${formatBytes(summary.totalSize)}`}
      />
      {summary.truncated && (
        <Typography variant="caption" color="text.secondary">
          Truncated at scan cap.
        </Typography>
      )}
    </Stack>
  );
}

/** Decide which body component to render based on the selected entry's kind. */
function Body({ entry }: { entry: Entry }) {
  if (entry.isDir) return <FolderBody entry={entry} />;
  if (isImage(entry.path)) return <ImageBody entry={entry} />;
  // text-ish kinds get the text body. Everything else falls through to
  // properties-only.
  if (
    entry.kind === "text" ||
    entry.kind === "markdown" ||
    entry.kind === "code"
  ) {
    return <TextBody entry={entry} />;
  }
  return (
    <Typography variant="caption" color="text.secondary">
      No inline preview for this kind.
    </Typography>
  );
}

export default function PreviewPane({ selected, width }: Props) {
  const { update } = useSettings();

  // Drag-resize from the LEFT edge — the pane lives on the right of
  // the FileList, so dragging left widens it. Same MouseMove-on-document
  // pattern the Sidebar uses (0.2.28) so a fast drag past the handle's
  // own bounds doesn't drop the pointer.
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      // dx grows as the mouse moves right; we want the pane to widen
      // when the mouse moves *left* (since the handle is on the left
      // edge), so subtract.
      const dx = ev.clientX - startX;
      const next = Math.max(
        PREVIEW_WIDTH_MIN,
        Math.min(PREVIEW_WIDTH_MAX, startW - dx),
      );
      update("previewWidth", next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <Box
      role="complementary"
      aria-label="Preview pane"
      sx={{
        position: "relative",
        width,
        flexShrink: 0,
        borderLeft: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        overflow: "auto",
      }}
    >
      {/* Drag handle — thin column on the left edge. Same primary-tint
          on hover affordance as the Sidebar resizer so the two flow
          consistently. */}
      <Box
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize preview pane"
        onMouseDown={startDrag}
        sx={{
          position: "absolute",
          top: 0,
          left: -3,
          bottom: 0,
          width: 6,
          cursor: "col-resize",
          transition: "background-color 120ms",
          "&:hover": { backgroundColor: "primary.light" },
          zIndex: 1,
        }}
      />
      {!selected ? (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Select a file to preview it here.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1.5} sx={{ p: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconForKind kind={selected.kind} fontSize="medium" />
            <Typography
              variant="subtitle2"
              sx={{ wordBreak: "break-all" }}
              title={selected.path}
            >
              {selected.name}
            </Typography>
          </Box>

          <Body entry={selected} />

          <Divider />

          <Stack spacing={0.5}>
            <Field label="Kind" value={selected.kind} />
            <Field
              label="Size"
              value={selected.isDir ? "—" : formatBytes(selected.size)}
            />
            <Field label="Modified" value={formatMtime(selected.mtime)} />
            {selected.mode != null && (
              <Field
                label="Mode"
                value={`0${selected.mode.toString(8).slice(-3)}`}
              />
            )}
            <Field label="Path" value={selected.path} />
          </Stack>
        </Stack>
      )}
    </Box>
  );
}
