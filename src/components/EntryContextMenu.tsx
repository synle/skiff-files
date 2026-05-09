// Right-click context menu for a FileList row. Pure presentation:
// the Browser owns the action handlers and the entry the menu acts
// on; this component just renders the menu at the click coordinates.
import {
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from "@mui/material";
import OpenIcon from "@mui/icons-material/FolderOpen";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import InfoIcon from "@mui/icons-material/Info";
import BookmarkIcon from "@mui/icons-material/BookmarkBorder";
import ArchiveIcon from "@mui/icons-material/Archive";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
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
  /** Extract a zip into a sibling folder. Only shown when the entry's
   *  basename ends in `.zip`. */
  onExtractZip: (entry: Entry) => void;
  /** Open the in-app archive viewer for the entry. Only shown for
   *  `.zip` files. */
  onViewArchive?: (entry: Entry) => void;
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
  onExtractZip,
  onViewArchive,
  comparePending = false,
}: Props) {
  const isRemote = state?.entry.path.startsWith("sftp://") ?? false;
  const open = state != null;
  /** Right-aligned shortcut hint for a menu item. Renders inside
   *  the MenuItem next to the ListItemText so the user sees
   *  "Rename… · F2". Tiny + monospace so it reads as a key, not a
   *  label. */
  const shortcut = (label: string) => (
    <Typography
      variant="caption"
      sx={{
        ml: 2,
        color: "text.disabled",
        fontFamily: "monospace",
        fontSize: "0.7rem",
        flexShrink: 0,
      }}
    >
      {label}
    </Typography>
  );
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
          {shortcut("Enter")}
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
          {shortcut("Mid-click")}
        </MenuItem>
      )}
      {!isRemote && state?.entry.isDir && (
        <MenuItem
          onClick={() => {
            // Spawn a fresh top-level window seeded at this folder.
            // Routes through window_open_at, which encodes the path
            // into the URL fragment so the new BrowserTabs picks it
            // up at boot. Hidden for remotes since the new window
            // would also need the SFTP connection registry, and
            // we don't yet round-trip connection state to a freshly
            // spawned window.
            void import("../api/fs").then(({ windowOpenAt }) =>
              windowOpenAt(state!.entry.path).catch(() => {}),
            );
            onClose();
          }}
        >
          <ListItemIcon>
            <LaunchIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Open in new window</ListItemText>
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
        {shortcut("F2")}
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
      {/* Power-user copy variants. These bypass the onCopyPath
       *  callback because they're pure string transforms — no need
       *  to round-trip through Browser. Best-effort: silently no-op
       *  when navigator.clipboard isn't available. */}
      <MenuItem
        onClick={() => {
          if (state && navigator?.clipboard) {
            void navigator.clipboard.writeText(state.entry.name);
          }
          onClose();
        }}
      >
        <ListItemIcon>
          <ContentCopyIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>Copy filename</ListItemText>
      </MenuItem>
      <MenuItem
        onClick={() => {
          if (state && navigator?.clipboard) {
            // Strip the basename to get the parent directory. Works
            // for both forward and backward slashes.
            const path = state.entry.path;
            const lastSep = Math.max(
              path.lastIndexOf("/"),
              path.lastIndexOf("\\"),
            );
            const parent = lastSep > 0 ? path.slice(0, lastSep) : path;
            void navigator.clipboard.writeText(parent);
          }
          onClose();
        }}
      >
        <ListItemIcon>
          <ContentCopyIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>Copy parent path</ListItemText>
      </MenuItem>
      {!isRemote && (
        <MenuItem
          onClick={() => {
            if (state && navigator?.clipboard) {
              // file:// URI for the entry. Encode each path segment
              // (preserves Unicode + spaces) but keep the slashes.
              const segs = state.entry.path.split("/").map((s) =>
                s ? encodeURIComponent(s) : s,
              );
              void navigator.clipboard.writeText(`file://${segs.join("/")}`);
            }
            onClose();
          }}
        >
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Copy as file:// URI</ListItemText>
        </MenuItem>
      )}
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
      {!isRemote && state && state.entry.name.toLowerCase().endsWith(".zip") && (
        <MenuItem
          onClick={() => {
            onExtractZip(state.entry);
            onClose();
          }}
        >
          <ListItemIcon>
            <UnarchiveIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Extract here</ListItemText>
        </MenuItem>
      )}
      {!isRemote &&
        state &&
        onViewArchive &&
        (() => {
          const lower = state.entry.name.toLowerCase();
          return (
            lower.endsWith(".zip") ||
            lower.endsWith(".tar") ||
            lower.endsWith(".tar.gz") ||
            lower.endsWith(".tgz")
          );
        })() && (
          <MenuItem
            onClick={() => {
              onViewArchive(state.entry);
              onClose();
            }}
          >
            <ListItemIcon>
              <ArchiveIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>View contents</ListItemText>
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
        {shortcut("Del")}
      </MenuItem>
    </Menu>
  );
}
