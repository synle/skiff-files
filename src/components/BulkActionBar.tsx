// Always-visible action bar that sits between the Toolbar and the
// FileList. The left cluster (New folder / New file) is always shown
// so the bar height stays stable as the selection grows / shrinks
// (an earlier "X selected ... CLEAR" prefix caused jumpy reflow
// when toggling selection). Selection-scoped actions appear on the
// right only when 2+ rows are selected — single-select keeps the
// right-click menu as its primary surface, the multi-select cluster
// here is purely for discoverability of the bulk verbs.
//
// All actions are also keyboard-accessible; this surface is purely
// for discoverability.
import {
  Box,
  Button,
  Menu,
  MenuItem,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import DeleteIcon from "@mui/icons-material/Delete";
import ArchiveIcon from "@mui/icons-material/Archive";
import EditIcon from "@mui/icons-material/Edit";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import SaveIcon from "@mui/icons-material/Save";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import { useState } from "react";
import { TAG_COLORS, tagColorHex, tagColorLabel } from "../util/tagColors";
import type { TagColor } from "../state/settings";

interface Props {
  count: number;
  onNewFolder?: () => void;
  onNewFile?: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onDelete?: () => void;
  onCompress?: () => void;
  onBulkRename?: () => void;
  /** Apply the picked tag (or `null` to clear) to the current
   *  multi-selection. Drives the Tag popover's color strip. */
  onSetTag?: (color: TagColor | null) => void;
  /** Save the current selection as a named group. Caller prompts
   *  for the name. */
  onSaveSelectionGroup?: () => void;
}

export default function BulkActionBar({
  count,
  onNewFolder,
  onNewFile,
  onCopy,
  onCut,
  onDelete,
  onCompress,
  onBulkRename,
  onSetTag,
  onSaveSelectionGroup,
}: Props) {
  const [tagAnchor, setTagAnchor] = useState<HTMLElement | null>(null);
  const hasMultiSelection = count >= 2;
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
      {onNewFolder && (
        <Button
          size="small"
          startIcon={<CreateNewFolderIcon fontSize="small" />}
          onClick={onNewFolder}
        >
          New folder
        </Button>
      )}
      {onNewFile && (
        <Button
          size="small"
          startIcon={<NoteAddIcon fontSize="small" />}
          onClick={onNewFile}
        >
          New file
        </Button>
      )}
      <Box sx={{ flex: 1 }} />
      {hasMultiSelection && onCopy && (
        <Button
          size="small"
          startIcon={<ContentCopyIcon fontSize="small" />}
          onClick={onCopy}
        >
          Copy
        </Button>
      )}
      {hasMultiSelection && onCut && (
        <Button
          size="small"
          startIcon={<ContentCutIcon fontSize="small" />}
          onClick={onCut}
        >
          Cut
        </Button>
      )}
      {hasMultiSelection && onCompress && (
        <Button
          size="small"
          startIcon={<ArchiveIcon fontSize="small" />}
          onClick={onCompress}
        >
          Compress
        </Button>
      )}
      {hasMultiSelection && onBulkRename && (
        <Button
          size="small"
          startIcon={<EditIcon fontSize="small" />}
          onClick={onBulkRename}
        >
          Rename
        </Button>
      )}
      {hasMultiSelection && onSaveSelectionGroup && (
        <Button
          size="small"
          startIcon={<SaveIcon fontSize="small" />}
          onClick={onSaveSelectionGroup}
        >
          Save group
        </Button>
      )}
      {hasMultiSelection && onSetTag && (
        <>
          <Button
            size="small"
            startIcon={<LocalOfferIcon fontSize="small" />}
            onClick={(e) => setTagAnchor(e.currentTarget)}
          >
            Tag
          </Button>
          <Menu
            open={tagAnchor != null}
            anchorEl={tagAnchor}
            onClose={() => setTagAnchor(null)}
            slotProps={{ list: { dense: true } }}
          >
            {TAG_COLORS.map((c) => (
              <MenuItem
                key={c}
                onClick={() => {
                  onSetTag(c);
                  setTagAnchor(null);
                }}
                sx={{ display: "flex", gap: 1, alignItems: "center" }}
              >
                <Box
                  component="span"
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    backgroundColor: tagColorHex(c),
                  }}
                />
                {tagColorLabel(c)}
              </MenuItem>
            ))}
            <MenuItem
              onClick={() => {
                onSetTag(null);
                setTagAnchor(null);
              }}
            >
              Clear tag
            </MenuItem>
          </Menu>
        </>
      )}
      {hasMultiSelection && onDelete && (
        <Button
          size="small"
          color="error"
          startIcon={<DeleteIcon fontSize="small" />}
          onClick={onDelete}
        >
          Delete
        </Button>
      )}
    </Box>
  );
}
