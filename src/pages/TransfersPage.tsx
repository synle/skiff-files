// Transfers page — Phase 4a flavor. Lets the user kick off a local-to-
// local Skiffsync job and watches its progress. Cross-protocol source/
// dest selection lands in Phase 4b once the conflict-resolution dialog
// is built.
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import StopIcon from "@mui/icons-material/Stop";
import { useEffect, useRef, useState } from "react";
import {
  onDone,
  onError,
  onProgress,
  syncCancel,
  syncList,
  syncStartLocal,
  type ConflictPolicy,
  type JobInfo,
  type Progress,
  type Summary,
} from "../api/sync";
import { formatBytes } from "../util/format";

/** UI-side per-job aggregate, blending JobInfo with the latest progress
 *  payload + the final summary if the job finished. We track this map
 *  rather than hammering syncList on every event tick. */
interface JobUiState {
  info: JobInfo;
  progress?: Progress;
  summary?: Summary;
  error?: string;
}

export default function TransfersPage() {
  const [jobs, setJobs] = useState<Record<string, JobUiState>>({});
  const [error, setError] = useState<string | null>(null);

  // Form state for "New job".
  const [src, setSrc] = useState("");
  const [dest, setDest] = useState("");
  const [maxSizeGb, setMaxSizeGb] = useState(1);
  const [lookbackDays, setLookbackDays] = useState(7);
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>("skip");
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);

  const mounted = useRef(true);

  // Subscribe to the three Tauri events on mount; unsubscribe on
  // unmount. Initial JobInfo list comes from one syncList() call so
  // the page survives a refresh / route-change.
  useEffect(() => {
    mounted.current = true;
    let unsubP: (() => void) | null = null;
    let unsubD: (() => void) | null = null;
    let unsubE: (() => void) | null = null;
    void (async () => {
      try {
        const list = await syncList();
        if (!mounted.current) return;
        setJobs(
          Object.fromEntries(
            list.map((info) => [info.id, { info } as JobUiState]),
          ),
        );
      } catch {
        /* page renders fine empty */
      }
    })();
    void (async () => {
      unsubP = await onProgress((p) => {
        setJobs((prev) => {
          const slot = prev[p.jobId] ?? {
            info: {
              id: p.jobId,
              src: "?",
              dest: "?",
              state: "running",
            },
          };
          return { ...prev, [p.jobId]: { ...slot, progress: p } };
        });
      });
      unsubD = await onDone((s) => {
        setJobs((prev) => {
          const slot = prev[s.jobId];
          if (!slot) return prev;
          return {
            ...prev,
            [s.jobId]: {
              ...slot,
              info: {
                ...slot.info,
                state: s.cancelled ? "cancelled" : "done",
              },
              summary: s,
            },
          };
        });
      });
      unsubE = await onError((e) => {
        setJobs((prev) => {
          const slot = prev[e.jobId];
          if (!slot) return prev;
          return {
            ...prev,
            [e.jobId]: {
              ...slot,
              info: { ...slot.info, state: "failed" },
              error: e.error,
            },
          };
        });
      });
    })();
    return () => {
      mounted.current = false;
      unsubP?.();
      unsubD?.();
      unsubE?.();
    };
  }, []);

  const handleStart = async () => {
    setError(null);
    setBusy(true);
    try {
      const id = await syncStartLocal(src, dest, {
        maxSizeGb,
        lookbackDays,
        conflictPolicy,
        dryRun,
      });
      setJobs((prev) => ({
        ...prev,
        [id]: {
          info: { id, src, dest, state: "planning" },
        },
      }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await syncCancel(id);
    } catch (e) {
      setError(String(e));
    }
  };

  const jobList = Object.values(jobs).sort((a, b) =>
    a.info.id.localeCompare(b.info.id),
  );

  return (
    <Box sx={{ p: 3, overflow: "auto", maxWidth: 880 }}>
      <Typography variant="h4" gutterBottom>
        Transfers
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack spacing={4}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            New Skiffsync job
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Local-to-local copy with skip-if-unchanged. Cross-protocol
            (SFTP / FTP / SMB) jobs come in Phase 4b.
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="Source"
              size="small"
              value={src}
              onChange={(e) => setSrc(e.target.value)}
              placeholder="/Users/you/projects/foo"
            />
            <TextField
              label="Destination"
              size="small"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              placeholder="/Volumes/Backup/foo"
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="Max size (GB)"
                size="small"
                type="number"
                value={maxSizeGb}
                onChange={(e) => setMaxSizeGb(Number(e.target.value) || 1)}
                sx={{ width: 140 }}
              />
              <TextField
                label="Lookback days"
                size="small"
                type="number"
                value={lookbackDays}
                onChange={(e) => setLookbackDays(Number(e.target.value) || 0)}
                sx={{ width: 140 }}
              />
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel id="conflict-policy-label">Conflict policy</InputLabel>
                <Select
                  labelId="conflict-policy-label"
                  label="Conflict policy"
                  value={conflictPolicy}
                  onChange={(e) =>
                    setConflictPolicy(e.target.value as ConflictPolicy)
                  }
                >
                  <MenuItem value="skip">Skip</MenuItem>
                  <MenuItem value="overwrite">Overwrite</MenuItem>
                  <MenuItem value="keepBoth">Keep both (rename copied)</MenuItem>
                  <MenuItem value="overwriteOlder">
                    Overwrite older files
                  </MenuItem>
                  <MenuItem value="replaceSmaller">Replace smaller files</MenuItem>
                  <MenuItem value="replaceIfSizeDifferent">
                    Replace if size differs
                  </MenuItem>
                  <MenuItem value="renameTarget">
                    Rename existing target → (old)
                  </MenuItem>
                  <MenuItem value="renameOlderTarget">
                    Rename older target → (old)
                  </MenuItem>
                </Select>
              </FormControl>
            </Stack>
            <FormControlLabel
              control={
                <Switch
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                />
              }
              label="Dry run (report what would happen, write nothing)"
            />
            <Box>
              <Button
                variant="contained"
                disabled={busy || !src || !dest}
                onClick={() => void handleStart()}
              >
                Start
              </Button>
            </Box>
          </Stack>
        </Paper>

        <Box>
          <Typography variant="h6" gutterBottom>
            Jobs
          </Typography>
          {jobList.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No jobs yet.
            </Typography>
          ) : (
            <List dense>
              {jobList.map((j) => {
                const p = j.progress;
                const pct = p && p.bytesTotal > 0
                  ? Math.round((p.bytesDone / p.bytesTotal) * 100)
                  : null;
                const running =
                  j.info.state === "running" || j.info.state === "planning";
                return (
                  <ListItem
                    key={j.info.id}
                    secondaryAction={
                      running ? (
                        <IconButton
                          edge="end"
                          onClick={() => void handleCancel(j.info.id)}
                          aria-label={`Cancel job ${j.info.id}`}
                        >
                          <StopIcon />
                        </IconButton>
                      ) : null
                    }
                    alignItems="flex-start"
                  >
                    <ListItemText
                      primary={`${j.info.src} → ${j.info.dest}`}
                      secondary={
                        <Stack
                          component="span"
                          spacing={0.5}
                          sx={{ mt: 0.5, display: "block" }}
                        >
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary"
                          >
                            {j.info.state}
                            {p
                              ? ` · ${p.filesDone}/${p.filesTotal} files · ${formatBytes(p.bytesDone)} of ${formatBytes(p.bytesTotal)}`
                              : ""}
                            {j.summary
                              ? ` · ${j.summary.copied} copied, ${j.summary.skipped} skipped, ${j.summary.conflicts} conflicts, ${j.summary.errors} errors`
                              : ""}
                          </Typography>
                          {pct != null && (
                            <LinearProgress
                              variant="determinate"
                              value={pct}
                              sx={{ width: 360, maxWidth: "100%" }}
                            />
                          )}
                          {j.error && (
                            <Typography
                              component="span"
                              variant="caption"
                              color="error"
                            >
                              {j.error}
                            </Typography>
                          )}
                        </Stack>
                      }
                      slotProps={{ primary: { variant: "body2" } }}
                    />
                  </ListItem>
                );
              })}
            </List>
          )}
        </Box>
      </Stack>
    </Box>
  );
}
