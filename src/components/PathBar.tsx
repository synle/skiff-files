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
import { useEffect, useState } from "react";
import { fsCanonicalize } from "../api/fs";
import { pathSegments } from "../util/format";
import { isRemote } from "../util/location";

interface Props {
  path: string;
  onNavigate: (path: string) => void;
  onHome: () => void;
}

/** Two modes: breadcrumb (default) and editable text. Toggle via the pencil. */
export default function PathBar({ path, onNavigate, onHome }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(path);

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
          }}
          onBlur={() => setEditing(false)}
          sx={{ flexGrow: 1 }}
          slotProps={{ htmlInput: { "aria-label": "Path" } }}
        />
      ) : (
        <Breadcrumbs sx={{ flexGrow: 1, overflow: "hidden" }} maxItems={6}>
          {segments.map((seg) => (
            <Link
              key={seg.path}
              component="button"
              onClick={() => onNavigate(seg.path)}
              underline="hover"
              color="inherit"
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
