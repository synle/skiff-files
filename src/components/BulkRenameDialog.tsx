// Multi-select rename dialog. Triggered when the user has > 1 entry
// selected and presses F2 (or picks Rename… from the context menu;
// the context-menu integration lands in a follow-up because the menu
// currently dispatches against a single right-clicked entry).
//
// Substitution lives in `util/bulkRename.applyBulkRename` so we can
// preview live as the user types without re-implementing the regex
// dance per render.
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import type { Entry } from "../api/fs";
import { rename as clientRename } from "../api/client";
import { applyBulkRename } from "../util/bulkRename";

interface Props {
  /** When non-empty, the dialog is open. Empty array = closed. */
  entries: Entry[];
  onClose: () => void;
  /** Resolved after every successful rename so the parent can refresh
   *  the listing. Not awaited per-rename inside this component. */
  onDone: () => void;
}

export default function BulkRenameDialog({
  entries,
  onClose,
  onDone,
}: Props) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [regex, setRegex] = useState(false);
  const [inlineEdit, setInlineEdit] = useState(false);
  /** Per-row override that wins over the find/replace result.
   *  Keyed by the original entry name so a name change clears its
   *  override automatically (the row simply disappears). */
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // Reset state every time the dialog re-opens with a new selection
  // — last session's pattern shouldn't leak.
  useEffect(() => {
    if (entries.length > 0) {
      setFind("");
      setReplace("");
      setPrefix("");
      setSuffix("");
      setRegex(false);
      setInlineEdit(false);
      setOverrides({});
      setBusy(false);
      setProgress(null);
      setError(null);
    }
  }, [entries]);

  const results = useMemo(
    () =>
      applyBulkRename(
        entries.map((e) => e.name),
        find,
        replace,
        regex,
        { prefix, suffix },
      ),
    [entries, find, replace, regex, prefix, suffix],
  );

  /** Apply the per-row override on top of the find/replace result.
   *  An override is any non-empty string that differs from oldName;
   *  empty / equal strings clear the override semantics so the row
   *  shows as unchanged. */
  const effective = useMemo(
    () =>
      results.map((r) => {
        const override = overrides[r.oldName];
        if (override != null && override !== "" && override !== r.oldName) {
          return { ...r, newName: override, changed: true };
        }
        return r;
      }),
    [results, overrides],
  );

  const changed = effective.filter((r) => r.changed);
  const regexErr = results.find((r) => r.error)?.error ?? null;

  /** Detect renames that would collide with each other (two src names
   *  rewritten to the same new name) — surfaces as a warning since
   *  applying would lose data on the OS-rename collision. */
  const collisionCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of changed) {
      counts.set(r.newName, (counts.get(r.newName) ?? 0) + 1);
    }
    let dup = 0;
    for (const [, n] of counts) if (n > 1) dup += n;
    return dup;
  }, [changed]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: changed.length });
    let done = 0;
    for (const r of changed) {
      const entry = entries.find((e) => e.name === r.oldName);
      if (!entry) continue;
      const sep = entry.path.lastIndexOf("/");
      const parent = sep > 0 ? entry.path.slice(0, sep) : entry.path;
      const dest = `${parent}/${r.newName}`;
      try {
        await clientRename(entry.path, dest);
      } catch (e) {
        setError(`${r.oldName} → ${r.newName}: ${e}`);
        // Keep going — rename of one file shouldn't abort the rest.
      }
      done += 1;
      setProgress({ done, total: changed.length });
    }
    setBusy(false);
    onDone();
    onClose();
  };

  const open = entries.length > 0;
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Rename {entries.length} items</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Stack direction="row" spacing={2}>
            <TextField
              label="Find"
              size="small"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              fullWidth
              autoFocus
            />
            <TextField
              label="Replace"
              size="small"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              fullWidth
            />
          </Stack>
          <FormControlLabel
            control={
              <Switch
                checked={regex}
                onChange={(e) => setRegex(e.target.checked)}
              />
            }
            label="Regular expression (use $1, $2 for capture groups)"
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Prefix"
              size="small"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              fullWidth
              helperText="Prepended to every name."
            />
            <TextField
              label="Suffix"
              size="small"
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              fullWidth
              helperText="Inserted before the extension."
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Tip: <code>{"{n}"}</code> in the Replace field expands to
            a sequence number (1, 2, 3, …). Use <code>{"{n:03}"}</code>
            for zero-padded (001, 002, …).
          </Typography>
          {regexErr && (
            <Typography variant="caption" color="error">
              {regexErr}
            </Typography>
          )}
          {collisionCount > 0 && !regexErr && (
            <Typography variant="caption" color="warning.main">
              {collisionCount} entries would collide on the same new name —
              fix the pattern or duplicates will be skipped.
            </Typography>
          )}

          <FormControlLabel
            control={
              <Switch
                checked={inlineEdit}
                onChange={(e) => setInlineEdit(e.target.checked)}
              />
            }
            label="Inline edit (tweak individual results before applying)"
          />

          <Box
            sx={{
              maxHeight: 240,
              overflow: "auto",
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              p: 1,
            }}
          >
            {inlineEdit ? (
              <Stack spacing={0.5}>
                {effective.map((r) => (
                  <Box
                    key={r.oldName}
                    sx={{
                      display: "flex",
                      flexDirection: "row",
                      gap: 1,
                      alignItems: "center",
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        fontFamily: "monospace",
                        flexBasis: "40%",
                        flexShrink: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: r.changed ? "text.secondary" : "text.disabled",
                      }}
                      title={r.oldName}
                    >
                      {r.oldName}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ flexShrink: 0, color: "text.secondary" }}
                    >
                      →
                    </Typography>
                    <TextField
                      size="small"
                      value={r.newName}
                      onChange={(e) =>
                        setOverrides((m) => ({
                          ...m,
                          [r.oldName]: e.target.value,
                        }))
                      }
                      sx={{
                        flex: 1,
                        "& input": { fontFamily: "monospace", fontSize: 12 },
                      }}
                    />
                  </Box>
                ))}
              </Stack>
            ) : find === "" && Object.keys(overrides).length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                Enter a Find pattern (or flip Inline edit on) to preview the renames.
              </Typography>
            ) : changed.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                No names matched.
              </Typography>
            ) : (
              <Stack spacing={0.25}>
                {/* Cap the preview to 20 rows — beyond that the user
                    should refine the pattern, not scroll. */}
                {changed.slice(0, 20).map((r) => (
                  <Typography
                    key={r.oldName}
                    variant="caption"
                    sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}
                  >
                    {r.oldName} → {r.newName}
                  </Typography>
                ))}
                {changed.length > 20 && (
                  <Typography variant="caption" color="text.secondary">
                    + {changed.length - 20} more…
                  </Typography>
                )}
              </Stack>
            )}
          </Box>

          {progress && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                {progress.done} / {progress.total}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={
                  progress.total === 0
                    ? 0
                    : Math.round((progress.done / progress.total) * 100)
                }
              />
            </Box>
          )}

          {error && (
            <Typography variant="caption" color="error">
              {error}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy || changed.length === 0 || regexErr != null}
          onClick={() => void apply()}
        >
          Rename {changed.length} items
        </Button>
      </DialogActions>
    </Dialog>
  );
}
