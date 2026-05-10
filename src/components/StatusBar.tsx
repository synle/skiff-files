// Bottom status strip — selection count + total size. Free-space / transfer
// status get added when the Skiffsync engine lands in Phase 4.
import { Box, IconButton, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { formatBytes } from "../util/format";

interface Props {
  totalEntries: number;
  /** Folder + file split. When both > 0 the status bar shows
   *  "F folders, G files" instead of the flat "N items" — a
   *  Finder-style hint about what's in the current directory. */
  folderCount?: number;
  fileCount?: number;
  selectedEntries: number;
  selectedSize: number;
  errorMessage?: string | null;
  /** When provided, renders an inline × on the error pill that
   *  invokes this. Lets the user clear a dismissable error
   *  (e.g. "Remote trash is not supported yet.") without having
   *  to navigate away. */
  onDismissError?: () => void;
  /** Optional disk-space readout for the current path's filesystem.
   *  When provided, renders alongside the selection summary as
   *  "X free of Y". Local paths only — remotes pass `null`. */
  diskFree?: number | null;
  diskTotal?: number | null;
  /** When true, the active listing is the recursive-find result set.
   *  Status text switches to "N matches" (or "N+ matches" when the
   *  result count hit the engine's hard cap of 1000). */
  findActive?: boolean;
  findHitCap?: boolean;
  /** When non-null, surfaces a hint about the file clipboard so users
   *  can see what'll happen on Cmd+V. `op` matches `FileClipboardOperation`. */
  clipboardHint?: { count: number; op: "copy" | "cut" } | null;
  /** Name of the single-selected entry. When provided + selectedEntries
   *  === 1, surfaces in the status bar so the user has a textual
   *  confirmation of what's selected (especially useful when the row
   *  highlight scrolls out of view). */
  selectedName?: string | null;
  /** Number of currently-visible entries that have a Finder-style
   *  color tag. Surfaces as "(N tagged)" alongside the selection
   *  summary so users see tag distribution at a glance.  */
  taggedCount?: number;
}

export default function StatusBar({
  totalEntries,
  folderCount,
  fileCount,
  selectedEntries,
  selectedSize,
  errorMessage,
  onDismissError,
  diskFree,
  diskTotal,
  findActive = false,
  findHitCap = false,
  clipboardHint = null,
  selectedName = null,
  taggedCount = 0,
}: Props) {
  // Errors take precedence — a directory listing error matters more than the
  // empty-selection summary it would otherwise render alongside.
  if (errorMessage) {
    return (
      <Box
        sx={{
          px: 2,
          py: 0.5,
          borderTop: 1,
          borderColor: "divider",
          bgcolor: "error.main",
          color: "error.contrastText",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
        role="status"
      >
        <Typography variant="caption" sx={{ flex: 1 }}>
          {errorMessage}
        </Typography>
        {onDismissError && (
          <IconButton
            size="small"
            onClick={onDismissError}
            aria-label="Dismiss error"
            sx={{ color: "inherit", p: 0.25 }}
          >
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        )}
      </Box>
    );
  }
  return (
    <Box
      sx={{
        px: 2,
        py: 0.5,
        borderTop: 1,
        borderColor: "divider",
        display: "flex",
        gap: 2,
      }}
      role="status"
    >
      <Typography variant="caption" color="text.secondary">
        {selectedEntries > 0
          ? selectedEntries === 1 && selectedName
            ? `${selectedName} · ${formatBytes(selectedSize)}`
            : `${selectedEntries} of ${totalEntries} selected · ${formatBytes(selectedSize)}`
          : findActive
            ? `${totalEntries}${findHitCap ? "+" : ""} match${totalEntries === 1 ? "" : "es"}`
            : folderCount != null &&
                fileCount != null &&
                folderCount > 0 &&
                fileCount > 0
              ? `${folderCount} folder${folderCount === 1 ? "" : "s"}, ${fileCount} file${fileCount === 1 ? "" : "s"}`
              : `${totalEntries} item${totalEntries === 1 ? "" : "s"}`}
      </Typography>
      {diskFree != null && diskTotal != null && (
        <Typography variant="caption" color="text.secondary">
          · {formatBytes(diskFree)} free of {formatBytes(diskTotal)}
        </Typography>
      )}
      {taggedCount > 0 && (
        <Typography variant="caption" color="text.secondary">
          · {taggedCount} tagged
        </Typography>
      )}
      {clipboardHint && clipboardHint.count > 0 && (
        <Typography variant="caption" color="text.secondary">
          · {clipboardHint.count} item{clipboardHint.count === 1 ? "" : "s"}{" "}
          ready to {clipboardHint.op === "cut" ? "move" : "paste"}
        </Typography>
      )}
    </Box>
  );
}
