// Floating bottom-right drawer that surfaces every in-flight
// Skiffsync job from anywhere in the app. Means closing the
// Transfers page (or never visiting it) doesn't hide an active sync —
// the user always knows what's running.
//
// Subscribes to the same sync:progress / sync:done / sync:error
// events that TransfersPage uses, but renders a compact view that
// stays out of the way until a job lands.
import {
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

interface JobUiState {
  info: JobInfo;
  progress?: Progress;
  error?: string;
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
    return () => {
      unsubP?.();
      unsubD?.();
      unsubE?.();
    };
  }, []);

  const jobList = Object.values(jobs);
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
        <Box sx={{ p: 1.5, maxHeight: "40vh", overflowY: "auto" }}>
          {jobList.map((j) => {
            const p = j.progress;
            const buf = samplesRef.current[j.info.id] ?? [];
            const eta = computeEta(buf, p?.bytesTotal);
            const paused = j.info.state === "paused";
            const inFlight =
              j.info.state === "running" ||
              j.info.state === "planning" ||
              paused;
            return (
              <Box key={j.info.id} sx={{ mb: 1.5 }}>
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
              </Box>
            );
          })}
        </Box>
      )}
    </Paper>
  );
}
