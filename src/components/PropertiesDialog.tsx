// Properties dialog. Reachable from the right-click context menu.
// Shows the same fields the preview pane already surfaces (size,
// kind, mtime, mode, path) plus a recursive size for folders so the
// user doesn't have to wait for the preview pane to scan.
//
// Keeping this distinct from the preview pane is intentional: the
// preview pane is for content (image / text / folder summary at a
// glance), this dialog is for metadata you want a stable view of
// while doing something else (Cmd-tab to a terminal etc.).
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useEffect, useState } from "react";
import { dirSummary, hashSha256 } from "../api/client";
import { type DirSummary, type Entry } from "../api/fs";
import { formatBytes, formatMtime } from "../util/format";
import IconForKind from "./IconForKind";

interface Props {
  entry: Entry | null;
  onClose: () => void;
}

/** Two-column row used throughout the body. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", gap: 1.5 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ width: 96, flexShrink: 0 }}
      >
        {label}
      </Typography>
      <Typography variant="caption" sx={{ wordBreak: "break-all" }}>
        {value}
      </Typography>
    </Box>
  );
}

export default function PropertiesDialog({ entry, onClose }: Props) {
  const [summary, setSummary] = useState<DirSummary | null>(null);
  /** SHA-256 hex digest. Lazily computed via the "Compute SHA-256"
   *  button — non-trivial cost on large files, so we don't auto-fire
   *  on every Properties open. Reset on entry change. */
  const [sha256, setSha256] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);

  useEffect(() => {
    setSummary(null);
    setSha256(null);
    setHashing(false);
    if (!entry?.isDir) return;
    let cancelled = false;
    void dirSummary(entry.path)
      .then((s) => !cancelled && setSummary(s))
      .catch(() => {
        /* show "—" instead of erroring — folder size is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  if (!entry) return null;
  const prefix = summary?.truncated ? "≥" : "";
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      aria-label={`Properties of ${entry.name}`}
    >
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <IconForKind kind={entry.kind} fontSize="medium" />
          <Box sx={{ wordBreak: "break-all" }}>{entry.name}</Box>
        </Box>
        <IconButton
          size="small"
          onClick={onClose}
          aria-label="Close properties"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={0.75}>
          <Field label="Kind" value={entry.kind} />
          <Field
            label="Size"
            value={
              entry.isDir
                ? summary
                  ? `${prefix}${formatBytes(summary.totalSize)} · ${prefix}${summary.entries.toLocaleString()} items`
                  : "Calculating…"
                : formatBytes(entry.size)
            }
          />
          <Field label="Modified" value={formatMtime(entry.mtime)} />
          {entry.mode != null && (
            <Field
              label="Mode"
              value={`0${entry.mode.toString(8).slice(-3)}`}
            />
          )}
          {entry.isSymlink && <Field label="Symlink" value="yes" />}
          {entry.isHidden && <Field label="Hidden" value="yes" />}
          <Field label="Path" value={entry.path} />
          {sha256 && <Field label="SHA-256" value={<code>{sha256}</code>} />}
          {!entry.isDir && !sha256 && (
            <Box sx={{ pt: 0.5 }}>
              <Button
                size="small"
                variant="outlined"
                disabled={hashing}
                onClick={() => {
                  setHashing(true);
                  void hashSha256(entry.path)
                    .then((h) => setSha256(h))
                    .catch(() => {
                      /* swallow — UI just won't show the hash */
                    })
                    .finally(() => setHashing(false));
                }}
              >
                {hashing ? "Hashing…" : "Compute SHA-256"}
              </Button>
            </Box>
          )}
          <Box sx={{ pt: 1 }}>
            <Button
              size="small"
              startIcon={<ContentCopyIcon fontSize="small" />}
              onClick={() => {
                if (
                  typeof navigator !== "undefined" &&
                  navigator.clipboard
                ) {
                  // JSON dump of the metadata block. Useful for
                  // bug reports / Slack pastes / pasting into
                  // scripts (jq-friendly). Folder sizes flow in
                  // when the recursive scan has finished.
                  void navigator.clipboard.writeText(
                    JSON.stringify(
                      {
                        name: entry.name,
                        kind: entry.kind,
                        size: entry.isDir
                          ? summary?.totalSize ?? null
                          : entry.size,
                        items: entry.isDir
                          ? summary?.entries ?? null
                          : null,
                        modified: entry.mtime,
                        mode: entry.mode,
                        isSymlink: entry.isSymlink,
                        isHidden: entry.isHidden,
                        path: entry.path,
                      },
                      null,
                      2,
                    ),
                  );
                }
              }}
            >
              Copy info as JSON
            </Button>
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
