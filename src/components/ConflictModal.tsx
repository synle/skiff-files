// TeraCopy-style "Destination File Already Exists" modal. Listens for
// the `sync:conflict` Tauri event; queues prompts so a job that hits
// many conflicts surfaces them one at a time without dropping any.
//
// Phase 0.1.7 ships the per-file action set (Overwrite / Skip / Keep
// both / Cancel job). The smart-batch row from the screenshot
// ("Overwrite all older files", etc.) is implementable today since
// those policies already exist in the engine — the UI just needs to
// dispatch a sync_resume + a policy change. That refinement lands in
// 0.1.8 once we have a way to update a running job's options.
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import {
  onConflict,
  syncResolveConflict,
  type ConflictPromptDecision,
  type ConflictPromptPayload,
} from "../api/sync";
import { formatBytes, formatMtime } from "../util/format";
import { useSettings } from "../state/settings";

/** Side-by-side metadata block. Shows the same fields TeraCopy does:
 *  size, mtime, with "Same date / Same size" badges when applicable. */
function MetaBlock({
  label,
  size,
  mtime,
}: {
  label: string;
  size: number;
  mtime: number | null;
}) {
  return (
    <Box
      sx={{
        flex: 1,
        p: 1.5,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
      }}
    >
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2">{formatBytes(size)}</Typography>
      <Typography variant="caption" color="text.secondary">
        {formatMtime(mtime)}
      </Typography>
    </Box>
  );
}

export default function ConflictModal() {
  /** FIFO queue — multiple conflicts can land on a busy job before the
   *  user clicks anything. Pop the head when each is resolved so the
   *  next one shows up automatically. */
  const [queue, setQueue] = useState<ConflictPromptPayload[]>([]);
  const { settings } = useSettings();
  // Mirror the suppress flag into a ref so the long-lived event
  // listener reads the latest value without us tearing down +
  // re-attaching on every settings tweak.
  const suppressRef = useRef(settings.syncSuppressConflictPrompts);
  useEffect(() => {
    suppressRef.current = settings.syncSuppressConflictPrompts;
  }, [settings.syncSuppressConflictPrompts]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void (async () => {
      unlisten = await onConflict((payload) => {
        if (suppressRef.current) {
          void syncResolveConflict(payload.jobId, payload.conflictId, "skip");
          return;
        }
        setQueue((prev) => [...prev, payload]);
      });
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  const head = queue[0];
  const close = () => setQueue((prev) => prev.slice(1));

  const decide = async (decision: ConflictPromptDecision) => {
    if (!head) return;
    try {
      await syncResolveConflict(head.jobId, head.conflictId, decision);
    } catch {
      // The hub no-ops on unknown ids, so we don't really expect
      // failures here — drop silently rather than blocking the UI.
    }
    close();
  };

  if (!head) return null;
  const sameSize = head.srcSize === head.destSize;
  const sameMtime =
    head.srcMtime != null &&
    head.destMtime != null &&
    head.srcMtime === head.destMtime;

  return (
    <Dialog
      open
      onClose={() => {
        /* don't close on backdrop click — force an explicit decision */
      }}
      maxWidth="sm"
      fullWidth
      aria-labelledby="conflict-title"
    >
      <DialogTitle id="conflict-title">Destination file already exists</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
            <code>{head.dest}</code>
          </Typography>

          <Stack direction="row" spacing={1.5}>
            <MetaBlock
              label="Source"
              size={head.srcSize}
              mtime={head.srcMtime}
            />
            <MetaBlock
              label="Destination"
              size={head.destSize}
              mtime={head.destMtime}
            />
          </Stack>

          {(sameSize || sameMtime) && (
            <Stack direction="row" spacing={1}>
              {sameSize && (
                <Typography
                  variant="caption"
                  sx={{
                    px: 1,
                    py: 0.25,
                    bgcolor: "action.selected",
                    borderRadius: 0.5,
                  }}
                >
                  Same size
                </Typography>
              )}
              {sameMtime && (
                <Typography
                  variant="caption"
                  sx={{
                    px: 1,
                    py: 0.25,
                    bgcolor: "action.selected",
                    borderRadius: 0.5,
                  }}
                >
                  Same date
                </Typography>
              )}
            </Stack>
          )}

          <Stack spacing={1.5}>
            {/* Per-file row */}
            <Stack
              direction="row"
              spacing={1}
              sx={{ flexWrap: "wrap" }}
              useFlexGap
            >
              <Button
                variant="contained"
                onClick={() => void decide("overwrite")}
              >
                Overwrite
              </Button>
              <Button variant="outlined" onClick={() => void decide("skip")}>
                Skip
              </Button>
              <Button
                variant="outlined"
                onClick={() => void decide("keepBoth")}
              >
                Keep both
              </Button>
              <Box sx={{ flex: 1 }} />
              <Button
                variant="text"
                color="error"
                onClick={() => void decide("cancelJob")}
              >
                Cancel job
              </Button>
            </Stack>

            {/* Apply-to-all row. Only shown when there's more than one
                conflict pending — for a single conflict, the "all"
                buttons would be misleading. */}
            {queue.length > 1 && (
              <>
                <Typography variant="caption" color="text.secondary">
                  Apply to all {queue.length} pending conflicts:
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ flexWrap: "wrap" }}
                  useFlexGap
                >
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => void decide("overwriteAll")}
                  >
                    Overwrite all
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => void decide("skipAll")}
                  >
                    Skip all
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => void decide("keepBothAll")}
                  >
                    Keep both for all
                  </Button>
                </Stack>
              </>
            )}
          </Stack>

          {queue.length > 1 && (
            <Typography variant="caption" color="text.secondary">
              {queue.length - 1} more conflict
              {queue.length - 1 === 1 ? "" : "s"} queued.
            </Typography>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
