// Right-click context menu for a FileList row. Pure presentation:
// the Browser owns the action handlers and the entry the menu acts
// on; this component just renders the menu at the click coordinates.
import {
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from "@mui/material";
import OpenIcon from "@mui/icons-material/FolderOpen";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import InfoIcon from "@mui/icons-material/Info";
import type { Entry } from "../api/fs";

interface Props {
  /** Anchor point + entry — `null` when the menu is closed. */
  state: { entry: Entry; x: number; y: number } | null;
  onClose: () => void;
  onOpen: (entry: Entry) => void;
  onRename: (entry: Entry) => void;
  onTrash: (entry: Entry) => void;
  onCopyPath: (entry: Entry) => void;
  onProperties: (entry: Entry) => void;
}

export default function EntryContextMenu({
  state,
  onClose,
  onOpen,
  onRename,
  onTrash,
  onCopyPath,
  onProperties,
}: Props) {
  const open = state != null;
  return (
    <Menu
      open={open}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={
        open ? { top: state!.y, left: state!.x } : undefined
      }
      slotProps={{ list: { dense: true } }}
    >
      {state?.entry.isDir && (
        <MenuItem
          onClick={() => {
            onOpen(state!.entry);
            onClose();
          }}
        >
          <ListItemIcon>
            <OpenIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Open</ListItemText>
        </MenuItem>
      )}
      <MenuItem
        onClick={() => {
          if (state) onRename(state.entry);
          onClose();
        }}
      >
        <ListItemIcon>
          <EditIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>Rename…</ListItemText>
      </MenuItem>
      <MenuItem
        onClick={() => {
          if (state) onCopyPath(state.entry);
          onClose();
        }}
      >
        <ListItemIcon>
          <ContentCopyIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>Copy path</ListItemText>
      </MenuItem>
      <MenuItem
        onClick={() => {
          if (state) onProperties(state.entry);
          onClose();
        }}
      >
        <ListItemIcon>
          <InfoIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>Properties…</ListItemText>
      </MenuItem>
      <Divider />
      <MenuItem
        onClick={() => {
          if (state) onTrash(state.entry);
          onClose();
        }}
      >
        <ListItemIcon>
          <DeleteIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>Move to Trash</ListItemText>
      </MenuItem>
    </Menu>
  );
}
