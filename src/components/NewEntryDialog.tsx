// Shared modal for "New folder" / "New file" / inline create flows.
// Replaces the old `window.prompt` calls in Browser.tsx so the
// experience matches `RenameDialog` — auto-focus, Enter submits, Esc
// cancels, collision-aware (refuses names that already exist in the
// parent folder), and inline error feedback.

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
  /** Title — "New folder" / "New file". */
  title: string;
  /** Parent path the new entry will be created in. Shown above the
   *  input as context. */
  parentPath: string;
  /** Initial value for the input. The dialog pre-selects the stem so
   *  the user can type over it immediately (Finder behavior). */
  defaultName: string;
  /** Sibling names already in the parent folder. The Submit button
   *  disables when the trimmed input matches one of these — closes
   *  the corner case where users blindly hit Enter on a duplicate. */
  existingNames: Set<string>;
  /** Verb on the submit button — "Create", "Rename", etc. */
  submitLabel?: string;
  onClose: () => void;
  /** Called with the trimmed name when the user submits. Resolves
   *  with whatever the upstream operation returns; rejects propagate
   *  to the dialog as inline error text. */
  onSubmit: (name: string) => Promise<void>;
}

/** Pre-select the stem (everything before the last `.`) so the user
 *  can type a new name without manually re-selecting. Matches Finder
 *  / Explorer's rename flow. For folders / dot-only names returns the
 *  full length so the whole field is selected. */
function stemEnd(name: string): number {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return name.length;
  return dot;
}

export default function NewEntryDialog({
  open,
  title,
  parentPath,
  defaultName,
  existingNames,
  submitLabel = "Create",
  onClose,
  onSubmit,
}: Props) {
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state on every open so a previous error / draft doesn't
  // bleed into the next create.
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setError(null);
      setBusy(false);
    }
  }, [open, defaultName]);

  const trimmed = name.trim();
  const collides = trimmed.length > 0 && existingNames.has(trimmed);
  const hasSeparator =
    trimmed.includes("/") || trimmed.includes("\\");
  const submitDisabled = busy || trimmed.length === 0 || collides || hasSeparator;

  const submit = async () => {
    if (submitDisabled) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  // Inline guidance under the input — collision / separator / error
  // get the same caption color so the user reads them as one.
  const helper = hasSeparator
    ? "Name can't contain a path separator."
    : collides
      ? `A file or folder named "${trimmed}" already exists here.`
      : error;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ wordBreak: "break-all" }}
          >
            {parentPath}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Name"
            value={name}
            error={collides || hasSeparator || !!error}
            helperText={helper ?? " "}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") onClose();
            }}
            slotProps={{
              htmlInput: {
                "aria-label": "Name",
                onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
                  const el = e.target;
                  el.setSelectionRange(0, stemEnd(defaultName));
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
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
