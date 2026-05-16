// Floating bottom-right drawer that surfaces every in-flight
// Skiffsync job from anywhere in the app. Means closing the
// Transfers page (or never visiting it) doesn't hide an active sync —
// the user always knows what's running.
//
// Subscribes to the same sync:progress / sync:done / sync:error
// events that TransfersPage uses, but renders a compact view that
// stays out of the way until a job lands.
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { useEffect, useRef, useState } from "react";
import {
  onDone,
  onError,
  onProgress,
  syncCancel,
  syncList,
  syncPause,
  syncResume,
  type JobInfo,
  type Progress,
} from "../api/sync";
import { computeEta, pushSample, type EtaSample } from "../util/etaTracker";
import ProgressWidget from "./ProgressWidget";
import { useSettings } from "../state/settings";
import { SYNC_QUEUED_EVENT, type SyncQueuedDetail } from "../api/client";

interface JobUiState {
  info: JobInfo;
  progress?: Progress;
  error?: string;
}

/** Compact one-line label for the accordion summary so a row stays
 *  readable while collapsed: "src/dir → dest/dir · 12 / 34 · 42%". */
function summarizeJob(j: JobUiState): string {
  const p = j.progress;
  const arrow = `${j.info.src} → ${j.info.dest}`;
  if (!p) return arrow;
  const files =
    p.filesTotal > 0 ? `${p.filesDone} / ${p.filesTotal}` : `${p.filesDone}`;
  if (p.bytesTotal && p.bytesTotal > 0) {
    const pct = Math.min(
      100,
      Math.round((p.bytesDone / p.bytesTotal) * 100),
    );
    return `${arrow} · ${files} · ${pct}%`;
  }
  return `${arrow} · ${files}`;
}

export default function OperationsDrawer() {
  const { settings, update } = useSettings();
  const [jobs, setJobs] = useState<Record<string, JobUiState>>({});
  const expanded = settings.operationsDrawerExpanded;
  const setExpanded = (next: boolean) =>
    update("operationsDrawerExpanded", next);
  /** When true, the drawer is hidden until a new job starts. Used by
   *  the user pressing the × — we don't unsubscribe from events
   *  because that'd break the "drawer reappears on next job" UX. */
  const [hidden, setHidden] = useState(false);
  /** Which job id is currently expanded in the accordion. Only one at
   *  a time (accordion semantics). Null = all collapsed. Defaults to
   *  the first in-flight job so a single-job drawer reads as today —
   *  the user sees the progress widget without clicking. */
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const samplesRef = useRef<Record<string, EtaSample[]>>({});

  useEffect(() => {
    let unsubP: (() => void) | null = null;
    let unsubD: (() => void) | null = null;
    let unsubE: (() => void) | null = null;
    void (async () => {
      try {
        const list = await syncList();
        const inFlight: Record<string, JobUiState> = {};
        for (const info of list) {
          if (info.state === "running" || info.state === "paused" || info.state === "planning") {
            inFlight[info.id] = { info };
          }
        }
        setJobs(inFlight);
      } catch {
        /* silently — running outside Tauri */
      }
    })();
    void (async () => {
      unsubP = await onProgress((p) => {
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
        setHidden(false); // reveal drawer when a new job emits
      });
      unsubD = await onDone((s) => {
        setJobs((prev) => {
          // Drop the job from the drawer once it's done — the user
          // doesn't need to see "X copied, 0 errors" linger; that's
          // what the Transfers page is for.
          const next = { ...prev };
          delete next[s.jobId];
          delete samplesRef.current[s.jobId];
          return next;
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
    // Bug 3 fix — seed the drawer the instant `startSync` returns a
    // job-id so the user sees the job's src/dest even before the
    // first `sync:progress` event fires. Without this, tiny SMB
    // pastes that complete before any progress emit (sub-100 ms
    // local-to-local kernel copies, or one-byte files) would never
    // appear in the drawer at all — exactly the "I am not seeing
    // any progress window" report.
    const onQueued = (ev: Event) => {
      const detail = (ev as CustomEvent<SyncQueuedDetail>).detail;
      if (!detail?.jobId) return;
      setJobs((prev) => {
        if (prev[detail.jobId]) return prev; // already tracked
        return {
          ...prev,
          [detail.jobId]: {
            info: {
              id: detail.jobId,
              src: detail.src,
              dest: detail.dest,
              state: "planning",
            },
          },
        };
      });
      setHidden(false);
    };
    window.addEventListener(SYNC_QUEUED_EVENT, onQueued);
    return () => {
      unsubP?.();
      unsubD?.();
      unsubE?.();
      window.removeEventListener(SYNC_QUEUED_EVENT, onQueued);
    };
  }, []);

  const jobList = Object.values(jobs);

  // Keep `openJobId` valid: when the open job finishes (gets pruned
  // from `jobs`), fall back to the next in-flight job so the drawer
  // doesn't collapse to an all-closed state. The user opted into
  // "show me what's running"; surfacing whatever's left preserves
  // that contract.
  useEffect(() => {
    if (jobList.length === 0) {
      if (openJobId !== null) setOpenJobId(null);
      return;
    }
    if (openJobId === null || !jobs[openJobId]) {
      setOpenJobId(jobList[0].info.id);
    }
  }, [jobs, jobList, openJobId]);

  if (jobList.length === 0 || hidden) return null;

  return (
    <Paper
      elevation={6}
      sx={{
        position: "fixed",
        right: 16,
        bottom: 16,
        width: 360,
        maxWidth: "calc(100vw - 32px)",
        zIndex: 1200,
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 1.5,
          py: 0.5,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "action.selected",
        }}
      >
        <Typography variant="caption" sx={{ flex: 1, fontWeight: 600 }}>
          {jobList.length} operation{jobList.length === 1 ? "" : "s"} in
          progress
        </Typography>
        <Tooltip title={expanded ? "Collapse" : "Expand"}>
          <IconButton
            size="small"
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? "Collapse operations drawer" : "Expand operations drawer"}
          >
            {expanded ? (
              <ExpandMoreIcon fontSize="small" />
            ) : (
              <ExpandLessIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip title="Hide until next operation">
          <IconButton
            size="small"
            onClick={() => setHidden(true)}
            aria-label="Hide operations drawer"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      {expanded && (
        <Box sx={{ maxHeight: "40vh", overflowY: "auto" }}>
          {jobList.map((j) => {
            const p = j.progress;
            const buf = samplesRef.current[j.info.id] ?? [];
            const eta = computeEta(buf, p?.bytesTotal);
            const paused = j.info.state === "paused";
            const inFlight =
              j.info.state === "running" ||
              j.info.state === "planning" ||
              paused;
            const isOpen = openJobId === j.info.id;
            return (
              <Accordion
                key={j.info.id}
                disableGutters
                square
                elevation={0}
                expanded={isOpen}
                onChange={(_, willOpen) =>
                  setOpenJobId(willOpen ? j.info.id : null)
                }
                sx={{
                  "&:before": { display: "none" },
                  borderBottom: 1,
                  borderColor: "divider",
                  "&:last-of-type": { borderBottom: 0 },
                }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon fontSize="small" />}
                  aria-label={`Toggle ${j.info.src} → ${j.info.dest}`}
                  sx={{
                    minHeight: 36,
                    "& .MuiAccordionSummary-content": {
                      my: 0.5,
                      overflow: "hidden",
                    },
                  }}
                >
                  <Typography
                    variant="caption"
                    noWrap
                    title={`${j.info.src} → ${j.info.dest}`}
                    sx={{
                      fontWeight: isOpen ? 600 : 500,
                      flex: 1,
                      minWidth: 0,
                      color: j.error ? "error.main" : "text.primary",
                    }}
                  >
                    {summarizeJob(j)}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, pb: 1.5, px: 1.5 }}>
                  <ProgressWidget
                    dense
                    label={`${j.info.src} → ${j.info.dest}`}
                    filesDone={p?.filesDone ?? 0}
                    filesTotal={p?.filesTotal ?? 0}
                    bytesDone={p?.bytesDone}
                    bytesTotal={p?.bytesTotal}
                    currentItem={p?.last?.dest}
                    etaSeconds={eta.etaSeconds}
                    bytesPerSec={eta.bytesPerSec}
                    paused={paused}
                    onPause={
                      inFlight && !paused
                        ? () => void syncPause(j.info.id).catch(() => {})
                        : undefined
                    }
                    onResume={
                      paused
                        ? () => void syncResume(j.info.id).catch(() => {})
                        : undefined
                    }
                    onCancel={
                      inFlight
                        ? () => void syncCancel(j.info.id).catch(() => {})
                        : undefined
                    }
                    error={j.error ?? null}
                  />
                </AccordionDetails>
              </Accordion>
            );
          })}
        </Box>
      )}
    </Paper>
  );
}
