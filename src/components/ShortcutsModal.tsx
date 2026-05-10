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
import { SHORTCUT_GROUPS } from "../util/shortcuts";
import { activeCombo, matchesCombo } from "../util/keybindings";
import { useSettings } from "../state/settings";

// Shortcuts source-of-truth lives in `util/shortcuts.ts` so the
// Settings → Keyboard listing renders the same data.
const GROUPS = SHORTCUT_GROUPS;

/** Listens for `?` (Shift+/) anywhere in the document and toggles the
 *  modal — but only when the active element isn't an input or
 *  contenteditable, so users typing `?` into the path bar / connection
 *  form don't get hijacked. */
export default function ShortcutsModal() {
  const [open, setOpen] = useState(false);
  const { settings } = useSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Two ways to open the cheatsheet:
      //   1. The user-rebindable `app.cheatsheet` action (defaults to
      //      Shift+/, i.e. `?`).
      //   2. F1, always — Windows / web-app convention. We hardcode
      //      F1 because users coming from those platforms expect it
      //      regardless of any `app.cheatsheet` rebind.
      const isF1 = e.key === "F1";
      const isCombo = matchesCombo(
        e,
        activeCombo("app.cheatsheet", "shift+/", settings.shortcutOverrides),
      );
      if (!isF1 && !isCombo) return;
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
  }, [settings.shortcutOverrides]);

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
