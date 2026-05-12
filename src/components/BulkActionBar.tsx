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
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import DeleteIcon from "@mui/icons-material/Delete";
import ArchiveIcon from "@mui/icons-material/Archive";
import EditIcon from "@mui/icons-material/Edit";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import SaveIcon from "@mui/icons-material/Save";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import ClearIcon from "@mui/icons-material/Clear";
import { useState } from "react";
import { TAG_COLORS, tagColorHex, tagColorLabel } from "../util/tagColors";
import type { TagColor } from "../state/settings";

interface Props {
  count: number;
  onNewFolder?: () => void;
  onNewFile?: () => void;
  /** When set, the action bar renders a leading "Paste N items"
   *  button. Mirrors the right-click empty-area menu option but
   *  surfaces it in the always-visible action bar so the
   *  clipboard-with-pending-items state is discoverable without
   *  the user having to right-click. Hide by leaving undefined or
   *  passing 0. */
  pasteCount?: number;
  onPaste?: () => void;
  /** Clear the current multi-selection. Surfaces a Clear button
   *  next to New file whenever 1+ rows are picked. Re-added in
   *  0.2.256 after 0.2.253 dropped it — outside-row click is still
   *  a clear path, but a discoverable button is friendlier. */
  onClearSelection?: () => void;
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

/** Per-button sx tightening the icon → label gap. The default
 *  MUI startIcon margin is 8px which eats horizontal space we
 *  need for the full button row (especially with Clear back in
 *  the mix). */
const TIGHT_ICON_SX = {
  "& .MuiButton-startIcon": { mr: 0.5 /* 4px */ },
};

export default function BulkActionBar({
  count,
  onNewFolder,
  onNewFile,
  pasteCount,
  onPaste,
  onClearSelection,
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
  const hasSelection = count >= 1;
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
      {/* Paste goes FIRST so it's the leftmost affordance whenever
          there's a non-empty file clipboard. Mirrors the right-click
          empty-area menu item's wording so the two surfaces stay
          recognizable as the same action. Hidden when the clipboard
          is empty so it doesn't take up bar real estate during
          normal browsing. */}
      {pasteCount != null && pasteCount > 0 && onPaste && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<ContentPasteIcon fontSize="small" />}
          onClick={onPaste}
          sx={TIGHT_ICON_SX}
        >
          Paste {pasteCount} item{pasteCount === 1 ? "" : "s"}
        </Button>
      )}
      {onNewFolder && (
        <Button
          size="small"
          startIcon={<CreateNewFolderIcon fontSize="small" />}
          onClick={onNewFolder}
          sx={TIGHT_ICON_SX}
        >
          New folder
        </Button>
      )}
      {onNewFile && (
        <Button
          size="small"
          startIcon={<NoteAddIcon fontSize="small" />}
          onClick={onNewFile}
          sx={TIGHT_ICON_SX}
        >
          New file
        </Button>
      )}
      {hasSelection && onClearSelection && (
        <Button
          size="small"
          startIcon={<ClearIcon fontSize="small" />}
          onClick={onClearSelection}
          sx={TIGHT_ICON_SX}
        >
          Clear
        </Button>
      )}
      <Box sx={{ flex: 1 }} />
      {hasMultiSelection && onCopy && (
        <Button
          size="small"
          startIcon={<ContentCopyIcon fontSize="small" />}
          onClick={onCopy}
          sx={TIGHT_ICON_SX}
        >
          Copy
        </Button>
      )}
      {hasMultiSelection && onCut && (
        <Button
          size="small"
          startIcon={<ContentCutIcon fontSize="small" />}
          onClick={onCut}
          sx={TIGHT_ICON_SX}
        >
          Cut
        </Button>
      )}
      {hasMultiSelection && onCompress && (
        <Button
          size="small"
          startIcon={<ArchiveIcon fontSize="small" />}
          onClick={onCompress}
          sx={TIGHT_ICON_SX}
        >
          Compress
        </Button>
      )}
      {hasMultiSelection && onBulkRename && (
        <Button
          size="small"
          startIcon={<EditIcon fontSize="small" />}
          onClick={onBulkRename}
          sx={TIGHT_ICON_SX}
        >
          Rename
        </Button>
      )}
      {hasMultiSelection && onSaveSelectionGroup && (
        <Button
          size="small"
          startIcon={<SaveIcon fontSize="small" />}
          onClick={onSaveSelectionGroup}
          sx={TIGHT_ICON_SX}
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
            sx={TIGHT_ICON_SX}
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
          sx={TIGHT_ICON_SX}
        >
          Delete
        </Button>
      )}
    </Box>
  );
}
