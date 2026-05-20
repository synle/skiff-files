// In-app preview modal. Same Body rendering as PreviewPane but at
// dialog scale, so the user can inspect images / text / PDFs without
// shelling out to the OS default app — which is the whole point on
// network-mounted backends (SFTP / FTP / SMB internal URLs), where
// the OS can't resolve the routing UUID.
//
// Trigger surfaces (all in Browser.tsx):
//   - Spacebar on a single previewable selection (every backend).
//   - "Open in preview window" button on the inline PreviewPane.
//   - Double-click / Enter / Cmd+↓ on a previewable file when the
//     backend has no native handler (SFTP / FTP).
//
// Lives in its own file so the inline PreviewPane stays single-purpose
// and the modal can grow its own concerns (keyboard nav between
// siblings, fullscreen toggle, etc.) without bloating the pane.
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
import { useState } from "react";
import { Body } from "./PreviewPane";
import IconForKind from "./IconForKind";
import type { Entry } from "../api/fs";

interface Props {
  /** Entry to preview. `null` keeps the dialog closed. */
  entry: Entry | null;
  /** Fired when the user closes the dialog (X button, Esc, backdrop
   *  click). The parent should null out `entry` in response. */
  onClose: () => void;
}

/** Full-screen-ish preview Dialog. Wraps the same Body component the
 *  inline pane uses, but sized for inspection (90vw × 90vh) and with
 *  no "Open preview" affordance (we ARE the preview). The image
 *  toolbar (rotate + zoom) comes from ImageBody itself in mode="modal";
 *  text bodies inherit their own toolbars in 0.2.315. */
export default function PreviewModal({ entry, onClose }: Props) {
  // Image dimensions surfaced by ImageBody — modal doesn't render a
  // properties block (the inline pane does that job), but we keep the
  // wiring so ImageBody stays single-implementation. The value is
  // intentionally unused here.
  const [, setImageDimensions] = useState<{ w: number; h: number } | null>(
    null,
  );
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
