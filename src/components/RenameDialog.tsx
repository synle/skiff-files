// Rename dialog. Opens on F2 in the Browser when something is
// primary-selected. Routes through `client.rename` so local + sftp
// both work without the caller branching on scheme.
//
// Inline-on-row rename is a Phase 6 polish item — virtualizing an
// editable row inside @tanstack/react-virtual takes care, and a
// dialog is what the typical user actually expects from a rename
// keyboard shortcut on Windows / Linux. macOS Finder uses both.
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  /** Original entry name. Used as the initial input value. */
  originalName: string;
  /** Original full path. The dialog never sees the parent — it just
   *  passes (newName) back up so the caller can compute the dest. */
  originalPath: string;
  /** Sibling names that already exist in the parent (excluding the
   *  entry being renamed). Submit disables when the trimmed input
   *  matches one of these — closes the corner case where users
   *  blindly hit Enter on a duplicate. */
  existingNames?: Set<string>;
  onClose: () => void;
  /** Resolves with the user-entered new name (no path components). */
  onRename: (newName: string) => Promise<void>;
}

/** Pre-select the stem (everything before the last `.`) so the user
 *  can type a new name without manually re-selecting. Matches Finder /
 *  Explorer behavior. */
function stemEnd(name: string): number {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return name.length;
  return dot;
}

export default function RenameDialog({
  open,
  originalName,
  originalPath,
  existingNames,
  onClose,
  onRename,
}: Props) {
  const [name, setName] = useState(originalName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state on every open so a previous error / draft doesn't
  // bleed into the next rename.
  useEffect(() => {
    if (open) {
      setName(originalName);
      setError(null);
      setBusy(false);
    }
  }, [open, originalName]);

  const trimmed = name.trim();
  const collides =
    trimmed.length > 0 &&
    trimmed !== originalName &&
    !!existingNames?.has(trimmed);
  const hasSeparator =
    trimmed.includes("/") || trimmed.includes("\\");
  const submitDisabled =
    busy ||
    trimmed.length === 0 ||
    trimmed === originalName ||
    collides ||
    hasSeparator;

  const submit = async () => {
    if (submitDisabled) {
      // No-op trim or unchanged name — close cleanly.
      if (!trimmed || trimmed === originalName) onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRename(trimmed);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Rename</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ wordBreak: "break-all" }}
          >
            {originalPath}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="New name"
            value={name}
            error={collides || hasSeparator || !!error}
            helperText={
              hasSeparator
                ? "Name can't contain a path separator."
                : collides
                  ? `A file or folder named "${trimmed}" already exists here.`
                  : (error ?? " ")
            }
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") onClose();
            }}
            slotProps={{
              htmlInput: {
                "aria-label": "New name",
                // Pre-select the stem so the user can replace it
                // immediately. Setting selection on focus is the
                // simplest cross-platform way to do this.
                onFocus: (
                  e: React.FocusEvent<HTMLInputElement>,
                ) => {
                  const el = e.target;
                  el.setSelectionRange(0, stemEnd(originalName));
                },
              },
            }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={submitDisabled}
        >
          Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
}
