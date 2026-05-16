// "Show all recent" dialog — overflow surface for the sidebar's
// Recent section. The sidebar only renders the top `recentPathsMax`
// entries to stay compact; this dialog surfaces the full tracked
// history (up to RECENT_PATHS_TRACK_MAX) with a top-of-list search
// field and per-row origin chip so SFTP / FTP / SMB entries are
// distinguishable from local paths.
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import HistoryIcon from "@mui/icons-material/History";
import SearchIcon from "@mui/icons-material/Search";
import { useMemo, useState } from "react";
import { pathOriginLabel } from "../util/shortPath";

interface Props {
  open: boolean;
  paths: string[];
  onClose: () => void;
  onNavigate: (path: string) => void;
}

/** Hard cap on rows the dialog renders — defense in depth against a
 *  future bug that lets `recentPaths` grow past the storage cap.
 *  Matches RECENT_PATHS_TRACK_MAX in settings.tsx. */
const DIALOG_LIMIT = 200;

export default function RecentPathsDialog({
  open,
  paths,
  onClose,
  onNavigate,
}: Props) {
  const [query, setQuery] = useState("");

  // Substring match, case-insensitive. The full path is shown so
  // matching on either the basename or any parent dir works.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const slice = paths.slice(0, DIALOG_LIMIT);
    if (!q) return slice;
    return slice.filter((p) => p.toLowerCase().includes(q));
  }, [paths, query]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="recent-paths-dialog-title"
    >
      <DialogTitle
        id="recent-paths-dialog-title"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pr: 1,
        }}
      >
        <span>Recent paths</span>
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Box sx={{ px: 2, py: 1.5 }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recent paths…"
            slotProps={{
              input: {
                startAdornment: (
                  <SearchIcon
                    fontSize="small"
                    sx={{ color: "text.secondary", mr: 1 }}
                  />
                ),
              },
            }}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 0.5 }}
          >
            {filtered.length} of {Math.min(paths.length, DIALOG_LIMIT)} shown
            {paths.length > DIALOG_LIMIT
              ? ` (capped at ${DIALOG_LIMIT})`
              : ""}
          </Typography>
        </Box>
        {filtered.length === 0 ? (
          <Box sx={{ px: 2, py: 4, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              No matches.
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {filtered.map((p) => {
              const origin = pathOriginLabel(p);
              return (
                <ListItem key={p} disablePadding>
                  <ListItemButton
                    onClick={() => {
                      onNavigate(p);
                      onClose();
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <HistoryIcon
                        fontSize="small"
                        sx={{ color: "text.secondary" }}
                      />
                    </ListItemIcon>
                    <ListItemText
                      primary={p}
                      slotProps={{
                        primary: {
                          variant: "body2",
                          sx: { wordBreak: "break-all" },
                        },
                      }}
                    />
                    <Chip
                      label={origin}
                      size="small"
                      variant="outlined"
                      sx={{ ml: 1, flexShrink: 0 }}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
}
