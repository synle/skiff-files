// Keyboard cheatsheet — opens on `?` (when no input is focused). Lists
// the bindings the rest of the app already implements; this modal is
// pure documentation, not a key router.
//
// Phase 6 will let users rebind keys; until then the cheatsheet is the
// canonical reference and lives next to the code that implements each
// binding so they don't drift.
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
import { useEffect, useState } from "react";

interface Shortcut {
  /** Plain-language label rendered on the left. */
  keys: string;
  /** What the shortcut does. */
  description: string;
}

interface Group {
  title: string;
  items: Shortcut[];
}

/** The canonical list of bindings. Order matches frequency-of-use. */
const GROUPS: Group[] = [
  {
    title: "Navigation",
    items: [
      { keys: "↑ / ↓", description: "Move focus up / down" },
      { keys: "Enter", description: "Open the focused folder" },
      { keys: "Space", description: "Toggle the focused row's selection" },
      { keys: "Backspace", description: "Go up one folder" },
      { keys: "Home / End", description: "Jump to first / last entry" },
    ],
  },
  {
    title: "Selection",
    items: [
      { keys: "Click", description: "Select one entry (replaces selection)" },
      { keys: "Cmd / Ctrl + Click", description: "Toggle entry in selection" },
      { keys: "Cmd / Ctrl + A", description: "Select all" },
      { keys: "Esc", description: "Clear selection" },
    ],
  },
  {
    title: "View",
    items: [
      { keys: "Cmd / Ctrl + B", description: "Toggle sidebar" },
      { keys: "Cmd / Ctrl + I", description: "Toggle preview pane" },
      { keys: "Cmd / Ctrl + R · F5", description: "Refresh current folder" },
      { keys: "Cmd / Ctrl + L", description: "Edit path (focus path bar)" },
      { keys: "Cmd / Ctrl + K", description: "Quick-jump (bookmarks + recent)" },
      { keys: "Cmd / Ctrl + Shift + N", description: "New folder" },
      { keys: "F2", description: "Rename selected entry" },
    ],
  },
  {
    title: "Help",
    items: [
      { keys: "?", description: "Show this cheatsheet" },
      { keys: "Esc", description: "Close this cheatsheet" },
    ],
  },
];

/** Listens for `?` (Shift+/) anywhere in the document and toggles the
 *  modal — but only when the active element isn't an input or
 *  contenteditable, so users typing `?` into the path bar / connection
 *  form don't get hijacked. */
export default function ShortcutsModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        t?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      maxWidth="sm"
      fullWidth
      aria-label="Keyboard shortcuts"
    >
      <DialogTitle
        sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        Keyboard shortcuts
        <IconButton
          onClick={() => setOpen(false)}
          size="small"
          aria-label="Close shortcuts"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3}>
          {GROUPS.map((g) => (
            <Box key={g.title}>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ display: "block", mb: 0.5 }}
              >
                {g.title}
              </Typography>
              <Stack spacing={0.5}>
                {g.items.map((s) => (
                  <Box
                    key={s.keys + s.description}
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "200px 1fr",
                      gap: 2,
                      fontSize: "0.875rem",
                    }}
                  >
                    <Box
                      component="kbd"
                      sx={{
                        fontFamily: "monospace",
                        bgcolor: "action.hover",
                        px: 1,
                        borderRadius: 0.5,
                        fontSize: "0.8125rem",
                      }}
                    >
                      {s.keys}
                    </Box>
                    <Typography variant="body2">{s.description}</Typography>
                  </Box>
                ))}
              </Stack>
            </Box>
          ))}
          <Typography variant="caption" color="text.secondary">
            Bindings are fixed in this build — Phase 6 will let you rebind
            them in Settings → Keyboard.
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
