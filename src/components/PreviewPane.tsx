// Right-side preview pane. Renders different content per FileKind:
//   - Folder → recursive entry count + total size (cancellable scan)
//   - Image  → inline data URL preview
//   - Text/code/markdown → first 256 KB of the file
//   - Anything else → properties block only
//
// Selection-driven: the parent passes the currently selected Entry. We
// cancel any in-flight load if selection changes mid-fetch — important
// because `fs_dir_summary` can take seconds on large trees.
import {
  Box,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import LaunchIcon from "@mui/icons-material/Launch";
import RotateLeftIcon from "@mui/icons-material/RotateLeft";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import { useEffect, useState } from "react";
import {
  fsImageExif,
  fsOpenWithDefault,
  type DirSummary,
  type Entry,
  type ImageExif,
} from "../api/fs";
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

/** Image-specific preview body. Loads on selection change; tracks cancel.
 *  Reports the natural pixel dimensions to the parent via `onDimensions`
 *  so the properties block can render them. */
function ImageBody({
  entry,
  onDimensions,
}: {
  entry: Entry;
  onDimensions: (d: { w: number; h: number } | null) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Rotation in degrees, applied via CSS transform. Resets to 0
   *  whenever the selection changes so the next image starts upright. */
  const [rotation, setRotation] = useState<number>(0);
  /** Click-to-zoom toggle. Off = fit-to-pane (max 360 px tall);
   *  on = native pixel size, scroll inside the pane to inspect.
   *  Resets on selection change so each new image starts fitted. */
  const [zoomed, setZoomed] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(null);
    setRotation(0);
    setZoomed(false);
    onDimensions(null);
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
    // onDimensions is stable from the parent's useState setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <Box>
      <Box
        // When zoomed, wrap in a scrollable container so the user
        // can pan inside the pane bounds without overflowing the
        // properties block below.
        sx={
          zoomed
            ? { maxHeight: 480, overflow: "auto", borderRadius: 1 }
            : undefined
        }
      >
        <Box
          component="img"
          src={src}
          alt={entry.name}
          onLoad={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              onDimensions({ w: img.naturalWidth, h: img.naturalHeight });
            }
          }}
          onClick={() => setZoomed((z) => !z)}
          title={zoomed ? "Click to fit" : "Click to zoom 100%"}
          sx={{
            maxWidth: zoomed ? "none" : "100%",
            maxHeight: zoomed ? "none" : 360,
            borderRadius: 1,
            display: "block",
            cursor: zoomed ? "zoom-out" : "zoom-in",
            transform: `rotate(${rotation}deg)`,
            // Keep the rotated image inside the pane bounds — without
            // `transform-origin: center` rotation pivots from top-left
            // and the image walks off screen on quarter turns.
            transformOrigin: "center",
            transition: "transform 200ms",
          }}
        />
      </Box>
      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
        <Tooltip title="Rotate left">
          <IconButton
            size="small"
            onClick={() => setRotation((r) => r - 90)}
            aria-label="Rotate image left"
          >
            <RotateLeftIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Rotate right">
          <IconButton
            size="small"
            onClick={() => setRotation((r) => r + 90)}
            aria-label="Rotate image right"
          >
            <RotateRightIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}

/** PDF preview. Pipes the file's bytes into the webview as a
 *  `data:application/pdf;base64,…` URL inside an `<iframe>`. macOS
 *  WKWebView + Windows WebView2 both ship native PDF viewers; Linux's
 *  WebKitGTK falls back to "no plugin" — we surface a graceful "no
 *  preview available" message there. Same 16 MB cap as images. */
function PdfBody({ entry }: { entry: Entry }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(null);
    readBase64(entry.path)
      .then((b64) => {
        if (cancelled) return;
        setSrc(`data:application/pdf;base64,${b64}`);
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
      component="iframe"
      title={entry.name}
      src={src}
      sx={{
        width: "100%",
        height: 480,
        border: 0,
        borderRadius: 1,
        bgcolor: "common.white",
      }}
    />
  );
}

/** Audio / video preview. Mounts a native `<audio>` or `<video>` element
 *  pointed at a base64 data URL. Shares the same 16 MB read cap as
 *  images — anything larger surfaces an error and falls through to
 *  properties-only. The webview's native codec support determines what
 *  actually plays; we don't try to be smart about transcoding. */
function AVBody({ entry }: { entry: Entry }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isVideo = entry.kind === "video";

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
  return isVideo ? (
    <Box
      component="video"
      src={src}
      controls
      preload="metadata"
      sx={{
        maxWidth: "100%",
        maxHeight: 360,
        borderRadius: 1,
        display: "block",
        bgcolor: "common.black",
      }}
    />
  ) : (
    <Box
      component="audio"
      src={src}
      controls
      preload="metadata"
      sx={{ width: "100%", display: "block" }}
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
      // .skiff-selectable opts back into native text-selection,
      // overriding the global user-select:none baseline. Without
      // this the preview text would render but the user couldn't
      // copy from it — a regression of the 0.2.167 baseline.
      className="skiff-selectable"
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
function Body({
  entry,
  onImageDimensions,
}: {
  entry: Entry;
  onImageDimensions: (d: { w: number; h: number } | null) => void;
}) {
  if (entry.isDir) return <FolderBody entry={entry} />;
  if (isImage(entry.path)) {
    return <ImageBody entry={entry} onDimensions={onImageDimensions} />;
  }
  if (entry.kind === "audio" || entry.kind === "video") {
    return <AVBody entry={entry} />;
  }
  if (entry.kind === "pdf") {
    return <PdfBody entry={entry} />;
  }
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
  /** Natural pixel dimensions of the currently-rendered image, if any.
   *  Reset on selection change by ImageBody so a stale value from the
   *  previous image doesn't surface for the next one. */
  const [imageDimensions, setImageDimensions] = useState<{
    w: number;
    h: number;
  } | null>(null);
  /** EXIF for the currently-selected image, or `null` for non-images
   *  / no metadata. Surfaced in the properties block as Date taken /
   *  Camera / etc. Reset on selection change. */
  const [imageExif, setImageExif] = useState<ImageExif | null>(null);

  // Fetch EXIF whenever an image is selected. Best-effort — failures
  // (non-image, missing tags, remote path) silently leave EXIF null.
  // Skips remote paths since `fs_image_exif` is a local-only command.
  useEffect(() => {
    setImageExif(null);
    if (!selected || selected.isDir) return;
    if (selected.path.startsWith("sftp://")) return;
    // Cheap mime check via the same isImage helper used to pick the
    // body component. EXIF lives in JPEG/TIFF/HEIC; the underlying
    // crate returns "no metadata" for the rest.
    if (
      !/\.(jpe?g|tiff?|heic|heif|webp|png)$/i.test(selected.path) ||
      !/(image)/i.test(selected.kind)
    ) {
      return;
    }
    let cancelled = false;
    void fsImageExif(selected.path)
      .then((e) => {
        if (cancelled) return;
        // Filter out the all-null payload — no point rendering empty
        // fields when the image just doesn't carry EXIF.
        const hasAny = Object.values(e).some((v) => v != null);
        setImageExif(hasAny ? e : null);
      })
      .catch(() => {
        /* best-effort — preview still renders without EXIF */
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Drag-resize from the LEFT edge — the pane lives on the right of
  // the FileList, so dragging left widens it. Same MouseMove-on-document
  // pattern the Sidebar uses (0.2.28) so a fast drag past the handle's
  // own bounds doesn't drop the pointer.
  //
  // Drag-then-commit: mousemove updates a LOCAL `dragWidth` only;
  // the persisted settings.previewWidth is committed once on mouseup.
  // Without this, calling update() per mousemove fires the persist
  // effect 60 times a second and races with the cross-window
  // settings:changed listener — same class of bug fixed for the
  // sidebar resize in 0.2.167.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const effectiveWidth = dragWidth ?? width;
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let lastNext = startW;
    const onMove = (ev: MouseEvent) => {
      // dx grows as the mouse moves right; we want the pane to widen
      // when the mouse moves *left* (since the handle is on the left
      // edge), so subtract.
      const dx = ev.clientX - startX;
      lastNext = Math.max(
        PREVIEW_WIDTH_MIN,
        Math.min(PREVIEW_WIDTH_MAX, startW - dx),
      );
      setDragWidth(lastNext);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      update("previewWidth", lastNext);
      setDragWidth(null);
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
        width: effectiveWidth,
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
              sx={{ flex: 1, wordBreak: "break-all" }}
              title={selected.path}
            >
              {selected.name}
            </Typography>
            {!selected.isDir && !selected.path.startsWith("sftp://") && (
              <Tooltip title="Open with default app">
                <IconButton
                  size="small"
                  onClick={() => {
                    void fsOpenWithDefault(selected.path);
                  }}
                  aria-label="Open with default app"
                >
                  <LaunchIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>

          <Body entry={selected} onImageDimensions={setImageDimensions} />

          <Divider />

          <Stack spacing={0.5}>
            <Field label="Kind" value={selected.kind} />
            <Field
              label="Size"
              value={selected.isDir ? "—" : formatBytes(selected.size)}
            />
            <Field label="Modified" value={formatMtime(selected.mtime)} />
            {imageDimensions && (
              <Field
                label="Dimensions"
                value={`${imageDimensions.w} × ${imageDimensions.h}`}
              />
            )}
            {imageExif?.dateTaken && (
              <Field label="Taken" value={imageExif.dateTaken} />
            )}
            {(imageExif?.cameraMake || imageExif?.cameraModel) && (
              <Field
                label="Camera"
                value={[imageExif?.cameraMake, imageExif?.cameraModel]
                  .filter(Boolean)
                  .join(" ")
                  .trim()}
              />
            )}
            {imageExif?.lens && <Field label="Lens" value={imageExif.lens} />}
            {(imageExif?.exposure ||
              imageExif?.aperture ||
              imageExif?.iso ||
              imageExif?.focalLength) && (
              <Field
                label="Exposure"
                value={[
                  imageExif?.focalLength,
                  imageExif?.aperture,
                  imageExif?.exposure,
                  imageExif?.iso ? `ISO ${imageExif.iso}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            )}
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
