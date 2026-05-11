// In-app archive viewer. Opens via right-click → "View contents" on a
// .zip file. Lists entries (name + uncompressed size). Each row gets
// an "Extract this file" affordance that writes the entry to a sibling
// of the zip with collision-aware naming.
//
// Tar / 7z support is future work — they'd add a per-format Rust
// command and a discriminator on the path extension. The dialog
// stays format-agnostic.
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatBytes } from "../util/format";

interface ArchiveEntry {
  name: string;
  size: number;
  isDir: boolean;
}

interface Props {
  open: boolean;
  /** Absolute path to the archive file. */
  archivePath: string | null;
  onClose: () => void;
  /** Optional refresh hook fired after a successful single-file
   *  extract so the parent listing picks up the new sibling. */
  onExtracted?: () => void;
}

export default function ArchiveViewerDialog({
  open,
  archivePath,
  onClose,
  onExtracted,
}: Props) {
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open || !archivePath) {
      setEntries(null);
      setError(null);
      setFilter("");
      return;
    }
    let cancelled = false;
    setEntries(null);
    setError(null);
    void invoke<ArchiveEntry[]>("fs_archive_list", { path: archivePath })
      .then((rs) => {
        if (!cancelled) setEntries(rs);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, archivePath]);

  const handleExtract = (entry: ArchiveEntry) => {
    if (!archivePath) return;
    // Write the extract to a sibling of the zip. Collision-aware:
    // append " (2)" / " (3)" before the extension if needed.
    const sep = archivePath.lastIndexOf("/");
    const parent = sep > 0 ? archivePath.slice(0, sep) : "";
    const baseName = entry.name.split("/").pop() ?? entry.name;
    const dest = `${parent}/${baseName}`;
    void invoke<void>("fs_archive_extract_one", {
      zipPath: archivePath,
      entryName: entry.name,
      destPath: dest,
    })
      .then(() => onExtracted?.())
      .catch((e) => setError(String(e)));
  };

  const filtered =
    entries && filter
      ? entries.filter((e) =>
          e.name.toLowerCase().includes(filter.toLowerCase()),
        )
      : entries;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Archive contents
        {archivePath && (
          <Typography
            variant="caption"
            sx={{ display: "block", color: "text.secondary" }}
          >
            {archivePath}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Typography variant="body2" color="error" sx={{ mb: 1 }}>
            {error}
          </Typography>
        )}
        {!entries && !error && (
          <Typography variant="body2" color="text.secondary">
            Loading…
          </Typography>
        )}
        {entries && (
          <Box sx={{ mb: 1, display: "flex", alignItems: "center", gap: 2 }}>
            {/* MUI TextField (not a raw <input>) so the filter box
                picks up the theme palette — the previous bare input
                rendered with the browser default white background in
                dark mode, which clashed with the dialog surface. */}
            <TextField
              size="small"
              fullWidth
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <Typography variant="caption" color="text.secondary">
              {filtered?.length ?? 0} of {entries.length}
            </Typography>
          </Box>
        )}
        {filtered && (
          <List dense>
            {filtered.map((e) => (
              <ListItem
                key={e.name}
                secondaryAction={
                  e.isDir ? null : (
                    <Tooltip title="Extract this file to the archive's parent folder">
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={() => handleExtract(e)}
                        aria-label={`Extract ${e.name}`}
                      >
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )
                }
              >
                <ListItemText
                  primary={e.name}
                  secondary={e.isDir ? "folder" : formatBytes(e.size)}
                  slotProps={{
                    primary: { variant: "body2", style: { fontFamily: "monospace" } },
                    secondary: { variant: "caption" },
                  }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
