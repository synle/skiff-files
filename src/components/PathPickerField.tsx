// Reusable filesystem path input: a text field paired with a Browse
// button that opens the OS-native file/folder picker (Tauri's
// `plugin-dialog`). The component runs a debounced existence check
// against the typed value via `fsStat` and surfaces a warning when
// the path doesn't resolve, so users don't end up submitting a
// typo'd `~/.ssh/id_rsaa` and waiting for the connect to fail in a
// confusing place.
//
// Designed to be drop-in for any future path input — currently used
// by `RemoteConnectDialog` for SSH key path, but the API is generic
// so we can reuse it for custom-app overrides, default download
// folders, etc.

import { useEffect, useState } from "react";
import {
  Box,
  CircularProgress,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
} from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import { fsStat } from "../api/fs";

/** Validation states the field surfaces below the input. */
type ValidationState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok" }
  | { kind: "missing" };

interface Props {
  /** Field label (TextField `label`). */
  label: string;
  /** Current value (typed path). The component is fully controlled —
   *  the parent owns the state so it can submit it as part of a
   *  larger form. */
  value: string;
  /** Called on every keystroke + on a Browse-button selection. */
  onChange: (v: string) => void;
  /** Mode for the picker. `"file"` → open-file dialog (single file
   *  selection). `"directory"` → open-folder dialog. Defaults to
   *  `"file"`. */
  mode?: "file" | "directory";
  /** HTML5 `required` flag. Surfaces the browser's "Please fill in
   *  this field" tooltip on form submit when empty. */
  required?: boolean;
  /** Optional helper text shown below the input when there's no
   *  active validation message (existence-OK or empty input). */
  helperText?: string;
  /** Optional placeholder shown inside the input when empty. */
  placeholder?: string;
  /** Disable the entire field — text input AND Browse button. Used
   *  by the connect dialog while a connect is in flight. */
  disabled?: boolean;
  /** Optional file-type filters for the Browse picker. Mirrors the
   *  shape Tauri's `open` plugin expects:
   *  `[{ name: "SSH keys", extensions: ["pem", "key"] }]`. Ignored in
   *  directory mode. */
  filters?: { name: string; extensions: string[] }[];
  /** Forwarded to the underlying TextField — lets the dialog wrap
   *  the field in its own grid / Stack without an extra Box. */
  sx?: import("@mui/material").TextFieldProps["sx"];
}

/** Tilde + env expansion is intentionally NOT done here — `fsStat`
 *  on the Rust side already accepts `~`-prefixed paths via the
 *  existing canonicalize logic. Keeping it raw means what the user
 *  typed is what we submit. */
function debounce<T extends (...args: never[]) => void>(
  fn: T,
  ms: number,
): T & { cancel: () => void } {
  let h: ReturnType<typeof setTimeout> | null = null;
  const out = ((...args: Parameters<T>) => {
    if (h) clearTimeout(h);
    h = setTimeout(() => fn(...args), ms);
  }) as T & { cancel: () => void };
  out.cancel = () => {
    if (h) clearTimeout(h);
    h = null;
  };
  return out;
}

export default function PathPickerField({
  label,
  value,
  onChange,
  mode = "file",
  required,
  helperText,
  placeholder,
  disabled,
  filters,
  sx,
}: Props) {
  const [validation, setValidation] = useState<ValidationState>({ kind: "idle" });

  // Debounce existence check so we don't fire fsStat on every
  // keystroke (which would also race itself for the result and
  // produce a flickering warning).
  useEffect(() => {
    if (!value) {
      setValidation({ kind: "idle" });
      return;
    }
    setValidation({ kind: "checking" });
    const probe = debounce(() => {
      // Don't capture `value` in a stale closure — read it back via
      // a fresh ref through the inner async invocation. (Effects
      // re-run on `value` change, so the IIFE below sees the right
      // one; this is just a guard against later refactors that
      // hoist the debouncer out of useEffect.)
      void (async () => {
        try {
          await fsStat(value);
          setValidation({ kind: "ok" });
        } catch {
          // Anything from "not found" to "permission denied" to
          // "remote path passed to a local stat" surfaces as
          // "missing" — the message stays generic so we don't
          // contradict ourselves on edge cases.
          setValidation({ kind: "missing" });
        }
      })();
    }, 350);
    probe();
    return () => probe.cancel();
  }, [value]);

  /** Open the OS-native picker via `plugin-dialog`. Falls back to a
   *  no-op outside Tauri (browser dev mode) so the field still
   *  works as a plain text input there. */
  const browse = async () => {
    try {
      const dialog = await import("@tauri-apps/plugin-dialog");
      const picked = await dialog.open({
        multiple: false,
        directory: mode === "directory",
        filters: mode === "file" ? filters : undefined,
      });
      // `open` returns string | string[] | null. We always pass
      // multiple:false so we expect string | null.
      if (typeof picked === "string" && picked.length > 0) {
        onChange(picked);
      }
    } catch {
      /* outside Tauri / user cancelled — silent */
    }
  };

  // Pick the helper text shown under the field. Validation messages
  // win over the parent-supplied `helperText` because they're
  // actionable — the parent's hint stays visible only when nothing
  // is being said about validity yet.
  const showWarning = validation.kind === "missing";
  const effectiveHelper =
    validation.kind === "missing"
      ? `Path doesn't exist — ${mode === "directory" ? "pick a folder" : "double-check the path or pick a file"}`
      : validation.kind === "checking"
        ? "Checking…"
        : helperText;

  return (
    <TextField
      size="small"
      label={label}
      required={required}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      // The browser's red required-asterisk turns "missing" into the
      // error color too — that's fine; the message is what
      // communicates the cause.
      error={showWarning}
      // We deliberately use the *warning* tone for "doesn't exist"
      // by styling the helper text. Hard-error red is reserved for
      // hard form-submit blockers; missing-path is recoverable
      // (user might be about to type more characters).
      color={showWarning ? "warning" : undefined}
      helperText={effectiveHelper}
      sx={sx}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              {validation.kind === "checking" && (
                <Box sx={{ mr: 0.5, display: "inline-flex" }}>
                  <CircularProgress size={14} thickness={5} />
                </Box>
              )}
              <Tooltip
                title={mode === "directory" ? "Choose folder…" : "Choose file…"}
              >
                <span>
                  <IconButton
                    size="small"
                    edge="end"
                    onClick={browse}
                    disabled={disabled}
                    aria-label={
                      mode === "directory" ? "Browse for folder" : "Browse for file"
                    }
                  >
                    <FolderOpenIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
