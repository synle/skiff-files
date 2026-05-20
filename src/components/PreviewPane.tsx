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
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import RotateLeftIcon from "@mui/icons-material/RotateLeft";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import SaveIcon from "@mui/icons-material/Save";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import { useEffect, useRef, useState } from "react";
import {
  fsImageExif,
  fsImageRotate,
  fsOpenWithDefault,
  fsRevealInOs,
  type DirSummary,
  type Entry,
  type ImageExif,
} from "../api/fs";
import { dirSummary, readBase64 } from "../api/client";
import { startNativeDrag } from "../api/drag";
import { formatBytes, formatMtime } from "../util/format";
import { isImage, mimeForPath } from "../util/mime";
import { toNativeRemoteUrl } from "../util/nativeRemoteUrl";
import { parseLocation } from "../util/location";
import { humanizeRemoteUrl } from "../util/humanizeRemoteUrl";
import {
  orientationSwapsDimensions,
  orientationToCssTransform,
} from "../util/exifOrientation";
import {
  PREVIEW_WIDTH_MAX,
  PREVIEW_WIDTH_MIN,
  useSettings,
} from "../state/settings";
import IconForKind from "./IconForKind";
import TextBody from "./preview/TextBody";
import MediaBody from "./preview/MediaBody";

interface Props {
  /** Currently focused / selected entry. `null` = nothing selected. */
  selected: Entry | null;
  /** Pane width in pixels. The parent owns resize; we just consume the value. */
  width: number;
  /** Callback fired when the user clicks the "Open in preview window"
   *  button. The Browser-level parent owns the modal state; this pane
   *  just signals intent. Omit to hide the button (e.g. tests that
   *  don't care about modal wiring). */
  onOpenInModal?: (entry: Entry) => void;
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
 *  so the properties block can render them.
 *
 *  Two render modes:
 *    - `"inline"` (default) — fits inside the right-hand preview pane.
 *      Scrollable wrapper capped at 480 px tall when zoomed; image
 *      max 360 px tall when fit-to-pane.
 *    - `"modal"` — fills the in-app PreviewModal Dialog. Scrollable
 *      wrapper takes ~70vh so the user has real estate to inspect.
 *
 *  Zoom semantics:
 *    - `null` zoom = fit-to-container (default). Image clamped to
 *      `maxWidth: 100%` + `maxHeight: <fitCap>` so it never exceeds
 *      the pane; no scrollbars.
 *    - numeric zoom = explicit scale factor (1.0 = 100%, 2.0 = 200%,
 *      0.5 = 50%). Image renders at natural pixel size scaled by the
 *      factor; wrapper scrolls when dimensions exceed container.
 *      Step in/out via the toolbar's Zoom In / Zoom Out buttons.
 */
export function ImageBody({
  entry,
  onDimensions,
  mode = "inline",
  exifOrientation,
}: {
  entry: Entry;
  onDimensions: (d: { w: number; h: number } | null) => void;
  mode?: "inline" | "modal";
  /** EXIF Orientation tag (1–8), or `null`/undefined when the file
   *  carries none. Applied as a CSS pre-transform so JPEG/HEIC files
   *  written with rotated sensors (every modern phone camera) land
   *  upright on first paint. The user can still rotate further with
   *  the toolbar; that rotation composes on top of the EXIF-baseline
   *  one. */
  exifOrientation?: number | null;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Rotation in degrees, applied via CSS transform. Resets to 0
   *  whenever the selection changes so the next image starts upright.
   *  When the user clicks Save, we hand the rotation off to the
   *  Rust-side `fs_image_rotate` and reset back to 0 — the file
   *  itself is now physically rotated, so the CSS transform should
   *  no longer apply. */
  const [rotation, setRotation] = useState<number>(0);
  /** True while the Save command is in flight. Locks the rotate
   *  buttons + disables Save itself so the user can't double-fire
   *  during the encode. */
  const [saving, setSaving] = useState<boolean>(false);
  /** Bumped whenever Save succeeds so the load effect re-fetches
   *  the file (bypassing the previous data-URL state). The path
   *  alone isn't enough — same path before + after the rotate. */
  const [reloadKey, setReloadKey] = useState<number>(0);
  /** Zoom factor. `null` = fit-to-container (default); a number =
   *  explicit scale factor relative to natural pixel size. Bounded
   *  in `[ZOOM_MIN, ZOOM_MAX]` by the step helpers below. Resets to
   *  `null` on selection change so each new image starts fitted. */
  const [zoom, setZoom] = useState<number | null>(null);
  /** Drag-to-pan when zoomed. The scrollable wrapper holds the ref;
   *  pointer-down captures the starting cursor + scroll offset, then
   *  pointermove updates scrollTop / scrollLeft by the delta until
   *  pointerup. */
  const panContainerRef = useRef<HTMLDivElement | null>(null);
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    moved: boolean;
  } | null>(null);

  // Zoom bounds + step factor. ZOOM_MIN = 0.1 (10%) lets the user
  // see a thumbnail of a huge image without scrolling; ZOOM_MAX = 8
  // (800%) lets them pixel-peep without unbounded scaling. The step
  // factor (1.25) gives ~7 clicks to traverse 100% → 800%.
  const ZOOM_MIN = 0.1;
  const ZOOM_MAX = 8;
  const ZOOM_STEP = 1.25;
  const stepIn = () => {
    setZoom((prev) => {
      // Stepping in from fit jumps to 100% — the natural anchor users
      // expect ("zoom in" from fitted = show actual size). Subsequent
      // steps multiply by ZOOM_STEP.
      if (prev == null) return 1;
      return Math.min(ZOOM_MAX, prev * ZOOM_STEP);
    });
  };
  const stepOut = () => {
    setZoom((prev) => {
      // Stepping out from fit jumps to 50% so the user lands somewhere
      // meaningful instead of toggling. Subsequent steps divide.
      if (prev == null) return 0.5;
      return Math.max(ZOOM_MIN, prev / ZOOM_STEP);
    });
  };
  const zoomActual = () => setZoom(1);
  const zoomFit = () => setZoom(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(null);
    setRotation(0);
    setZoom(null);
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
    // reloadKey re-runs the effect after a rotation save lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.path, reloadKey]);

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
  const isZoomed = zoom != null;
  // Container height when explicitly zoomed (need a fixed height so
  // overflow:auto produces scrollbars when scaled dimensions exceed it).
  // Inline lives next to a properties block — 480 px is the inherited
  // 0.2.x value. Modal fills the dialog — 70vh gives the user real
  // estate without crowding the toolbar.
  const containerHeight = mode === "modal" ? "70vh" : 480;
  // Max image dimension when fitted. Inline keeps the legacy 360 px
  // cap so the properties block has room below; modal lets the image
  // bloom to ~75vh.
  const fittedMaxHeight = mode === "modal" ? "75vh" : 360;
  return (
    <Box>
      <Box
        ref={panContainerRef}
        // When zoomed, wrap in a fixed-height scrollable container so
        // the user can scroll the scaled image inside the pane bounds
        // without pushing the properties block off-screen. When fitted
        // (zoom == null), no wrapper sizing — the image's own
        // maxWidth/maxHeight do the constraining.
        sx={
          isZoomed
            ? {
                height: containerHeight,
                overflow: "auto",
                borderRadius: 1,
                bgcolor: "action.hover",
                // Center the image when it's smaller than the
                // container (e.g. user zoomed to 25% on a small image).
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "flex-start",
              }
            : undefined
        }
      >
        <Box
          component="img"
          src={src}
          alt={entry.name}
          // When NOT zoomed, allow drag-out to OS Finder / Desktop
          // via the native drag-source plugin. When zoomed, dragging
          // is reserved for pan, so we disable HTML5 drag entirely.
          draggable={!isZoomed && !entry.path.startsWith("sftp://")}
          onDragStart={(e) => {
            // The HTML5 drag still fires inside our window for the
            // existing in-app drop targets (sidebar host items,
            // bookmarks, folder rows), so set the standard MIME too.
            e.dataTransfer.setData(
              "application/x-skiff-paths",
              entry.path,
            );
            e.dataTransfer.effectAllowed = "copy";
            // Fire native drag in parallel so the OS picks it up
            // when the cursor leaves the window. Local-only — guarded
            // by the `draggable=` check above already.
            void startNativeDrag([entry.path]).catch(() => {});
          }}
          onLoad={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              // Swap reported dimensions when the EXIF orientation
              // tag implies a 90° rotation — the user is seeing
              // height × width, so the properties block should
              // reflect that, not the file's raw pixel dimensions.
              const swap = orientationSwapsDimensions(exifOrientation);
              onDimensions({
                w: swap ? img.naturalHeight : img.naturalWidth,
                h: swap ? img.naturalWidth : img.naturalHeight,
              });
            }
          }}
          onPointerDown={(e) => {
            if (!isZoomed) return;
            const cont = panContainerRef.current;
            if (!cont) return;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            panStateRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              scrollLeft: cont.scrollLeft,
              scrollTop: cont.scrollTop,
              moved: false,
            };
          }}
          onPointerMove={(e) => {
            const s = panStateRef.current;
            const cont = panContainerRef.current;
            if (!s || !cont) return;
            const dx = e.clientX - s.startX;
            const dy = e.clientY - s.startY;
            if (!s.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
              s.moved = true;
            }
            cont.scrollLeft = s.scrollLeft - dx;
            cont.scrollTop = s.scrollTop - dy;
          }}
          onPointerUp={(e) => {
            panStateRef.current = null;
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          }}
          title={
            isZoomed
              ? `Zoom ${Math.round((zoom ?? 1) * 100)}% · drag to pan`
              : "Fit to pane"
          }
          sx={{
            maxWidth: isZoomed ? "none" : "100%",
            maxHeight: isZoomed ? "none" : fittedMaxHeight,
            borderRadius: 1,
            display: "block",
            cursor: isZoomed ? "grab" : "default",
            "&:active": { cursor: isZoomed ? "grabbing" : "default" },
            // Combine EXIF auto-orient + user rotation + zoom in a
            // single transform so the browser applies them as one
            // matrix (no compounding bugs when rotating a zoomed
            // image). Order matters: EXIF first (camera sensor
            // correction), then user rotation (additive on top),
            // then scale (zoom around the same origin).
            transform: [
              orientationToCssTransform(exifOrientation),
              `rotate(${rotation}deg)`,
              isZoomed ? `scale(${zoom})` : null,
            ]
              .filter(Boolean)
              .join(" "),
            // Keep the rotated image inside the pane bounds — without
            // `transform-origin: center` rotation pivots from top-left
            // and the image walks off screen on quarter turns.
            transformOrigin: "center",
            transition: "transform 200ms",
            userSelect: "none",
            // When zoomed via scale(), the rendered box still occupies
            // natural pixel dimensions; CSS scale doesn't grow the box
            // so the scrollable wrapper wouldn't know to scroll. Force
            // the rendered box to scaled dimensions by setting width /
            // height explicitly when zoomed.
            ...(isZoomed && {
              transformOrigin: "top left",
            }),
          }}
        />
      </Box>
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ mt: 0.5, flexWrap: "wrap", alignItems: "center" }}
      >
        <Tooltip title="Rotate left (90°)">
          <span>
            <IconButton
              size="small"
              disabled={saving}
              onClick={() => setRotation((r) => r - 90)}
              aria-label="Rotate image left"
            >
              <RotateLeftIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Rotate right (90°)">
          <span>
            <IconButton
              size="small"
              disabled={saving}
              onClick={() => setRotation((r) => r + 90)}
              aria-label="Rotate image right"
            >
              <RotateRightIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip
          title={
            rotation === 0
              ? "Rotate the image first"
              : "Save rotation to the file (JPEG round-trip is lossy)"
          }
        >
          {/* `<span>` so the disabled state still surfaces a tooltip — MUI
              swallows hover on disabled IconButtons otherwise. */}
          <span>
            <IconButton
              size="small"
              disabled={rotation === 0 || saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await fsImageRotate(entry.path, rotation);
                  // The file is now physically rotated. Drop the CSS
                  // transform so we don't double-rotate visually,
                  // then bump reloadKey so the load effect re-fetches.
                  setRotation(0);
                  setReloadKey((k) => k + 1);
                } catch (e) {
                  setError(`Save rotation: ${String(e)}`);
                } finally {
                  setSaving(false);
                }
              }}
              aria-label="Save rotation"
            >
              <SaveIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Zoom out">
          <span>
            <IconButton
              size="small"
              onClick={stepOut}
              disabled={zoom != null && zoom <= ZOOM_MIN + 1e-6}
              aria-label="Zoom out"
            >
              <ZoomOutIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Zoom 100%">
          <span>
            <IconButton
              size="small"
              onClick={zoomActual}
              aria-label="Zoom to 100% (actual size)"
            >
              <RestartAltIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Fit to pane">
          <span>
            <IconButton
              size="small"
              onClick={zoomFit}
              disabled={zoom == null}
              aria-label="Fit image to pane"
            >
              <FitScreenIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Zoom in">
          <span>
            <IconButton
              size="small"
              onClick={stepIn}
              disabled={zoom != null && zoom >= ZOOM_MAX - 1e-6}
              aria-label="Zoom in"
            >
              <ZoomInIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Typography
          variant="caption"
          sx={{ minWidth: 36, textAlign: "right", color: "text.secondary" }}
          aria-live="polite"
        >
          {zoom == null ? "Fit" : `${Math.round(zoom * 100)}%`}
        </Typography>
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

/** Decide which body component to render based on the selected entry's
 *  kind. Forwards the `mode` prop ("inline" vs "modal") to the
 *  image / text / media bodies so they can size their containers +
 *  toolbars appropriately.
 *
 *  Routing:
 *    - folders → FolderBody (recursive scan summary)
 *    - images  → ImageBody (with EXIF auto-orientation)
 *    - audio / video → MediaBody (custom seekbar + volume)
 *    - pdf     → PdfBody (webview's native viewer)
 *    - everything else → TextBody (lossy UTF-8 decode + Prism
 *      highlight + markdown toggle when kind === "markdown")
 *
 *  The "fallback to text" change in 0.2.316 retired the hex dump
 *  for unknown / binary kinds. Rationale: extension classifiers
 *  routinely miss files that ARE text (no extension, custom
 *  extension, build artifacts named `.bundle` / `.patch` etc.), so
 *  the user used to land on hex when they expected to read source.
 *  Real binary files (zip, png-by-the-bytes, ELF) still render — as
 *  garbled lossy UTF-8 — which is enough signal that "this isn't
 *  text" without the dedicated hex view. */
export function Body({
  entry,
  onImageDimensions,
  mode = "inline",
  exifOrientation,
}: {
  entry: Entry;
  onImageDimensions: (d: { w: number; h: number } | null) => void;
  mode?: "inline" | "modal";
  /** EXIF Orientation, threaded through from the parent so ImageBody
   *  can pre-rotate JPEG/HEIC files written with sensor-only
   *  orientation tags. `null` / undefined disables the transform. */
  exifOrientation?: number | null;
}) {
  if (entry.isDir) return <FolderBody entry={entry} />;
  if (isImage(entry.path)) {
    return (
      <ImageBody
        entry={entry}
        onDimensions={onImageDimensions}
        mode={mode}
        exifOrientation={exifOrientation}
      />
    );
  }
  if (entry.kind === "audio" || entry.kind === "video") {
    return <MediaBody entry={entry} mode={mode} />;
  }
  if (entry.kind === "pdf") {
    return <PdfBody entry={entry} />;
  }
  // Everything else (text / code / markdown / binary / unknown /
  // archive / document / spreadsheet …) flows through TextBody.
  // The Rust side reads `path` with `String::from_utf8_lossy`, so
  // truly-binary content surfaces as replacement-char-laden output
  // — distinguishable from real text at a glance, but the same
  // surface keeps "user clicked on something with a weird
  // extension" predictable.
  return <TextBody entry={entry} mode={mode} />;
}

/** Predicate: does this entry have a useful inline preview body? Used
 *  by callers (PreviewPane "Open preview window" button gate, network-
 *  drive open routing) to decide whether to surface the in-app preview
 *  affordances vs. falling back to OS handoff / properties-only.
 *  Returns false for directories — every other file kind is
 *  previewable now that the fallback is plain-text rather than hex.
 *  Symlinks still preview by following the link on the backend side
 *  (the symlink kind is a frontend distinction only). */
export function isPreviewableEntry(entry: Entry): boolean {
  if (entry.isDir) return false;
  return true;
}

export default function PreviewPane({ selected, width, onOpenInModal }: Props) {
  const { settings, update } = useSettings();
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
            {onOpenInModal && !selected.isDir && isPreviewableEntry(selected) && (
              <Tooltip title="Open in preview window">
                {/* In-app preview modal. Routes through the same Body
                 *  used inline, so it works on every backend including
                 *  SMB / SFTP / FTP where `fsOpenWithDefault` can't
                 *  reach (Finder / Explorer can't resolve the routing
                 *  UUID in our internal URL form). */}
                <IconButton
                  size="small"
                  onClick={() => onOpenInModal(selected)}
                  aria-label="Open in preview window"
                >
                  <OpenInFullIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {parseLocation(selected.path).backend.kind === "local" && (
              <Tooltip title="Reveal in Finder/Explorer">
                <IconButton
                  size="small"
                  onClick={() => {
                    void fsRevealInOs(selected.path).catch(() => {});
                  }}
                  aria-label="Reveal in Finder/Explorer"
                >
                  <FolderOpenIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {!selected.isDir && (() => {
              // SMB has a native OS handler — translate the internal
              // `smb://<uuid>/...` URL to `smb://[user@]host/share/...`
              // before handing to the OS. SFTP / FTP don't have a
              // native handler, so the button is hidden entirely.
              const { url } = toNativeRemoteUrl(
                selected.path,
                settings.connections,
              );
              if (url == null) return null;
              return (
                <Tooltip title="Open with default app">
                  <IconButton
                    size="small"
                    onClick={() => {
                      void fsOpenWithDefault(url);
                    }}
                    aria-label="Open with default app"
                  >
                    <LaunchIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              );
            })()}
          </Box>

          <Body
            entry={selected}
            onImageDimensions={setImageDimensions}
            exifOrientation={imageExif?.orientation ?? null}
          />

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
            <Field
              label="Path"
              // Display the friendly form so users see
              // `smb://admin@nas:445/G/folder/file` instead of the
              // raw internal UUID.
              value={humanizeRemoteUrl(
                selected.path,
                new Map(settings.connections.map((c) => [c.id, c.label])),
              )}
            />
          </Stack>
        </Stack>
      )}
    </Box>
  );
}
