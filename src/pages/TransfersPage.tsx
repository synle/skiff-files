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
import DeleteIcon from "@mui/icons-material/Delete";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SaveIcon from "@mui/icons-material/Save";
import { useEffect, useRef, useState } from "react";
import ProgressWidget from "../components/ProgressWidget";
import { computeEta, pushSample, type EtaSample } from "../util/etaTracker";
import {
  onDone,
  onError,
  onProgress,
  syncCancel,
  syncCpstamp,
  syncDedup,
  syncList,
  syncPause,
  syncResume,
  syncStartRepo,
  type ConflictPolicy,
  type DedupSummary,
  type JobInfo,
  type Progress,
  type Summary,
} from "../api/sync";
import { startSync } from "../api/client";
import { formatBytes } from "../util/format";
import { useSettings, type SavedSyncJob } from "../state/settings";

/** UI-side per-job aggregate, blending JobInfo with the latest progress
 *  payload + the final summary if the job finished. We track this map
 *  rather than hammering syncList on every event tick. */
interface JobUiState {
  info: JobInfo;
  progress?: Progress;
  summary?: Summary;
  error?: string;
}

/** Local alias kept for legacy code paths. The canonical type lives
 *  on `Settings.savedSyncJobs` from 0.2.228 onward; we narrow the
 *  `conflictPolicy` field back to the typed enum here since the
 *  Settings copy stores it as a plain string for forward-compat. */
type SavedJob = Omit<SavedSyncJob, "conflictPolicy"> & {
  conflictPolicy: ConflictPolicy;
};

/** Legacy localStorage key — read once at mount to migrate any
 *  existing saves into Settings. After migration the key is left in
 *  place (read-only) so a downgrade still surfaces them. */
const LEGACY_SAVED_JOBS_KEY = "skiff-files.savedJobs.v1";

function readLegacySavedJobs(): SavedSyncJob[] {
  try {
    const raw = localStorage.getItem(LEGACY_SAVED_JOBS_KEY);
    return raw ? (JSON.parse(raw) as SavedSyncJob[]) : [];
  } catch {
    return [];
  }
}

export default function TransfersPage() {
  const [jobs, setJobs] = useState<Record<string, JobUiState>>({});
  const [error, setError] = useState<string | null>(null);

  // Form state for "New job". The mode picker switches between the
  // local/cprepo planners; cpstamp + dedup live in their own
  // collapsible sections below since their inputs differ.
  // Form-state initial values come from Settings so the user's
  // configured defaults flow through. Saved-job templates carry their
  // own policy + caps and don't read from this — they're independent
  // of changes the user makes after saving.
  const { settings, update } = useSettings();
  const [src, setSrc] = useState("");
  const [dest, setDest] = useState("");
  const [maxSizeGb, setMaxSizeGb] = useState(settings.syncDefaultMaxSizeGb);
  const [lookbackDays, setLookbackDays] = useState(
    settings.syncDefaultLookbackDays,
  );
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>(
    settings.syncDefaultConflictPolicy,
  );
  const [bandwidthKbps, setBandwidthKbps] = useState(
    settings.syncDefaultBandwidthKbps,
  );
  const [verifyAfterCopy, setVerifyAfterCopy] = useState(
    settings.syncDefaultVerifyAfterCopy,
  );
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [planner, setPlanner] = useState<"local" | "repo">("local");

  // cpstamp + dedup form state.
  const [stampSrc, setStampSrc] = useState("");
  const [stampDestDir, setStampDestDir] = useState("");
  const [dedupRoot, setDedupRoot] = useState("");
  const [stampResult, setStampResult] = useState<string | null>(null);
  const [dedupResult, setDedupResult] = useState<DedupSummary | null>(null);

  // Saved jobs (templates) — persisted as a list of named configs in
  // settings.json. Saving does not start the job; clicking Run on a
  // saved entry fills the form with its values and starts immediately.
  const savedJobs = settings.savedSyncJobs as SavedJob[];
  const setSavedJobs = (
    arg: SavedJob[] | ((prev: SavedJob[]) => SavedJob[]),
  ) => {
    const next =
      typeof arg === "function"
        ? (arg as (prev: SavedJob[]) => SavedJob[])(
            settings.savedSyncJobs as SavedJob[],
          )
        : arg;
    update("savedSyncJobs", next as unknown as SavedSyncJob[]);
  };
  // One-shot migration from the pre-0.2.228 localStorage key. If
  // settings has none and localStorage has some, copy them over; the
  // legacy key stays read-only as a safety net for downgrades.
  useEffect(() => {
    if (settings.savedSyncJobs.length > 0) return;
    const legacy = readLegacySavedJobs();
    if (legacy.length > 0) update("savedSyncJobs", legacy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mounted = useRef(true);
  // Per-job rolling sample buffers for the ETA tracker. Lives outside
  // the React state because we don't need to re-render on each push;
  // we read it during the render pass to compute ETA from the latest
  // progress event.
  const samplesRef = useRef<Record<string, EtaSample[]>>({});

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
        // Push a sample for the rolling-window ETA tracker.
        const buf = samplesRef.current[p.jobId] ?? [];
        pushSample(buf, Date.now(), p.bytesDone);
        samplesRef.current[p.jobId] = buf;
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

  // Command-palette dispatched run — receives either a bare saved-job
  // id (legacy shape, pre-0.2.233) or {id, dryRun?} (new shape so
  // callers can opt into dry-run without a separate event). We
  // resolve the job by id at dispatch time so a stale palette action
  // (saved job already deleted) silently no-ops.
  useEffect(() => {
    const onRun = (e: Event) => {
      const detail = (
        e as CustomEvent<string | { id: string; dryRun?: boolean }>
      ).detail;
      const id = typeof detail === "string" ? detail : detail?.id;
      const dryRun = typeof detail === "string" ? false : !!detail?.dryRun;
      if (!id) return;
      const job = (settings.savedSyncJobs as SavedJob[]).find(
        (j) => j.id === id,
      );
      if (job) void handleRunSavedJob(job, dryRun);
    };
    window.addEventListener("skiff:run-sync-job", onRun);
    return () => window.removeEventListener("skiff:run-sync-job", onRun);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.savedSyncJobs]);

  const handleStart = async () => {
    setError(null);
    setBusy(true);
    // The "Local copy" mode now actually means "let the client pick"
    // — pure local-to-local goes via sync_start_local; anything else
    // routes through sync_start_cross. cprepo stays as-is.
    const start = planner === "repo" ? syncStartRepo : startSync;
    try {
      const id = await start(src, dest, {
        maxSizeGb,
        lookbackDays,
        conflictPolicy,
        dryRun,
        bandwidthKbps,
        verifyAfterCopy,
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

  const handleCpstamp = async () => {
    setError(null);
    setStampResult(null);
    try {
      const out = await syncCpstamp(stampSrc, stampDestDir);
      setStampResult(out);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDedup = async () => {
    setError(null);
    setDedupResult(null);
    try {
      const summary = await syncDedup(dedupRoot);
      setDedupResult(summary);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await syncCancel(id);
    } catch (e) {
      setError(String(e));
    }
  };

  const handlePause = async (id: string) => {
    try {
      await syncPause(id);
      // Reflect locally so the UI button flips immediately, without
      // waiting for the next progress tick.
      setJobs((prev) => {
        const slot = prev[id];
        if (!slot) return prev;
        return {
          ...prev,
          [id]: { ...slot, info: { ...slot.info, state: "paused" } },
        };
      });
    } catch (e) {
      setError(String(e));
    }
  };

  const handleResume = async (id: string) => {
    try {
      await syncResume(id);
      setJobs((prev) => {
        const slot = prev[id];
        if (!slot) return prev;
        return {
          ...prev,
          [id]: { ...slot, info: { ...slot.info, state: "running" } },
        };
      });
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSaveJob = () => {
    if (!src || !dest) return;
    const job: SavedJob = {
      id: crypto.randomUUID(),
      label: `${src} → ${dest}`,
      planner,
      src,
      dest,
      maxSizeGb,
      lookbackDays,
      conflictPolicy,
      bandwidthKbps,
      verifyAfterCopy,
    };
    setSavedJobs((prev) => [...prev, job]);
  };

  const handleDeleteSavedJob = (id: string) => {
    setSavedJobs((prev) => prev.filter((j) => j.id !== id));
  };

  /** Fills the form with a saved job's values + starts it immediately.
   *  Skips the form-fill if the user just wants to inspect — that path
   *  is the click on the row itself. */
  const handleRunSavedJob = async (j: SavedJob, dryRun = false) => {
    setSrc(j.src);
    setDest(j.dest);
    setPlanner(j.planner);
    setMaxSizeGb(j.maxSizeGb);
    setLookbackDays(j.lookbackDays);
    setConflictPolicy(j.conflictPolicy);
    setError(null);
    setBusy(true);
    const start = j.planner === "repo" ? syncStartRepo : startSync;
    try {
      const id = await start(j.src, j.dest, {
        maxSizeGb: j.maxSizeGb,
        lookbackDays: j.lookbackDays,
        conflictPolicy: j.conflictPolicy,
        dryRun,
        // Saved jobs predate the bandwidth field; fall back to the
        // current Settings default rather than 0 so existing saves
        // honor the user's current cap.
        bandwidthKbps: j.bandwidthKbps ?? settings.syncDefaultBandwidthKbps,
        verifyAfterCopy:
          j.verifyAfterCopy ?? settings.syncDefaultVerifyAfterCopy,
      });
      setJobs((prev) => ({
        ...prev,
        [id]: {
          info: { id, src: j.src, dest: j.dest, state: "planning" },
        },
      }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const jobList = Object.values(jobs).sort((a, b) =>
    a.info.id.localeCompare(b.info.id),
  );

  return (
    <Box sx={{ flex: 1, p: 3, overflow: "auto" }}>
      <Box sx={{ maxWidth: 880, mx: "auto" }}>
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
            <FormControl size="small" sx={{ maxWidth: 280 }}>
              <InputLabel id="planner-label">Mode</InputLabel>
              <Select
                labelId="planner-label"
                label="Mode"
                value={planner}
                onChange={(e) =>
                  setPlanner(e.target.value as "local" | "repo")
                }
              >
                <MenuItem value="local">
                  Local copy (everything in src)
                </MenuItem>
                <MenuItem value="repo">
                  Repo copy (only git ls-files)
                </MenuItem>
              </Select>
            </FormControl>
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
              <TextField
                label="Bandwidth (KB/s)"
                size="small"
                type="number"
                value={bandwidthKbps}
                onChange={(e) =>
                  setBandwidthKbps(Math.max(0, Number(e.target.value) || 0))
                }
                helperText="0 = unlimited"
                sx={{ width: 160 }}
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
                  <MenuItem value="prompt">Ask each time…</MenuItem>
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
            <FormControlLabel
              control={
                <Switch
                  checked={verifyAfterCopy}
                  onChange={(e) => setVerifyAfterCopy(e.target.checked)}
                />
              }
              label="Verify after copy (re-stat dest size)"
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={busy || !src || !dest}
                onClick={() => void handleStart()}
              >
                Start
              </Button>
              <Button
                variant="outlined"
                startIcon={<SaveIcon />}
                disabled={!src || !dest}
                onClick={handleSaveJob}
              >
                Save as template
              </Button>
            </Stack>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Stamped copy (cpstamp)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Copy a single file with a <code>YYYY_MM_DD_HH_MM</code>{" "}
            suffix — handy for "snapshot this config before I touch it".
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="Source file"
              size="small"
              value={stampSrc}
              onChange={(e) => setStampSrc(e.target.value)}
              placeholder="/Users/you/.zshrc"
            />
            <TextField
              label="Destination folder"
              size="small"
              value={stampDestDir}
              onChange={(e) => setStampDestDir(e.target.value)}
              placeholder="/Volumes/Backup/configs"
            />
            <Box>
              <Button
                variant="outlined"
                disabled={!stampSrc || !stampDestDir}
                onClick={() => void handleCpstamp()}
              >
                Stamp + copy
              </Button>
            </Box>
            {stampResult && (
              <Alert severity="success" onClose={() => setStampResult(null)}>
                Wrote <code>{stampResult}</code>
              </Alert>
            )}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            De-duplicate folder
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Recursively scans a folder, finds byte-identical duplicates
            (md5 + size), and moves the extras into{" "}
            <code>&lt;folder&gt;/_recycleBin/</code>. Idempotent — run again
            to verify nothing else is left to remove.
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="Folder"
              size="small"
              value={dedupRoot}
              onChange={(e) => setDedupRoot(e.target.value)}
              placeholder="/Users/you/Downloads"
            />
            <Box>
              <Button
                variant="outlined"
                color="warning"
                disabled={!dedupRoot}
                onClick={() => void handleDedup()}
              >
                Find + move duplicates
              </Button>
            </Box>
            {dedupResult && (
              <Alert
                severity={dedupResult.duplicates > 0 ? "warning" : "info"}
                onClose={() => setDedupResult(null)}
              >
                Scanned {dedupResult.scanned} files,{" "}
                {dedupResult.duplicates} duplicates moved (
                {formatBytes(dedupResult.bytesFreed)} freed).
                {dedupResult.duplicates > 0 && (
                  <>
                    {" "}
                    Review at <code>{dedupResult.recycleBin}</code>.
                  </>
                )}
              </Alert>
            )}
          </Stack>
        </Paper>

        {savedJobs.length > 0 && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Saved templates
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Click ▶ to run a saved job with its stored options.
            </Typography>
            <List dense>
              {savedJobs.map((j) => (
                <ListItem
                  key={j.id}
                  secondaryAction={
                    <Stack direction="row">
                      <IconButton
                        edge="end"
                        onClick={() => void handleRunSavedJob(j)}
                        disabled={busy}
                        aria-label={`Run ${j.label}`}
                      >
                        <PlayArrowIcon />
                      </IconButton>
                      <IconButton
                        edge="end"
                        onClick={() => handleDeleteSavedJob(j.id)}
                        aria-label={`Delete saved job ${j.label}`}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Stack>
                  }
                >
                  <ListItemText
                    primary={j.label}
                    secondary={`${j.planner} · max ${j.maxSizeGb} GB · ${j.conflictPolicy}`}
                  />
                </ListItem>
              ))}
            </List>
          </Paper>
        )}

        <Box>
          <Typography variant="h6" gutterBottom>
            Jobs
          </Typography>
          {jobList.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No jobs yet.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {jobList.map((j) => {
                const p = j.progress;
                const running =
                  j.info.state === "running" || j.info.state === "planning";
                const paused = j.info.state === "paused";
                const inFlight = running || paused;
                const buf = samplesRef.current[j.info.id] ?? [];
                const eta = computeEta(buf, p?.bytesTotal);
                return (
                  <Paper
                    key={j.info.id}
                    variant="outlined"
                    sx={{ p: 1.5 }}
                  >
                    <ProgressWidget
                      label={`${j.info.src} → ${j.info.dest} · ${j.info.state}`}
                      filesDone={p?.filesDone ?? 0}
                      filesTotal={p?.filesTotal ?? 0}
                      bytesDone={p?.bytesDone}
                      bytesTotal={p?.bytesTotal}
                      currentItem={p?.last?.dest}
                      etaSeconds={eta.etaSeconds}
                      bytesPerSec={eta.bytesPerSec}
                      paused={paused}
                      onPause={inFlight && !paused ? () => void handlePause(j.info.id) : undefined}
                      onResume={paused ? () => void handleResume(j.info.id) : undefined}
                      onCancel={inFlight ? () => void handleCancel(j.info.id) : undefined}
                      error={j.error ?? null}
                    />
                    {j.summary && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mt: 0.5 }}
                      >
                        {j.summary.copied} copied, {j.summary.skipped} skipped,{" "}
                        {j.summary.conflicts} conflicts, {j.summary.errors} errors
                      </Typography>
                    )}
                  </Paper>
                );
              })}
            </Stack>
          )}
        </Box>
      </Stack>
      </Box>
    </Box>
  );
}
