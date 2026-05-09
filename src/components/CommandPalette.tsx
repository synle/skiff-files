// VS Code-style command palette. Cmd/Ctrl+Shift+P opens a list of
// every action — theme toggles, view modes, page nav, font reset,
// etc. Filter by typing; ↑/↓ moves the highlight; Enter executes;
// Esc closes.
//
// The action set is supplied by the caller (App), so each binding
// stays close to where it's actually wired and can read live state
// (e.g. "current theme = dark" → execute swaps to light).
import {
  Box,
  Dialog,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";

export interface CommandAction {
  /** Stable id (used as React key + for telemetry / future preset
   *  binding). Doesn't have to be human-readable. */
  id: string;
  /** Headline shown to the user. */
  label: string;
  /** Optional descriptor under the label — current state, keyboard
   *  shortcut, etc. */
  hint?: string;
  /** Free-text bag of words filtered against the search input. Always
   *  includes the label so callers don't have to repeat it. */
  keywords?: string;
  /** When set, action renders disabled (a sub-state badge).  */
  disabled?: boolean;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  actions: CommandAction[];
}

export default function CommandPalette({ open, onClose, actions }: Props) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset state on every open so previous usage doesn't bleed in.
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      // Focus on next tick so the dialog has finished mounting.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => {
      const hay = `${a.label} ${a.hint ?? ""} ${a.keywords ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [actions, query]);

  // Keep the highlight in bounds when the filtered list shrinks.
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(0);
  }, [filtered.length, highlight]);

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const action = filtered[highlight];
      if (action && !action.disabled) {
        action.run();
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            position: "absolute",
            top: "10vh",
            m: 0,
          },
        },
      }}
      onKeyDown={onKey}
    >
      <Box sx={{ p: 1 }}>
        <TextField
          inputRef={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a command…"
          fullWidth
          size="small"
          autoFocus
        />
      </Box>
      <List
        dense
        sx={{
          maxHeight: "60vh",
          overflowY: "auto",
          py: 0,
        }}
      >
        {filtered.length === 0 && (
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="body2" color="text.secondary">
              No matches
            </Typography>
          </Box>
        )}
        {filtered.map((a, i) => (
          <ListItemButton
            key={a.id}
            selected={i === highlight}
            disabled={a.disabled}
            onMouseEnter={() => setHighlight(i)}
            onClick={() => {
              if (a.disabled) return;
              a.run();
              onClose();
            }}
          >
            <ListItemText
              primary={a.label}
              secondary={a.hint || undefined}
              slotProps={{
                primary: { variant: "body2" },
                secondary: { variant: "caption" },
              }}
            />
          </ListItemButton>
        ))}
      </List>
    </Dialog>
  );
}
