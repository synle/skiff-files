// Replaces the FileList grid when the current folder failed to load —
// broken pipe / bad credentials / disconnected remote / unreachable
// host. The previous shape rendered an "Empty folder" line inside a
// full-chrome FileList header, which read as "this folder is
// genuinely empty" rather than "the connection is broken". Combined
// with the Toolbar's `disabled` collapse, the user sees only the
// back / forward / up / refresh navigation cluster while a
// connection is unreachable.
import { Box, Button, Stack, Typography } from "@mui/material";
import CloudOffIcon from "@mui/icons-material/CloudOff";
import RefreshIcon from "@mui/icons-material/Refresh";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";

interface Props {
  /** The folder path the failed listing targeted. Surfaces in the
   *  body copy so the user can confirm which connection broke. */
  path: string;
  /** Underlying error message from the failed `list_dir`. We render
   *  it verbatim (with a small font) so users with the technical
   *  context can read the cause without opening DevTools. */
  error: string;
  /** Retry the listing — the parent wires this to `refresh(path)`. */
  onRetry: () => void;
  /** Navigate up one folder — the parent's `goUp` handler. Hidden
   *  when there's nothing above (e.g. local root, remote root). */
  onUp?: () => void;
}

/** Friendly "we can't reach this folder" placeholder with Retry +
 *  Go up + the raw error message. Shown in place of the FileList
 *  grid so users don't mistake a broken connection for an empty
 *  folder. */
export default function UnreachableFolderPlaceholder({
  path,
  error,
  onRetry,
  onUp,
}: Props) {
  return (
    <Box
      role="alert"
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        p: 4,
        textAlign: "center",
        minHeight: 0,
      }}
    >
      <CloudOffIcon
        sx={{ fontSize: 64, color: "text.disabled" }}
        aria-hidden
      />
      <Typography variant="h6" component="h2">
        Can&rsquo;t reach this folder
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ maxWidth: 520, wordBreak: "break-all" }}
      >
        {path || "—"}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          maxWidth: 520,
          fontFamily: "monospace",
          color: "error.main",
          wordBreak: "break-word",
          p: 1,
          bgcolor: (t) =>
            t.palette.mode === "dark"
              ? "rgba(211, 47, 47, 0.08)"
              : "rgba(211, 47, 47, 0.06)",
          borderRadius: 1,
        }}
      >
        {error}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
        The connection may have dropped, credentials may have changed, or the
        host is unreachable. Use Refresh to retry, go up to the parent folder,
        or open Manage connections to update the saved credentials.
      </Typography>
      <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
        <Button
          variant="contained"
          startIcon={<RefreshIcon />}
          onClick={onRetry}
          aria-label="Retry connection"
        >
          Retry
        </Button>
        {onUp && (
          <Button
            variant="outlined"
            startIcon={<ArrowUpwardIcon />}
            onClick={onUp}
            aria-label="Go up to parent folder"
          >
            Go up
          </Button>
        )}
      </Stack>
    </Box>
  );
}
