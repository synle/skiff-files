// Contextual action bar that appears between the Toolbar and the
// FileList when 2+ rows are selected. Mirrors the right-click menu
// for users who don't muscle-memory Cmd-click + right-click flows;
// keeps the Toolbar uncluttered when nothing's selected.
//
// All actions are also keyboard-accessible; this surface is purely
// for discoverability.
import {
  Box,
  Button,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import DeleteIcon from "@mui/icons-material/Delete";
import ArchiveIcon from "@mui/icons-material/Archive";
import EditIcon from "@mui/icons-material/Edit";
import CloseIcon from "@mui/icons-material/Close";

interface Props {
  count: number;
  onCopy?: () => void;
  onCut?: () => void;
  onDelete?: () => void;
  onCompress?: () => void;
  onBulkRename?: () => void;
  onClear?: () => void;
}

export default function BulkActionBar({
  count,
  onCopy,
  onCut,
  onDelete,
  onCompress,
  onBulkRename,
  onClear,
}: Props) {
  if (count < 2) return null;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 2,
        py: 0.5,
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: (t) =>
          t.palette.mode === "dark"
            ? "rgba(144, 202, 249, 0.08)"
            : "rgba(25, 118, 210, 0.06)",
      }}
    >
      <Typography variant="body2" sx={{ flex: 1, color: "text.secondary" }}>
        {count} selected
      </Typography>
      {onCopy && (
        <Button
          size="small"
          startIcon={<ContentCopyIcon fontSize="small" />}
          onClick={onCopy}
        >
          Copy
        </Button>
      )}
      {onCut && (
        <Button
          size="small"
          startIcon={<ContentCutIcon fontSize="small" />}
          onClick={onCut}
        >
          Cut
        </Button>
      )}
      {onCompress && (
        <Button
          size="small"
          startIcon={<ArchiveIcon fontSize="small" />}
          onClick={onCompress}
        >
          Compress
        </Button>
      )}
      {onBulkRename && (
        <Button
          size="small"
          startIcon={<EditIcon fontSize="small" />}
          onClick={onBulkRename}
        >
          Rename
        </Button>
      )}
      {onDelete && (
        <Button
          size="small"
          color="error"
          startIcon={<DeleteIcon fontSize="small" />}
          onClick={onDelete}
        >
          Delete
        </Button>
      )}
      {onClear && (
        <Button
          size="small"
          color="inherit"
          startIcon={<CloseIcon fontSize="small" />}
          onClick={onClear}
        >
          Clear
        </Button>
      )}
    </Box>
  );
}
