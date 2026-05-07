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

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === originalName) {
      onClose();
      return;
    }
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      setError("Name can't contain a path separator.");
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
          {error && (
            <Typography variant="caption" color="error">
              {error}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={busy || !name.trim() || name === originalName}
        >
          Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
}
