// In-app preview modal. Same Body rendering as PreviewPane but at
// dialog scale, so the user can inspect images / text / video /
// audio / PDFs without shelling out to the OS default app — which
// is the whole point on network-mounted backends (SFTP / FTP / SMB
// internal URLs), where the OS can't resolve the routing UUID.
//
// Trigger surfaces (all in Browser.tsx):
//   - "Open in preview window" button on the inline PreviewPane.
//   - Double-click / Enter / Cmd/Ctrl/Alt+↓ on a previewable file
//     when the backend has no native handler (SFTP / FTP).
//
// Capabilities beyond the inline pane:
//   - Sibling navigation. The caller passes the list of previewable
//     siblings + the current index; arrow keys traverse the list
//     (↑/↓ in list view, full 2-D traversal in grid views).
//   - "Open in new window" button that spawns a dedicated preview
//     window via `window_open_preview`. Useful for keeping a
//     preview visible while the main window navigates elsewhere.
//   - EXIF auto-orientation for images (same wiring as the pane).
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import { useEffect, useState } from "react";
import { Body, isPreviewableEntry } from "./PreviewPane";
import IconForKind from "./IconForKind";
import {
  fsImageExif,
  windowOpenPreview,
  type Entry,
  type ImageExif,
} from "../api/fs";

/** View mode shape for grid traversal. List → only ↑/↓ navigation;
 *  grid → full 2-D with `gridCols` columns laid out left-to-right
 *  top-to-bottom (matches FileList's gallery / icon-grid output). */
export interface ModalNavView {
  kind: "list" | "grid";
  /** Ignored when kind === "list". Defaults to 4 if not provided. */
  gridCols?: number;
}

interface Props {
  /** Entry to preview. `null` keeps the dialog closed. */
  entry: Entry | null;
  /** Fired when the user closes the dialog (X button, Esc, backdrop
   *  click). The parent should null out `entry` in response. */
  onClose: () => void;
  /** The full ordered list the user is browsing. We filter down to
   *  the previewable subset internally so the arrow-key traversal
   *  skips folders / non-previewable kinds automatically. May be
   *  empty (legacy callers) — sibling nav arrows then hide. */
  siblings?: Entry[];
  /** Optional view metadata. Drives the ↑/↓/←/→ semantics: list
   *  view only uses ↑/↓; grid views use ←/→ within a row and ↑/↓
   *  across rows by `gridCols`. */
  view?: ModalNavView;
  /** Fired when the user navigates to a sibling via arrows / on-
   *  screen prev / next buttons. The parent updates its selection
   *  + the modal's `entry` prop in response. */
  onNavigate?: (entry: Entry) => void;
}

/** Full-screen-ish preview Dialog. Wraps the same Body component the
 *  inline pane uses, but sized for inspection (90vw × 90vh) and with
 *  no "Open preview" affordance (we ARE the preview). */
export default function PreviewModal({
  entry,
  onClose,
  siblings,
  view,
  onNavigate,
}: Props) {
  // Image dimensions surfaced by ImageBody — modal doesn't render a
  // properties block (the inline pane does that job), but we keep the
  // wiring so ImageBody stays single-implementation. The value is
  // intentionally unused here.
  const [, setImageDimensions] = useState<{ w: number; h: number } | null>(
    null,
  );
  /** EXIF for the current image so we can pre-apply the orientation
   *  transform in the modal too. Reset on entry change. */
  const [imageExif, setImageExif] = useState<ImageExif | null>(null);

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

  // Derive the previewable subset + the current index inside it.
  // The `siblings` list straight from the caller includes folders +
  // non-previewable kinds; filtering keeps the arrow keys focused on
  // entries the modal can actually render.
  const previewable = (siblings ?? []).filter((s) => isPreviewableEntry(s));
  const currentIdx = entry
    ? previewable.findIndex((s) => s.path === entry.path)
    : -1;
  const hasSiblings = previewable.length > 1 && currentIdx >= 0;

  // Compute target index for each arrow key. List view collapses
  // every arrow to a 1-step move; grid view uses gridCols for the
  // ±cols vertical step. Out-of-bounds targets are clamped (we don't
  // wrap — wrap-around inside a modal is more surprising than
  // helpful, and FileList itself doesn't wrap).
  const cols = Math.max(1, view?.gridCols ?? 4);
  const isList = view?.kind !== "grid";
  const stepTo = (delta: number) => {
    if (!hasSiblings) return;
    const next = currentIdx + delta;
    if (next < 0 || next >= previewable.length) return;
    onNavigate?.(previewable[next]);
  };

  // Wire arrow-key navigation + close-on-Esc at the document level so
  // the Dialog's own focus-trapped contents (textfields, buttons)
  // still receive arrows for THEIR own purposes — we only intercept
  // when no input has focus. Esc remains handled by MUI's Dialog
  // itself (via onClose) so we don't double-bind it.
  useEffect(() => {
    if (!entry) return;
    const onKey = (e: KeyboardEvent) => {
      // Bail on modifier combos so we don't fight the standard
      // browser / OS bindings (Cmd+arrow, Alt+arrow, etc.).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
      switch (e.key) {
        case "ArrowUp":
          if (!hasSiblings) return;
          e.preventDefault();
          stepTo(isList ? -1 : -cols);
          break;
        case "ArrowDown":
          if (!hasSiblings) return;
          e.preventDefault();
          stepTo(isList ? +1 : +cols);
          break;
        case "ArrowLeft":
          if (!hasSiblings || isList) return;
          e.preventDefault();
          stepTo(-1);
          break;
        case "ArrowRight":
          if (!hasSiblings || isList) return;
          e.preventDefault();
          stepTo(+1);
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // currentIdx is the only changing dep that affects stepTo bounds
    // beyond previewable.length; React re-runs the effect on every
    // entry change anyway via the `entry` dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, currentIdx, previewable.length, isList, cols]);

  return (
    <Dialog
      open={entry != null}
      onClose={onClose}
      // 90vw / 90vh approximates "fullscreen but still feels like a
      // window" — leaves room around the edges so the user knows
      // they're in a modal, not a new top-level surface.
      maxWidth={false}
      fullWidth
      slotProps={{
        paper: {
          sx: {
            width: "90vw",
            height: "90vh",
            maxWidth: "90vw",
            maxHeight: "90vh",
          },
        },
      }}
      aria-labelledby="preview-modal-title"
    >
      {entry && (
        <>
          <DialogTitle
            id="preview-modal-title"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              py: 1,
              pr: 1,
            }}
          >
            <IconForKind kind={entry.kind} fontSize="medium" />
            <Typography
              variant="subtitle1"
              sx={{
                flex: 1,
                wordBreak: "break-all",
                fontWeight: 500,
              }}
              title={entry.path}
            >
              {entry.name}
            </Typography>
            {hasSiblings && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mr: 1 }}
                aria-live="polite"
              >
                {currentIdx + 1} / {previewable.length}
              </Typography>
            )}
            {hasSiblings && (
              <Tooltip title="Previous (←)">
                <span>
                  <IconButton
                    size="small"
                    onClick={() => stepTo(isList ? -1 : -1)}
                    disabled={currentIdx <= 0}
                    aria-label="Previous file"
                  >
                    <KeyboardArrowLeftIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {hasSiblings && (
              <Tooltip title="Next (→)">
                <span>
                  <IconButton
                    size="small"
                    onClick={() => stepTo(isList ? +1 : +1)}
                    disabled={currentIdx >= previewable.length - 1}
                    aria-label="Next file"
                  >
                    <KeyboardArrowRightIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            <Tooltip title="Open in new window">
              <IconButton
                size="small"
                onClick={() => {
                  // Fire-and-forget — failures here just mean the
                  // user clicks again. We don't want to surface a
                  // toast for every transient Tauri error since the
                  // modal stays open and they can retry.
                  void windowOpenPreview(entry.path).catch(() => {});
                }}
                aria-label="Open in new window"
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Close (Esc)">
              <IconButton
                size="small"
                onClick={onClose}
                aria-label="Close preview"
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </DialogTitle>
          <DialogContent
            dividers
            sx={{
              // Body components handle their own scrolling when
              // zoomed. The DialogContent should NOT scroll on its
              // own — that would compound with the body's scroll and
              // produce a double scrollbar.
              overflow: "hidden",
              p: 2,
            }}
          >
            <Stack spacing={1.5} sx={{ height: "100%" }}>
              <Body
                entry={entry}
                onImageDimensions={setImageDimensions}
                mode="modal"
                exifOrientation={imageExif?.orientation ?? null}
              />
            </Stack>
          </DialogContent>
        </>
      )}
    </Dialog>
  );
}

// Re-export the Entry type from the module surface so test imports
// don't need to also pull from ../api/fs just to type a fixture.
export type { Entry };
