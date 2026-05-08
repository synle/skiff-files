// Reusable yes/no confirmation modal. Replaces all `window.confirm`
// calls — Tauri's webview suppresses native dialogs in some
// configurations, which silently broke flows like Move-to-Trash.
//
// Usage: lift open + onConfirm into the parent's state. Title +
// message string come straight from the caller; the dialog stays
// strictly presentational.

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";

interface Props {
  open: boolean;
  title: string;
  message: string;
  /** Verb on the confirm button. Defaults to "Confirm". Common values:
   *  "Delete", "Move to Trash", "Reset", "Clear". */
  confirmLabel?: string;
  /** When true, the confirm button is rendered with `color="warning"`
   *  to signal a destructive action. */
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  destructive = false,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText
          sx={{ wordBreak: "break-all", whiteSpace: "pre-wrap" }}
        >
          {message}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} autoFocus>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={destructive ? "warning" : "primary"}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
