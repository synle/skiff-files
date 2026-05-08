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
import BookmarkIcon from "@mui/icons-material/BookmarkBorder";
import ArchiveIcon from "@mui/icons-material/Archive";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import ContentCopyTwoToneIcon from "@mui/icons-material/ContentCopyTwoTone";
import LaunchIcon from "@mui/icons-material/Launch";
import TabIcon from "@mui/icons-material/Tab";
import TerminalIcon from "@mui/icons-material/Terminal";
import VisibilityIcon from "@mui/icons-material/Visibility";
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
  /** Only invoked for directories (the bookmark item is hidden for
   *  files since "bookmark a file" doesn't have a clear meaning in
   *  this app). */
  onBookmark: (entry: Entry) => void;
  /** Open with the OS default application. Hidden for remote entries
   *  since the local OS can't open them directly without download. */
  onOpenWithDefault: (entry: Entry) => void;
  /** Reveal in the OS file manager. Same remote restriction. */
  onRevealInOs: (entry: Entry) => void;
  /** Open the OS terminal at this directory. Only shown for local
   *  folders — remote / file entries hide the action. */
  onOpenInTerminal: (entry: Entry) => void;
  /** Open the directory in a new tab. Only shown for folders — files
   *  open into the preview pane / OS app and don't have a tab concept. */
  onOpenInNewTab: (entry: Entry) => void;
  /** Duplicate the entry in the same folder, suffixing the name with
   *  " (copy)". Folders deep-copy. Hidden for remote (`sftp://`)
   *  entries because the engine flow is the same as Skiffsync —
   *  routes through `startSync`. */
  onDuplicate: (entry: Entry) => void;
  /** Compress the entry (and any other entries in the multi-selection)
   *  into a sibling zip file. Hidden for remote entries. */
  onCompressZip: (entry: Entry) => void;
  /** Start a diff against this file. The first call sets the "base"
   *  side; the second call (from another row's right-click) opens
   *  the DiffDialog. Hidden for directories. */
  onCompareWith: (entry: Entry) => void;
  /** True when a base file is already pending. Drives the menu label
   *  ("Compare with this file" instead of "Compare with…"). */
  comparePending?: boolean;
}

export default function EntryContextMenu({
  state,
  onClose,
  onOpen,
  onRename,
  onTrash,
  onCopyPath,
  onProperties,
  onBookmark,
  onOpenWithDefault,
  onRevealInOs,
  onOpenInTerminal,
  onOpenInNewTab,
  onCompareWith,
  onDuplicate,
  onCompressZip,
  comparePending = false,
}: Props) {
  const isRemote = state?.entry.path.startsWith("sftp://") ?? false;
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
      {state?.entry.isDir && (
        <MenuItem
          onClick={() => {
            onOpenInNewTab(state!.entry);
            onClose();
          }}
        >
          <ListItemIcon>
            <TabIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Open in new tab</ListItemText>
        </MenuItem>
      )}
      {!isRemote && state && !state.entry.isDir && (
        <MenuItem
          onClick={() => {
            onOpenWithDefault(state.entry);
            onClose();
          }}
        >
          <ListItemIcon>
            <LaunchIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Open with default app</ListItemText>
        </MenuItem>
      )}
      {!isRemote && state && (
        <MenuItem
          onClick={() => {
            onRevealInOs(state.entry);
            onClose();
          }}
        >
          <ListItemIcon>
            <VisibilityIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Reveal in OS</ListItemText>
        </MenuItem>
      )}
      {!isRemote && state?.entry.isDir && (
        <MenuItem
          onClick={() => {
            onOpenInTerminal(state.entry);
            onClose();
          }}
        >
          <ListItemIcon>
            <TerminalIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Open in terminal</ListItemText>
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
      {!isRemote && state && (
        <MenuItem
          onClick={() => {
            onDuplicate(state.entry);
            onClose();
          }}
        >
          <ListItemIcon>
            <ContentCopyTwoToneIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Duplicate</ListItemText>
        </MenuItem>
      )}
      {!isRemote && state && (
        <MenuItem
          onClick={() => {
            onCompressZip(state.entry);
            onClose();
          }}
        >
          <ListItemIcon>
            <ArchiveIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Compress to zip</ListItemText>
        </MenuItem>
      )}
      {state && !state.entry.isDir && (
        <MenuItem
          onClick={() => {
            onCompareWith(state.entry);
            onClose();
          }}
        >
          <ListItemIcon>
            <CompareArrowsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {comparePending ? "Compare with this file" : "Compare with…"}
          </ListItemText>
        </MenuItem>
      )}
      {state?.entry.isDir && (
        <MenuItem
          onClick={() => {
            if (state) onBookmark(state.entry);
            onClose();
          }}
        >
          <ListItemIcon>
            <BookmarkIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Add to bookmarks</ListItemText>
        </MenuItem>
      )}
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
