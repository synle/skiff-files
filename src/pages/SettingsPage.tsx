// Settings UI. Phase 1 ships Appearance + Default View + a Reset button. The
// remaining sections from TODO.md (Sidebar, Transfers, Connections, Keyboard,
// Advanced) join in their respective phases — each one becomes a Section
// child of this page rather than a separate route.
import {
  Box,
  Button,
  Dialog,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import {
  appDataDir,
  useSettings,
  type Settings,
} from "../state/settings";
import { fsOpenWithDefault, fsRevealInOs, getAppVersion } from "../api/fs";
import { SHORTCUT_GROUPS } from "../util/shortcuts";
import {
  activeCombo,
  formatCombo,
  keyEventToCombo,
} from "../util/keybindings";

/** Generic section wrapper so spacing stays consistent across groups. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Typography variant="h6">{title}</Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {description}
        </Typography>
      )}
      <Stack spacing={2}>{children}</Stack>
    </Box>
  );
}

/** Keyboard shortcut catalog with a search box. The catalog is short
 *  enough to render fully, but power users want to find a binding by
 *  the action name (e.g. "duplicate", "rename") without scanning the
 *  entire list. Filter is case-insensitive and matches both the keys
 *  column and the description. Empty groups (no matches) collapse. */
function KeyboardShortcutList() {
  const { settings, update } = useSettings();
  const [filter, setFilter] = useState("");
  const [recordingFor, setRecordingFor] = useState<string | null>(null);
  const q = filter.trim().toLowerCase();
  const groups = q
    ? SHORTCUT_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter(
          (it) =>
            it.keys.toLowerCase().includes(q) ||
            it.description.toLowerCase().includes(q),
        ),
      })).filter((g) => g.items.length > 0)
    : SHORTCUT_GROUPS;

  const updateOverride = (actionId: string, combo: string | null) => {
    const next = { ...settings.shortcutOverrides };
    if (combo === undefined) {
      delete next[actionId];
    } else {
      next[actionId] = combo;
    }
    update("shortcutOverrides", next);
  };
  const resetOverride = (actionId: string) => {
    const next = { ...settings.shortcutOverrides };
    delete next[actionId];
    update("shortcutOverrides", next);
  };

  const overrideCount = Object.keys(settings.shortcutOverrides).length;
  return (
    <Stack spacing={2}>
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        <TextField
          size="small"
          placeholder="Search shortcuts (e.g. tab, rename, font)…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          sx={{ flex: 1, maxWidth: 480 }}
        />
        <Button
          size="small"
          variant="outlined"
          disabled={overrideCount === 0}
          onClick={() => {
            const ok = window.confirm(
              `Reset ${overrideCount} keybinding${overrideCount === 1 ? "" : "s"} to their defaults?`,
            );
            if (ok) update("shortcutOverrides", {});
          }}
        >
          Reset all{overrideCount > 0 ? ` (${overrideCount})` : ""}
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary">
        Shortcuts marked with an Edit button are rebindable. The rest are
        documentation-only — their handlers will migrate to the rebindable
        framework in future releases.
      </Typography>
      {groups.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          No shortcuts match "{filter}".
        </Typography>
      ) : (
        groups.map((g) => (
          <Box key={g.title}>
            <Typography variant="overline" color="text.secondary">
              {g.title}
            </Typography>
            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
              {g.items.map((it) => {
                const rebindable = !!it.actionId && !!it.defaultCombo;
                const live = rebindable
                  ? activeCombo(
                      it.actionId!,
                      it.defaultCombo!,
                      settings.shortcutOverrides,
                    )
                  : null;
                const isOverridden =
                  rebindable &&
                  Object.prototype.hasOwnProperty.call(
                    settings.shortcutOverrides,
                    it.actionId!,
                  );
                return (
                  <Box
                    key={it.keys + it.description}
                    sx={{
                      display: "flex",
                      gap: 2,
                      alignItems: "center",
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        width: 220,
                        flexShrink: 0,
                        fontFamily: "monospace",
                        color: "text.primary",
                      }}
                    >
                      {rebindable
                        ? live === null
                          ? "(disabled)"
                          : formatCombo(live)
                        : it.keys}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ flex: 1 }}
                    >
                      {it.description}
                    </Typography>
                    {rebindable && (
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => setRecordingFor(it.actionId!)}
                        >
                          {recordingFor === it.actionId ? "Recording…" : "Edit"}
                        </Button>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() =>
                            updateOverride(it.actionId!, null)
                          }
                          disabled={live === null}
                        >
                          Disable
                        </Button>
                        {isOverridden && (
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => resetOverride(it.actionId!)}
                          >
                            Reset
                          </Button>
                        )}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Stack>
          </Box>
        ))
      )}
      <KeyRecorderDialog
        open={recordingFor != null}
        onClose={() => setRecordingFor(null)}
        onCommit={(combo) => {
          if (recordingFor) updateOverride(recordingFor, combo);
          setRecordingFor(null);
        }}
      />
    </Stack>
  );
}

/** Modal that captures the next non-modifier keypress and reports
 *  the canonical combo back. Esc cancels without committing. */
function KeyRecorderDialog({
  open,
  onClose,
  onCommit,
}: {
  open: boolean;
  onClose: () => void;
  onCommit: (combo: string) => void;
}) {
  const [captured, setCaptured] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setCaptured(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const combo = keyEventToCombo(e);
      if (!combo) return;
      e.preventDefault();
      setCaptured(combo);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <Box sx={{ p: 3, textAlign: "center" }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Press a key combination
        </Typography>
        <Typography
          variant="h6"
          sx={{
            fontFamily: "monospace",
            color: captured ? "text.primary" : "text.disabled",
            minHeight: 32,
          }}
        >
          {captured ? formatCombo(captured) : "—"}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 1 }}
        >
          Esc cancels. Press the same combo again to confirm.
        </Typography>
        <Box sx={{ mt: 2, display: "flex", justifyContent: "center", gap: 1 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!captured}
            onClick={() => captured && onCommit(captured)}
          >
            Save
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}

/** Settings → Advanced widget for the per-extension icon-kind
 *  override map. Adding "rs" → "code" makes Rust files render with
 *  the code icon even though the Rust-side detection doesn't know
 *  about them. Limited to a small preset of FileKind values that
 *  IconForKind actually has icons for. */
function CustomFileKindsEditor() {
  const { settings, update } = useSettings();
  const [extInput, setExtInput] = useState("");
  const [kindInput, setKindInput] = useState("code");
  const KINDS = [
    "text",
    "code",
    "markdown",
    "image",
    "audio",
    "video",
    "archive",
    "pdf",
    "spreadsheet",
    "document",
    "binary",
  ];
  const entries = Object.entries(settings.customFileKinds);
  const addOrReplace = () => {
    const ext = extInput.trim().toLowerCase().replace(/^\./, "");
    if (!ext) return;
    update("customFileKinds", {
      ...settings.customFileKinds,
      [ext]: kindInput,
    });
    setExtInput("");
  };
  const remove = (ext: string) => {
    const next = { ...settings.customFileKinds };
    delete next[ext];
    update("customFileKinds", next);
  };
  return (
    <Box>
      <Typography variant="subtitle2">Custom file-kind icons</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        Map an extension to a different icon kind. Useful when the
        built-in detection treats your favorite extension as binary.
      </Typography>
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1, flexWrap: "wrap" }}>
        <TextField
          size="small"
          placeholder="ext (e.g. rs)"
          value={extInput}
          onChange={(e) => setExtInput(e.target.value)}
          sx={{ maxWidth: 120 }}
        />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <Select
            value={kindInput}
            onChange={(e) => setKindInput(e.target.value)}
          >
            {KINDS.map((k) => (
              <MenuItem key={k} value={k}>
                {k}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button size="small" variant="outlined" onClick={addOrReplace}>
          Add / Replace
        </Button>
      </Box>
      {entries.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          No custom mappings.
        </Typography>
      ) : (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {entries.map(([ext, kind]) => (
            <Box
              key={ext}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                px: 1,
                py: 0.25,
              }}
            >
              <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                .{ext} → {kind}
              </Typography>
              <Button
                size="small"
                variant="text"
                onClick={() => remove(ext)}
                sx={{ minWidth: "auto", px: 0.5 }}
              >
                ×
              </Button>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** Settings → Saved data widget. Lists each saved-X type
 *  (workspaces, selection groups, searches) with rename + delete
 *  buttons. Closes the management gap — without this, deleting
 *  workspaces or selections has no UI surface, and renaming any
 *  is impossible after creation. */
function SavedDataEditor() {
  const { settings, update } = useSettings();

  const renameItem = <
    K extends "tabWorkspaces" | "savedSelections" | "savedSearches",
  >(
    key: K,
    id: string,
    current: string,
  ) => {
    const next = window.prompt("Rename:", current);
    if (next === null) return; // user cancelled
    const trimmed = next.trim();
    if (!trimmed) return;
    const list = settings[key] as Array<{ id: string; label: string }>;
    update(
      key,
      list.map((x) =>
        x.id === id ? { ...x, label: trimmed } : x,
      ) as Settings[K],
    );
  };
  const deleteItem = <
    K extends "tabWorkspaces" | "savedSelections" | "savedSearches",
  >(
    key: K,
    id: string,
    label: string,
  ) => {
    if (!window.confirm(`Delete "${label}"?`)) return;
    const list = settings[key] as Array<{ id: string }>;
    update(key, list.filter((x) => x.id !== id) as Settings[K]);
  };

  const Block = ({
    title,
    items,
    onRename,
    onDelete,
    secondary,
  }: {
    title: string;
    items: Array<{ id: string; label: string }>;
    onRename: (id: string, current: string) => void;
    onDelete: (id: string, label: string) => void;
    secondary?: (item: { id: string; label: string }) => string;
  }) => (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      {items.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          None saved yet.
        </Typography>
      ) : (
        <Stack spacing={0.5}>
          {items.map((it) => (
            <Box
              key={it.id}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                px: 1,
                py: 0.5,
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {it.label}
                </Typography>
                {secondary && (
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {secondary(it)}
                  </Typography>
                )}
              </Box>
              <Button
                size="small"
                variant="text"
                onClick={() => onRename(it.id, it.label)}
              >
                Rename
              </Button>
              <Button
                size="small"
                color="warning"
                variant="text"
                onClick={() => onDelete(it.id, it.label)}
              >
                Delete
              </Button>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );

  return (
    <Stack spacing={2}>
      <Block
        title={`Tab workspaces (${settings.tabWorkspaces.length})`}
        items={settings.tabWorkspaces}
        onRename={(id, current) => renameItem("tabWorkspaces", id, current)}
        onDelete={(id, label) => deleteItem("tabWorkspaces", id, label)}
        secondary={(it) => {
          const ws = settings.tabWorkspaces.find((x) => x.id === it.id);
          return ws ? `${ws.tabs.length} tab${ws.tabs.length === 1 ? "" : "s"}` : "";
        }}
      />
      <Block
        title={`Selection groups (${settings.savedSelections.length})`}
        items={settings.savedSelections}
        onRename={(id, current) => renameItem("savedSelections", id, current)}
        onDelete={(id, label) => deleteItem("savedSelections", id, label)}
        secondary={(it) => {
          const sel = settings.savedSelections.find((x) => x.id === it.id);
          return sel
            ? `${sel.paths.length} path${sel.paths.length === 1 ? "" : "s"}`
            : "";
        }}
      />
      <Block
        title={`Saved searches (${settings.savedSearches.length})`}
        items={settings.savedSearches}
        onRename={(id, current) => renameItem("savedSearches", id, current)}
        onDelete={(id, label) => deleteItem("savedSearches", id, label)}
        secondary={(it) => {
          const s = settings.savedSearches.find((x) => x.id === it.id);
          if (!s) return "";
          const flags = [
            s.regex ? "regex" : null,
            s.caseSensitive ? "case" : null,
            s.recursive ? "recursive" : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return flags ? `${s.query} · ${flags}` : s.query;
        }}
      />
    </Stack>
  );
}

export default function SettingsPage() {
  console.log("[SettingsPage] rendering");
  const { settings, setSettings, update, reset } = useSettings();
  // Build version pulled from Cargo at compile time, surfaced via
  // `get_app_version` Tauri command. Tests / browser-mode dev see
  // the fallback string.
  const [version, setVersion] = useState<string>("unknown");
  useEffect(() => {
    getAppVersion()
      .then(setVersion)
      .catch(() => setVersion("unknown"));
  }, []);

  return (
    <Box sx={{ flex: 1, p: 3, overflow: "auto" }}>
      <Box sx={{ maxWidth: 720, mx: "auto" }}>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
        Skiff Files v{version}
      </Typography>

      <Stack spacing={4}>
        <Section
          title="Appearance"
          description="Theme follows your operating system by default."
        >
          <FormControl size="small" sx={{ maxWidth: 240 }}>
            <InputLabel id="theme-mode-label">Theme</InputLabel>
            <Select
              labelId="theme-mode-label"
              label="Theme"
              value={settings.themeMode}
              onChange={(e) =>
                update("themeMode", e.target.value as typeof settings.themeMode)
              }
            >
              <MenuItem value="system">System</MenuItem>
              <MenuItem value="light">Light</MenuItem>
              <MenuItem value="dark">Dark</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ maxWidth: 240 }}>
            <InputLabel id="font-size-label">Font size</InputLabel>
            <Select
              labelId="font-size-label"
              label="Font size"
              value={settings.fontSize}
              onChange={(e) =>
                update("fontSize", e.target.value as typeof settings.fontSize)
              }
            >
              <MenuItem value="small">Small</MenuItem>
              <MenuItem value="medium">Medium</MenuItem>
              <MenuItem value="large">Large</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ maxWidth: 240 }}>
            <InputLabel id="density-label">Density</InputLabel>
            <Select
              labelId="density-label"
              label="Density"
              value={settings.density}
              onChange={(e) =>
                update("density", e.target.value as typeof settings.density)
              }
            >
              <MenuItem value="comfortable">Comfortable</MenuItem>
              <MenuItem value="compact">Compact</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ maxWidth: 240 }}>
            <InputLabel id="date-format-label">Date format</InputLabel>
            <Select
              labelId="date-format-label"
              label="Date format"
              value={settings.dateFormat}
              onChange={(e) =>
                update(
                  "dateFormat",
                  e.target.value as typeof settings.dateFormat,
                )
              }
            >
              <MenuItem value="locale">Locale (default)</MenuItem>
              <MenuItem value="iso">ISO-8601 (sortable)</MenuItem>
              <MenuItem value="short">Short (YYYY-MM-DD HH:mm)</MenuItem>
              <MenuItem value="relative">Relative (5m ago)</MenuItem>
            </Select>
          </FormControl>

          <FormControlLabel
            control={
              <Switch
                checked={settings.showFullPathInTitle}
                onChange={(e) =>
                  update("showFullPathInTitle", e.target.checked)
                }
              />
            }
            label="Show full path in window title"
          />

          <FormControlLabel
            control={
              <Switch
                checked={settings.alwaysOnTop}
                onChange={(e) => update("alwaysOnTop", e.target.checked)}
              />
            }
            label="Keep window always on top"
          />

          <FormControlLabel
            control={
              <Switch
                checked={settings.reduceMotion}
                onChange={(e) => update("reduceMotion", e.target.checked)}
              />
            }
            label="Reduce motion (also auto-detects from OS)"
          />

          <FormControlLabel
            control={
              <Switch
                checked={settings.showStatusBar}
                onChange={(e) => update("showStatusBar", e.target.checked)}
              />
            }
            label="Show status bar"
          />

          <TextField
            label="Default start path"
            size="small"
            value={settings.startPath}
            onChange={(e) => update("startPath", e.target.value)}
            placeholder="(empty = home directory)"
            helperText="Where new tabs / launches open. Leave blank to use the home directory."
            sx={{ maxWidth: 480 }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={settings.openNewTabAtCurrent}
                onChange={(e) =>
                  update("openNewTabAtCurrent", e.target.checked)
                }
              />
            }
            label="New tabs open at the active tab's path (instead of home)"
          />

          <FormControlLabel
            control={
              <Switch
                checked={settings.twoPaneMode}
                onChange={(e) => update("twoPaneMode", e.target.checked)}
              />
            }
            label="Two-pane mode (split view, FileZilla-style — Cmd/Ctrl+\\ toggles)"
          />

          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2">Custom palette</Typography>
          <Typography variant="caption" color="text.secondary">
            Override the built-in light / dark palettes. Leave a slot empty
            to inherit the default for that color.
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={settings.useCustomTheme}
                onChange={(e) => update("useCustomTheme", e.target.checked)}
              />
            }
            label="Use my custom palette"
          />

          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                update("customLightPalette", {
                  primaryMain: "#268bd2",
                  backgroundDefault: "#fdf6e3",
                  backgroundPaper: "#eee8d5",
                  textPrimary: "#586e75",
                  textSecondary: "#657b83",
                });
                update("customDarkPalette", {
                  primaryMain: "#268bd2",
                  backgroundDefault: "#002b36",
                  backgroundPaper: "#073642",
                  textPrimary: "#93a1a1",
                  textSecondary: "#839496",
                });
                update("useCustomTheme", true);
              }}
            >
              Solarized
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                update("customDarkPalette", {
                  primaryMain: "#bd93f9",
                  backgroundDefault: "#282a36",
                  backgroundPaper: "#383a59",
                  textPrimary: "#f8f8f2",
                  textSecondary: "#bfbfbf",
                });
                update("customLightPalette", {
                  primaryMain: "#bd93f9",
                  backgroundDefault: "#f8f8f2",
                  backgroundPaper: "#ffffff",
                  textPrimary: "#282a36",
                  textSecondary: "#44475a",
                });
                update("useCustomTheme", true);
              }}
            >
              Dracula
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                update("customDarkPalette", {
                  primaryMain: "#88c0d0",
                  backgroundDefault: "#2e3440",
                  backgroundPaper: "#3b4252",
                  textPrimary: "#eceff4",
                  textSecondary: "#d8dee9",
                });
                update("customLightPalette", {
                  primaryMain: "#5e81ac",
                  backgroundDefault: "#eceff4",
                  backgroundPaper: "#e5e9f0",
                  textPrimary: "#2e3440",
                  textSecondary: "#3b4252",
                });
                update("useCustomTheme", true);
              }}
            >
              Nord
            </Button>
            <Button
              size="small"
              variant="text"
              onClick={() => {
                update("customLightPalette", {
                  primaryMain: "",
                  backgroundDefault: "",
                  backgroundPaper: "",
                  textPrimary: "",
                  textSecondary: "",
                });
                update("customDarkPalette", {
                  primaryMain: "",
                  backgroundDefault: "",
                  backgroundPaper: "",
                  textPrimary: "",
                  textSecondary: "",
                });
              }}
            >
              Reset palette
            </Button>
          </Box>

          {(["customLightPalette", "customDarkPalette"] as const).map((key) => (
            <Box key={key}>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                {key === "customLightPalette" ? "Light mode" : "Dark mode"}
              </Typography>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                {(
                  [
                    ["primaryMain", "Primary"],
                    ["backgroundDefault", "Background"],
                    ["backgroundPaper", "Paper"],
                    ["textPrimary", "Text"],
                    ["textSecondary", "Text dim"],
                  ] as const
                ).map(([slot, label]) => {
                  const value = settings[key][slot] || "";
                  return (
                    <Box key={slot} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <input
                        type="color"
                        value={value || "#000000"}
                        onChange={(e) =>
                          update(key, {
                            ...settings[key],
                            [slot]: e.target.value,
                          })
                        }
                        style={{ width: 32, height: 32, padding: 0, border: "none", background: "none" }}
                      />
                      <Typography variant="caption">{label}</Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ))}
        </Section>

        <Divider />

        <Section
          title="Default view"
          description="Used for folders without a saved per-folder preference."
        >
          <FormControl size="small" sx={{ maxWidth: 240 }}>
            <InputLabel id="view-mode-label">View mode</InputLabel>
            <Select
              labelId="view-mode-label"
              label="View mode"
              value={settings.defaultView}
              onChange={(e) =>
                update("defaultView", e.target.value as typeof settings.defaultView)
              }
            >
              <MenuItem value="list">List</MenuItem>
              <MenuItem value="tile">Tile</MenuItem>
              <MenuItem value="gallery">Gallery</MenuItem>
              <MenuItem value="column">Column</MenuItem>
            </Select>
          </FormControl>

          <Stack direction="row" spacing={2}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="default-sort-key-label">Default sort</InputLabel>
              <Select
                labelId="default-sort-key-label"
                label="Default sort"
                value={settings.defaultSortKey}
                onChange={(e) =>
                  update(
                    "defaultSortKey",
                    e.target.value as typeof settings.defaultSortKey,
                  )
                }
              >
                <MenuItem value="name">Name</MenuItem>
                <MenuItem value="size">Size</MenuItem>
                <MenuItem value="mtime">Modified</MenuItem>
                <MenuItem value="ctime">Created</MenuItem>
                <MenuItem value="kind">Kind</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel id="default-sort-dir-label">Direction</InputLabel>
              <Select
                labelId="default-sort-dir-label"
                label="Direction"
                value={settings.defaultSortDir}
                onChange={(e) =>
                  update(
                    "defaultSortDir",
                    e.target.value as typeof settings.defaultSortDir,
                  )
                }
              >
                <MenuItem value="asc">Ascending</MenuItem>
                <MenuItem value="desc">Descending</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <FormControlLabel
            control={
              <Switch
                checked={settings.groupFoldersFirst}
                onChange={(e) =>
                  update("groupFoldersFirst", e.target.checked)
                }
              />
            }
            label="Group folders before files"
          />

          <Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              List view columns
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {(["size", "modified", "kind"] as const).map((col) => (
                <FormControlLabel
                  key={col}
                  control={
                    <Switch
                      checked={!settings.hideColumns[col]}
                      onChange={(e) =>
                        update("hideColumns", {
                          ...settings.hideColumns,
                          [col]: !e.target.checked,
                        })
                      }
                    />
                  }
                  label={col.charAt(0).toUpperCase() + col.slice(1)}
                />
              ))}
            </Box>
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={settings.showHidden}
                onChange={(e) => update("showHidden", e.target.checked)}
              />
            }
            label="Show hidden files (dotfiles)"
          />

          <FormControlLabel
            control={
              <Switch
                checked={settings.hideSystemFiles}
                onChange={(e) => update("hideSystemFiles", e.target.checked)}
              />
            }
            label="Hide system files (.DS_Store, Thumbs.db, desktop.ini)"
          />

          <FormControl size="small" sx={{ maxWidth: 280 }}>
            <InputLabel id="show-ext-label">Show file extensions</InputLabel>
            <Select
              labelId="show-ext-label"
              label="Show file extensions"
              value={settings.showExtensions}
              onChange={(e) =>
                update(
                  "showExtensions",
                  e.target.value as typeof settings.showExtensions,
                )
              }
            >
              <MenuItem value="always">Always</MenuItem>
              <MenuItem value="never">Never</MenuItem>
              <MenuItem value="whenAmbiguous">When ambiguous</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ maxWidth: 240 }}>
            <InputLabel id="preview-mode-label">Preview pane</InputLabel>
            <Select
              labelId="preview-mode-label"
              label="Preview pane"
              value={settings.previewMode}
              onChange={(e) =>
                update(
                  "previewMode",
                  e.target.value as typeof settings.previewMode,
                )
              }
            >
              <MenuItem value="off">Off</MenuItem>
              <MenuItem value="imagesOnly">Images only</MenuItem>
              <MenuItem value="always">Always show</MenuItem>
            </Select>
          </FormControl>
        </Section>

        <Divider />

        <Section
          title="Sidebar"
          description="Hide sections you never use. Hidden sections drop both their header and contents."
        >
          <FormControlLabel
            control={
              <Switch
                checked={settings.sidebarAccordion}
                onChange={(e) =>
                  update("sidebarAccordion", e.target.checked)
                }
              />
            }
            label="Accordion mode (only one section open at a time)"
          />

          <FormControlLabel
            control={
              <Switch
                checked={settings.sidebarShowStatusDots}
                onChange={(e) =>
                  update("sidebarShowStatusDots", e.target.checked)
                }
              />
            }
            label="Show connection-status dots"
          />

          <TextField
            label="Recent paths cap"
            size="small"
            type="number"
            value={settings.recentPathsMax}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              update("recentPathsMax", Math.max(0, Math.min(50, Math.floor(n))));
            }}
            helperText="0 disables recent-path tracking. Sidebar shows up to 5 entries from the head."
            sx={{ maxWidth: 240 }}
          />

          {(
            [
              "favorites",
              "bookmarks",
              "workspaces",
              "searches",
              "recent",
              "hosts",
              "devices",
            ] as const
          ).map((id) => {
              const labels = {
                favorites: "Favorites",
                bookmarks: "Bookmarks",
                workspaces: "Workspaces",
                searches: "Searches",
                recent: "Recent",
                hosts: "Hosts",
                devices: "Devices",
              };
              const visible = settings.sidebarSectionsVisible[id] !== false;
              return (
                <FormControlLabel
                  key={id}
                  control={
                    <Switch
                      checked={visible}
                      onChange={(e) =>
                        update("sidebarSectionsVisible", {
                          ...settings.sidebarSectionsVisible,
                          [id]: e.target.checked,
                        })
                      }
                    />
                  }
                  label={`Show ${labels[id]}`}
                />
              );
            },
          )}

          {settings.hiddenFavorites.length > 0 && (
            <Box sx={{ pt: 1 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Hidden favorites: {settings.hiddenFavorites.join(", ")}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                onClick={() => update("hiddenFavorites", [])}
              >
                Restore all hidden favorites
              </Button>
            </Box>
          )}
        </Section>

        <Divider />

        <Section
          title="Saved data"
          description="Review and clean up the named items you've saved (workspaces, selections, searches)."
        >
          <SavedDataEditor />
        </Section>

        <Divider />

        <Section
          title="Transfers"
          description="Defaults applied to new Skiffsync jobs. Saved templates keep their own values regardless."
        >
          <FormControl size="small" sx={{ maxWidth: 280 }}>
            <InputLabel id="sync-conflict-label">Conflict policy</InputLabel>
            <Select
              labelId="sync-conflict-label"
              label="Conflict policy"
              value={settings.syncDefaultConflictPolicy}
              onChange={(e) =>
                update(
                  "syncDefaultConflictPolicy",
                  e.target.value as typeof settings.syncDefaultConflictPolicy,
                )
              }
            >
              <MenuItem value="skip">Skip</MenuItem>
              <MenuItem value="overwrite">Overwrite</MenuItem>
              <MenuItem value="keepBoth">Keep both</MenuItem>
              <MenuItem value="overwriteOlder">Overwrite older</MenuItem>
              <MenuItem value="replaceSmaller">Replace smaller</MenuItem>
              <MenuItem value="replaceIfSizeDifferent">
                Replace if size differs
              </MenuItem>
              <MenuItem value="renameTarget">Rename target</MenuItem>
              <MenuItem value="renameOlderTarget">
                Rename older target
              </MenuItem>
              <MenuItem value="prompt">Ask each time…</MenuItem>
            </Select>
          </FormControl>

          <TextField
            label="Max size (GB)"
            size="small"
            type="number"
            value={settings.syncDefaultMaxSizeGb}
            onChange={(e) =>
              update(
                "syncDefaultMaxSizeGb",
                Math.max(1, Number(e.target.value) || 1),
              )
            }
            sx={{ maxWidth: 180 }}
          />
          <TextField
            label="Lookback days"
            size="small"
            type="number"
            value={settings.syncDefaultLookbackDays}
            onChange={(e) =>
              update(
                "syncDefaultLookbackDays",
                Math.max(0, Number(e.target.value) || 0),
              )
            }
            sx={{ maxWidth: 180 }}
          />
          <TextField
            label="Bandwidth cap (KB/s)"
            size="small"
            type="number"
            value={settings.syncDefaultBandwidthKbps}
            onChange={(e) =>
              update(
                "syncDefaultBandwidthKbps",
                Math.max(0, Number(e.target.value) || 0),
              )
            }
            helperText="0 = unlimited. Local-to-local jobs skip the kernel-accelerated copy when this is set."
            sx={{ maxWidth: 240 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={settings.syncDefaultVerifyAfterCopy}
                onChange={(e) =>
                  update("syncDefaultVerifyAfterCopy", e.target.checked)
                }
              />
            }
            label="Verify after copy (re-stat dest size)"
          />

          <FormControlLabel
            control={
              <Switch
                checked={settings.syncSuppressConflictPrompts}
                onChange={(e) =>
                  update("syncSuppressConflictPrompts", e.target.checked)
                }
              />
            }
            label="Never show conflict prompt (auto-skip)"
          />
        </Section>

        <Divider />

        <Section
          title="Keyboard"
          description="Read-only listing of every shortcut the app honors. Press ? anywhere to open this as an overlay. Rebinding lands in a future release."
        >
          <KeyboardShortcutList />
        </Section>

        <Divider />

        <Section
          title="Advanced"
          description="Reveal the on-disk settings file or wipe everything back to defaults."
        >
          <CustomFileKindsEditor />
          <FormControl size="small" sx={{ maxWidth: 240 }}>
            <InputLabel id="log-level-label">Log level</InputLabel>
            <Select
              labelId="log-level-label"
              label="Log level"
              value={settings.logLevel}
              onChange={(e) =>
                update("logLevel", e.target.value as typeof settings.logLevel)
              }
            >
              <MenuItem value="off">Off</MenuItem>
              <MenuItem value="error">Error</MenuItem>
              <MenuItem value="warn">Warn</MenuItem>
              <MenuItem value="info">Info</MenuItem>
              <MenuItem value="debug">Debug</MenuItem>
            </Select>
          </FormControl>

          <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
            <Button
              variant="outlined"
              size="small"
              onClick={async () => {
                const dir = await appDataDir();
                if (dir) {
                  void fsRevealInOs(dir);
                }
              }}
            >
              Reveal app data folder
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                // Until the Tauri updater is wired (needs signing
                // keys), the in-app shortcut to "check for updates"
                // is a hand-off to the GitHub Releases page. Routes
                // through the existing `fs_open_with_default` Tauri
                // command, which uses the `open` crate — works for
                // URLs as well as files. URL is hard-coded, no
                // injection risk.
                void fsOpenWithDefault(
                  "https://github.com/synle/skiff-files/releases",
                );
              }}
            >
              Check for updates
            </Button>
            <Button
              variant="outlined"
              size="small"
              disabled={settings.recentPaths.length === 0}
              onClick={() => update("recentPaths", [])}
            >
              Clear recent paths
              {settings.recentPaths.length > 0
                ? ` (${settings.recentPaths.length})`
                : ""}
            </Button>
            <Button
              variant="outlined"
              size="small"
              disabled={settings.bookmarks.length === 0}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete all ${settings.bookmarks.length} bookmark${settings.bookmarks.length === 1 ? "" : "s"}?`,
                  )
                ) {
                  update("bookmarks", []);
                }
              }}
            >
              Clear bookmarks
              {settings.bookmarks.length > 0
                ? ` (${settings.bookmarks.length})`
                : ""}
            </Button>
            <Button
              variant="outlined"
              color="warning"
              size="small"
              disabled={settings.searchHistory.length === 0}
              onClick={() => {
                if (
                  window.confirm(
                    `Clear ${settings.searchHistory.length} search ${settings.searchHistory.length === 1 ? "query" : "queries"}?`,
                  )
                ) {
                  update("searchHistory", []);
                }
              }}
            >
              Clear search history
              {settings.searchHistory.length > 0
                ? ` (${settings.searchHistory.length})`
                : ""}
            </Button>
            <Button
              variant="outlined"
              size="small"
              disabled={settings.bookmarks.length === 0}
              onClick={() => {
                if (
                  typeof navigator !== "undefined" &&
                  navigator.clipboard
                ) {
                  void navigator.clipboard.writeText(
                    JSON.stringify(settings.bookmarks, null, 2),
                  );
                }
              }}
            >
              Export bookmarks (clipboard)
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                if (
                  typeof navigator !== "undefined" &&
                  navigator.clipboard
                ) {
                  // Whole settings round-trip: useful for cross-
                  // machine sync via a dotfile repo or Slack paste.
                  // We export the WHOLE settings object — the
                  // bookmarks-only export above is kept for users
                  // who only want to share that subset.
                  void navigator.clipboard.writeText(
                    JSON.stringify(settings, null, 2),
                  );
                }
              }}
            >
              Export all settings (clipboard)
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                const raw = window.prompt(
                  "Paste settings JSON. Replaces ALL current settings:",
                );
                if (!raw) return;
                try {
                  const parsed = JSON.parse(raw) as unknown;
                  if (
                    typeof parsed !== "object" ||
                    parsed === null ||
                    Array.isArray(parsed)
                  ) {
                    window.alert("Settings JSON must be an object.");
                    return;
                  }
                  if (
                    !window.confirm(
                      "Replace ALL current settings with the pasted JSON? This drops your bookmarks, recent paths, saved tabs, theme, and every other persisted tweak.",
                    )
                  ) {
                    return;
                  }
                  // Merge against the current settings so any keys
                  // the JSON omits keep their current values rather
                  // than reverting to DEFAULTS — friendlier when the
                  // user only wanted to share a subset of fields.
                  // Goes through setSettings (not update) so the
                  // whole-object swap is one persist tick instead of
                  // N piecemeal writes.
                  setSettings({
                    ...settings,
                    ...(parsed as Partial<typeof settings>),
                  });
                } catch (e) {
                  window.alert(`Couldn't parse JSON: ${String(e)}`);
                }
              }}
            >
              Import all settings (paste JSON)
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                // Paste back the JSON to merge into the current
                // bookmark list. Validates shape minimally — entries
                // need string `id`, `label`, and `path`. New entries
                // get fresh ids so collisions across machines don't
                // overwrite. Existing paths are skipped to keep the
                // operation idempotent.
                const raw = window.prompt(
                  "Paste bookmarks JSON (array). Existing paths are skipped:",
                );
                if (!raw) return;
                try {
                  const parsed = JSON.parse(raw) as unknown;
                  if (!Array.isArray(parsed)) {
                    window.alert("Bookmarks JSON must be an array.");
                    return;
                  }
                  const existing = new Set(
                    settings.bookmarks.map((b) => b.path),
                  );
                  const incoming = parsed
                    .filter(
                      (e): e is { id?: string; label: string; path: string } =>
                        typeof e === "object" &&
                        e !== null &&
                        typeof (e as Record<string, unknown>).label ===
                          "string" &&
                        typeof (e as Record<string, unknown>).path === "string",
                    )
                    .filter((e) => !existing.has(e.path))
                    .map((e) => ({
                      id: crypto.randomUUID(),
                      label: e.label,
                      path: e.path,
                    }));
                  if (incoming.length === 0) {
                    window.alert("No new bookmarks to import.");
                    return;
                  }
                  update("bookmarks", [...settings.bookmarks, ...incoming]);
                } catch (e) {
                  window.alert(`Couldn't parse JSON: ${String(e)}`);
                }
              }}
            >
              Import bookmarks (paste JSON)
            </Button>
            <Button
              variant="outlined"
              size="small"
              disabled={
                Object.keys(settings.folderViewMode).length === 0 &&
                Object.keys(settings.folderSort).length === 0
              }
              onClick={() => {
                const total =
                  Object.keys(settings.folderViewMode).length +
                  Object.keys(settings.folderSort).length;
                if (
                  window.confirm(
                    `Forget per-folder view + sort overrides for ${total} folder${total === 1 ? "" : "s"}?`,
                  )
                ) {
                  update("folderViewMode", {});
                  update("folderSort", {});
                }
              }}
            >
              Forget per-folder overrides
            </Button>
            <Button
              variant="outlined"
              color="warning"
              onClick={() => {
                // Confirm before nuking — this drops every persisted
                // tweak (theme, sort defaults, bookmarks, recent
                // paths, saved tabs) which is hard to recover from.
                const ok = window.confirm(
                  "Reset all settings to defaults? This drops your bookmarks, recent paths, saved tabs, and all per-folder overrides.",
                );
                if (ok) reset();
              }}
              size="small"
            >
              Reset all settings
            </Button>
          </Box>
        </Section>
      </Stack>
      </Box>
    </Box>
  );
}
