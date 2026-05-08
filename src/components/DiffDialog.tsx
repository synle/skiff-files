// Line-based diff view between two text files. Pure-frontend: pulls
// both files via the existing readText command (subject to its
// 256 KB cap) and runs `diff` to compute hunks. Unified-display
// mode is the default; side-by-side could land later.
//
// Triggered via FileList right-click → "Compare with…" which sets
// a "primary" file then prompts for the second.
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useEffect, useMemo, useState } from "react";
import { diffLines } from "diff";
import { readText } from "../api/client";

interface Props {
  /** Left ("base") path. Null hides the dialog. */
  left: string | null;
  /** Right ("compare") path. Null hides the dialog. */
  right: string | null;
  onClose: () => void;
}

interface FileState {
  text: string | null;
  error: string | null;
}

export default function DiffDialog({ left, right, onClose }: Props) {
  const open = left != null && right != null;
  const [leftFile, setLeftFile] = useState<FileState>({
    text: null,
    error: null,
  });
  const [rightFile, setRightFile] = useState<FileState>({
    text: null,
    error: null,
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLeftFile({ text: null, error: null });
    setRightFile({ text: null, error: null });
    void readText(left!)
      .then((t) => !cancelled && setLeftFile({ text: t, error: null }))
      .catch((e) =>
        !cancelled && setLeftFile({ text: null, error: String(e) }),
      );
    void readText(right!)
      .then((t) => !cancelled && setRightFile({ text: t, error: null }))
      .catch((e) =>
        !cancelled && setRightFile({ text: null, error: String(e) }),
      );
    return () => {
      cancelled = true;
    };
  }, [open, left, right]);

  const hunks = useMemo(() => {
    if (leftFile.text == null || rightFile.text == null) return [];
    return diffLines(leftFile.text, rightFile.text);
  }, [leftFile.text, rightFile.text]);

  if (!open) return null;
  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="subtitle1" sx={{ flex: 1, wordBreak: "break-all" }}>
          {left} ↔ {right}
        </Typography>
        <IconButton onClick={onClose} aria-label="Close diff">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {leftFile.error || rightFile.error ? (
          <Typography color="error" variant="body2">
            {leftFile.error ?? rightFile.error}
          </Typography>
        ) : leftFile.text == null || rightFile.text == null ? (
          <Typography color="text.secondary" variant="body2">
            Loading…
          </Typography>
        ) : (
          <Stack spacing={0}>
            {hunks.map((h, i) => {
              // `diff` library labels added/removed; unchanged hunks
              // have neither flag. Color-code via background tint.
              const color = h.added
                ? "success.main"
                : h.removed
                  ? "error.main"
                  : "text.primary";
              const bg = h.added
                ? "rgba(46, 160, 67, 0.12)"
                : h.removed
                  ? "rgba(248, 81, 73, 0.12)"
                  : "transparent";
              const prefix = h.added ? "+" : h.removed ? "-" : " ";
              return (
                <Box
                  key={i}
                  component="pre"
                  sx={{
                    m: 0,
                    px: 1,
                    py: 0.25,
                    fontFamily: "monospace",
                    fontSize: "0.75rem",
                    whiteSpace: "pre-wrap",
                    bgcolor: bg,
                    color,
                  }}
                >
                  {h.value
                    .split("\n")
                    // `diff` keeps the trailing newline as an empty
                    // last segment for some hunks — strip it so we
                    // don't render a phantom blank line.
                    .filter((line, idx, arr) => !(idx === arr.length - 1 && line === ""))
                    .map((line, j) => (
                      <Box key={j}>
                        {prefix} {line}
                      </Box>
                    ))}
                </Box>
              );
            })}
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
