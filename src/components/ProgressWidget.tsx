// Unified progress widget. Used by:
//   - TransfersPage (per-row, inline)
//   - the global Operations drawer (when a delete / paste / sync is in
//     flight and the user has navigated away from the page that started it)
//   - any future long-running operation
//
// Spec is intentionally narrow: take everything as props, render a
// determinate / indeterminate bar + files counter + ETA + current
// item + pause/cancel. Don't own state; the consumer is responsible
// for tracking samples (see useEtaTracker).
import {
  Box,
  IconButton,
  LinearProgress,
  Tooltip,
  Typography,
} from "@mui/material";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import { formatBytes } from "../util/format";
import { formatCompletionTime, formatEtaSeconds } from "../util/etaTracker";

export interface ProgressWidgetProps {
  /** Headline label shown above the bar (e.g. "Copy to /Volumes/Backup"). */
  label: string;
  filesDone: number;
  filesTotal: number;
  bytesDone?: number;
  bytesTotal?: number;
  /** The file currently being processed — shown below the bar so the
   *  user knows the job hasn't stalled. */
  currentItem?: string;
  /** Seconds remaining; pass `null` while the rolling window primes. */
  etaSeconds?: number | null;
  /** Bytes-per-second over the rolling window; shown next to the ETA. */
  bytesPerSec?: number | null;
  paused?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  /** Compact form — used when embedded in a list row. Default false. */
  dense?: boolean;
  /** Error to surface inline (red) — e.g. job failed mid-flight. */
  error?: string | null;
}

export default function ProgressWidget({
  label,
  filesDone,
  filesTotal,
  bytesDone,
  bytesTotal,
  currentItem,
  etaSeconds,
  bytesPerSec,
  paused,
  onPause,
  onResume,
  onCancel,
  dense,
  error,
}: ProgressWidgetProps) {
  const pct =
    bytesTotal != null && bytesTotal > 0 && bytesDone != null
      ? Math.min(100, Math.round((bytesDone / bytesTotal) * 100))
      : null;

  const showBar = pct != null;
  const indeterminate = !showBar;

  // ETA / completion-time line. Show "Calculating…" while the window
  // is priming so the user knows the placeholder is not the real value.
  let etaLine: string | null = null;
  if (filesTotal === 0) {
    etaLine = null;
  } else if (etaSeconds == null) {
    etaLine = "Calculating ETA…";
  } else {
    const rate =
      bytesPerSec != null && bytesPerSec > 0
        ? ` · ${formatBytes(bytesPerSec)}/s`
        : "";
    etaLine = `${formatEtaSeconds(etaSeconds)} remaining · done at ${formatCompletionTime(etaSeconds)}${rate}`;
  }

  return (
    <Box sx={{ width: "100%" }}>
      <Box
        sx={{ mb: 0.5, display: "flex", alignItems: "center", gap: 1 }}
      >
        <Typography
          variant={dense ? "body2" : "subtitle2"}
          sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {label}
        </Typography>
        {(onPause || onResume) && (
          <Tooltip title={paused ? "Resume" : "Pause"}>
            <span>
              <IconButton
                size="small"
                onClick={paused ? onResume : onPause}
                aria-label={paused ? "Resume" : "Pause"}
              >
                {paused ? <PlayArrowIcon fontSize="small" /> : <PauseIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        )}
        {onCancel && (
          <Tooltip title="Cancel">
            <span>
              <IconButton
                size="small"
                onClick={onCancel}
                aria-label="Cancel"
              >
                <StopIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>

      <LinearProgress
        variant={indeterminate ? "indeterminate" : "determinate"}
        value={pct ?? 0}
        sx={{ height: dense ? 4 : 6, borderRadius: 1 }}
      />

      <Box
        sx={{ mt: 0.5, color: "text.secondary", display: "flex", gap: 2 }}
      >
        <Typography variant="caption" sx={{ flexShrink: 0 }}>
          {filesDone} of {filesTotal} files
          {bytesTotal != null && bytesTotal > 0 && bytesDone != null
            ? ` · ${formatBytes(bytesDone)} of ${formatBytes(bytesTotal)}`
            : ""}
          {pct != null ? ` · ${pct}%` : ""}
        </Typography>
        {etaLine && (
          <Typography
            variant="caption"
            sx={{ flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {paused ? "Paused" : etaLine}
          </Typography>
        )}
      </Box>

      {currentItem && (
        <Typography
          variant="caption"
          sx={{
            display: "block",
            mt: 0.25,
            color: "text.secondary",
            fontFamily: "monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {currentItem}
        </Typography>
      )}

      {error && (
        <Typography variant="caption" color="error" sx={{ display: "block", mt: 0.25 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
