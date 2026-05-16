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
import ContentCutIcon from "@mui/icons-material/ContentCut";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import LinkIcon from "@mui/icons-material/Link";
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
import CircleIcon from "@mui/icons-material/Circle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import type { Entry } from "../api/fs";
import type { TagColor } from "../state/settings";
import { TAG_COLORS, tagColorHex, tagColorLabel } from "../util/tagColors";

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
  /** Currently-applied tag color (or null = untagged). Drives the
   *  selection indicator in the Tag submenu. */
  currentTag?: TagColor | null;
  /** Set or clear a tag on the entry. `null` clears. */
  onSetTag?: (entry: Entry, color: TagColor | null) => void;
  /** Mark the current selection for a copy paste. Same semantics as
   *  the toolbar's Copy button — populates the file clipboard. */
  onCutToClipboard?: (entry: Entry) => void;
  /** Mark the current selection for a cut paste. Same semantics as
   *  the toolbar's Cut button. */
  onCopyToClipboard?: (entry: Entry) => void;
  /** Paste the file clipboard contents into the entry's parent
   *  folder. Only rendered when [[pasteCount]] > 0. */
  onPaste?: () => void;
  /** Count of entries waiting in the file clipboard. Drives whether
   *  the Paste row renders at all (hidden when nothing's queued so
   *  the menu doesn't grow a dead row) and the label suffix
   *  ("Paste 2 items"). */
  pasteCount?: number;
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
  currentTag = null,
  onSetTag,
  onCutToClipboard,
  onCopyToClipboard,
  onPaste,
  pasteCount = 0,
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
            void import("../api/fs")
              .then(({ windowOpenAt }) =>
                windowOpenAt(state!.entry.path).catch(() => {}),
              )
              .catch(() => {
                /* dynamic import failure — best effort, ignore */
              });
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
      {/* Separator before the rename / cut / copy / paste cluster —
          visually splits "open / reveal" from "edit / clipboard"
          actions. Bug 8 (0.2.280). */}
      <Divider />
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
      {onCutToClipboard && state && (
        <MenuItem
          onClick={() => {
            onCutToClipboard(state.entry);
            onClose();
          }}
        >
          <ListItemIcon>
            <ContentCutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Cut</ListItemText>
          {shortcut("⌘X")}
        </MenuItem>
      )}
      {onCopyToClipboard && state && (
        <MenuItem
          onClick={() => {
            onCopyToClipboard(state.entry);
            onClose();
          }}
        >
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Copy</ListItemText>
          {shortcut("⌘C")}
        </MenuItem>
      )}
      {/* Paste only renders when there's something queued in the file
       *  clipboard. Mirrors the toolbar's "Paste N items" pill. The
       *  paste lands in the entry's parent folder; Browser owns the
       *  resolution. */}
      {onPaste && pasteCount > 0 && (
        <MenuItem
          onClick={() => {
            onPaste();
            onClose();
          }}
        >
          <ListItemIcon>
            <ContentPasteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {`Paste ${pasteCount} item${pasteCount === 1 ? "" : "s"}`}
          </ListItemText>
          {shortcut("⌘V")}
        </MenuItem>
      )}
      {/* Separator before the "copy as text" power-user cluster.
       *  These are pure string-to-clipboard ops, distinct from the
       *  real file-clipboard Copy above. Bug 8 (0.2.280) — earlier
       *  shape rendered Copy path / Copy filename / etc. with the
       *  same ContentCopy icon as the real Copy action, which the
       *  user kept misreading as duplicates. Icons swapped: path =
       *  link (it IS a URL-ish reference), filename = text label,
       *  parent path = folder. */}
      <Divider />
      <MenuItem
        onClick={() => {
          if (state) onCopyPath(state.entry);
          onClose();
        }}
      >
        <ListItemIcon>
          <LinkIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>Copy path</ListItemText>
      </MenuItem>
      <MenuItem
        onClick={() => {
          if (state && navigator?.clipboard) {
            void navigator.clipboard.writeText(state.entry.name);
          }
          onClose();
        }}
      >
        <ListItemIcon>
          <LinkIcon fontSize="small" />
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
          <LinkIcon fontSize="small" />
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
            <LinkIcon fontSize="small" />
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
            lower.endsWith(".tgz") ||
            lower.endsWith(".7z")
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
      {onSetTag && state && (
        <MenuItem
          // Disable the built-in highlight/click — this row is a
          // container for the color dots, not a single action.
          disableRipple
          sx={{ "&:hover": { backgroundColor: "transparent" } }}
        >
          <ListItemIcon>
            <CircleIcon
              fontSize="small"
              sx={{
                color: currentTag ? tagColorHex(currentTag) : "text.disabled",
              }}
            />
          </ListItemIcon>
          <ListItemText sx={{ mr: 1 }}>Tag</ListItemText>
          {/* Colored-dot strip: clicking sets that tag. The active tag
              renders with a primary-tinted ring so the current state
              is glanceable. */}
          {TAG_COLORS.map((c) => (
            <span
              key={c}
              role="button"
              aria-label={`Tag ${tagColorLabel(c)}`}
              title={tagColorLabel(c)}
              onClick={(e) => {
                e.stopPropagation();
                onSetTag(state.entry, c);
                onClose();
              }}
              style={{
                display: "inline-block",
                width: 14,
                height: 14,
                borderRadius: "50%",
                margin: "0 2px",
                cursor: "pointer",
                backgroundColor: tagColorHex(c),
                outline: c === currentTag ? "2px solid #1976d2" : "none",
                outlineOffset: 1,
              }}
            />
          ))}
          {currentTag && (
            <span
              role="button"
              aria-label="Clear tag"
              title="Clear tag"
              onClick={(e) => {
                e.stopPropagation();
                onSetTag(state.entry, null);
                onClose();
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                marginLeft: 6,
                cursor: "pointer",
              }}
            >
              <RadioButtonUncheckedIcon fontSize="small" />
            </span>
          )}
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
