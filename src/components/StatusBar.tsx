// Bottom status strip — selection count + total size. Free-space / transfer
// status get added when the Skiffsync engine lands in Phase 4.
import { Box, Typography } from "@mui/material";
import { formatBytes } from "../util/format";

interface Props {
  totalEntries: number;
  selectedEntries: number;
  selectedSize: number;
  errorMessage?: string | null;
  /** Optional disk-space readout for the current path's filesystem.
   *  When provided, renders alongside the selection summary as
   *  "X free of Y". Local paths only — remotes pass `null`. */
  diskFree?: number | null;
  diskTotal?: number | null;
}

export default function StatusBar({
  totalEntries,
  selectedEntries,
  selectedSize,
  errorMessage,
  diskFree,
  diskTotal,
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
        }}
        role="status"
      >
        <Typography variant="caption">{errorMessage}</Typography>
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
          ? `${selectedEntries} of ${totalEntries} selected · ${formatBytes(selectedSize)}`
          : `${totalEntries} item${totalEntries === 1 ? "" : "s"}`}
      </Typography>
      {diskFree != null && diskTotal != null && (
        <Typography variant="caption" color="text.secondary">
          · {formatBytes(diskFree)} free of {formatBytes(diskTotal)}
        </Typography>
      )}
    </Box>
  );
}
