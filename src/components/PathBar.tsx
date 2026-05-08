// Breadcrumb path bar with click-to-jump segments and an editable input mode.
// Pressing Enter in edit mode navigates; Escape cancels. We canonicalize via
// the Rust backend so `~/foo` and `../bar` resolve to absolute paths the rest
// of the app can rely on.
import {
  Box,
  Breadcrumbs,
  IconButton,
  Link,
  TextField,
  Tooltip,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import HomeIcon from "@mui/icons-material/Home";
import { useEffect, useRef, useState } from "react";
import { fsCanonicalize } from "../api/fs";
import { listDir } from "../api/client";
import { pathSegments } from "../util/format";
import { isRemote } from "../util/location";
import { completePath, splitForCompletion } from "../util/autocomplete";

interface Props {
  path: string;
  onNavigate: (path: string) => void;
  onHome: () => void;
  /** Counter that flips the bar into edit mode whenever it changes.
   *  Browser increments it in response to Cmd/Ctrl+L. We use a counter
   *  rather than a boolean so repeated presses re-focus even when the
   *  bar is already editing (matches browser address-bar muscle memory). */
  focusRequest?: number;
}

/** Two modes: breadcrumb (default) and editable text. Toggle via the pencil. */
export default function PathBar({ path, onNavigate, onHome, focusRequest }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(path);

  // External "please focus me" pulses (Cmd/Ctrl+L from Browser). The
  // counter pattern means repeated presses re-fire even when we're
  // already in edit mode; the autoFocus on the TextField handles the
  // first transition and the explicit focus() the subsequent ones.
  useEffect(() => {
    if (focusRequest === undefined || focusRequest === 0) return;
    setEditing(true);
    setDraft(path);
    // Wait a tick so the TextField mounts before we focus / select.
    queueMicrotask(() => {
      const el = document.querySelector<HTMLInputElement>(
        'input[aria-label="Path"]',
      );
      el?.focus();
      el?.select();
    });
    // Intentionally don't depend on `path` — only fire when the
    // counter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);
  /** Cache of the last parent listing, keyed by parent path. Avoids
   *  re-issuing list_dir on every Tab press. Cleared when the parent
   *  changes (the next Tab refetches). */
  const cacheRef = useRef<{ parent: string; entries: { name: string; isDir: boolean }[] } | null>(null);

  // Keep the draft in sync with the current path so typing in edit mode
  // starts from the latest value, not the value when the component mounted.
  useEffect(() => setDraft(path), [path]);

  const segments = pathSegments(path);

  const commit = async () => {
    const target = draft.trim();
    if (!target) {
      setEditing(false);
      return;
    }
    // Remote paths are already absolute — there's no `~` expansion in
    // `sftp://` and we don't have a remote canonicalize endpoint yet.
    if (isRemote(target)) {
      onNavigate(target);
      setEditing(false);
      return;
    }
    try {
      const abs = await fsCanonicalize(target);
      onNavigate(abs);
    } catch {
      // Fall back to the raw input — if it doesn't exist the list_dir call
      // downstream will surface a friendlier error in the file list.
      onNavigate(target);
    }
    setEditing(false);
  };

  /** Tab handler: fetch the parent's entries (cached per-parent) and
   *  rewrite `draft` with the completed value via the pure helper.
   *  Silent on no-progress / no-match — the user just sees Tab do
   *  nothing, matching shell autocomplete behavior. */
  const completeWithTab = async () => {
    const { parent } = splitForCompletion(draft);
    if (!parent) return;
    let entries = cacheRef.current?.parent === parent ? cacheRef.current.entries : null;
    if (!entries) {
      try {
        const list = await listDir(parent);
        entries = list.map((e) => ({ name: e.name, isDir: e.isDir }));
        cacheRef.current = { parent, entries };
      } catch {
        return; // parent doesn't exist / unreachable — silently bail
      }
    }
    const next = completePath(draft, entries);
    if (next != null) setDraft(next);
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        py: 0.5,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Tooltip title="Home">
        <IconButton size="small" onClick={onHome} aria-label="Home">
          <HomeIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {editing ? (
        <TextField
          autoFocus
          size="small"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") {
              setDraft(path);
              setEditing(false);
            }
            if (e.key === "Tab") {
              // Don't let Tab leave the input; that would break the
              // typical shell-style "press Tab again to keep
              // completing" muscle memory.
              e.preventDefault();
              void completeWithTab();
            }
          }}
          onBlur={() => setEditing(false)}
          sx={{ flexGrow: 1 }}
          slotProps={{ htmlInput: { "aria-label": "Path" } }}
        />
      ) : (
        <Breadcrumbs
          sx={{ flexGrow: 1, overflow: "hidden" }}
          maxItems={6}
          onContextMenu={(e) => {
            // Right-click anywhere in the breadcrumb strip copies
            // the full current path to the clipboard. Best-effort —
            // silent fallback in tests / browsers without clipboard
            // permission.
            e.preventDefault();
            if (typeof navigator !== "undefined" && navigator.clipboard) {
              void navigator.clipboard.writeText(path);
            }
          }}
          title="Right-click to copy full path"
        >
          {segments.map((seg) => (
            <Link
              key={seg.path}
              component="button"
              onClick={() => onNavigate(seg.path)}
              underline="hover"
              color="inherit"
              // Hover surfaces the full path-up-to-here, useful when
              // the breadcrumb truncates with `maxItems` and the user
              // wants to know what a middle segment actually points at.
              title={seg.path}
              sx={{ fontSize: "0.875rem" }}
            >
              {seg.label}
            </Link>
          ))}
        </Breadcrumbs>
      )}

      <Tooltip title={editing ? "Cancel" : "Edit path"}>
        <IconButton
          size="small"
          onClick={() => setEditing((e) => !e)}
          aria-label="Edit path"
        >
          <EditIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
