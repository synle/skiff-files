// Settings UI. Phase 1 ships Appearance + Default View + a Reset button. The
// remaining sections from TODO.md (Sidebar, Transfers, Connections, Keyboard,
// Advanced) join in their respective phases — each one becomes a Section
// child of this page rather than a separate route.
import {
  Box,
  Button,
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
import { appDataDir, useSettings } from "../state/settings";
import { fsRevealInOs } from "../api/fs";

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

export default function SettingsPage() {
  const { settings, update, reset } = useSettings();

  return (
    <Box sx={{ p: 3, overflow: "auto", maxWidth: 720 }}>
      <Typography variant="h4" gutterBottom>
        Settings
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
                checked={settings.showExtensions}
                onChange={(e) => update("showExtensions", e.target.checked)}
              />
            }
            label="Show file extensions"
          />

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

          {(["favorites", "bookmarks", "recent", "hosts", "devices"] as const).map(
            (id) => {
              const labels = {
                favorites: "Favorites",
                bookmarks: "Bookmarks",
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
          title="Advanced"
          description="Reveal the on-disk settings file or wipe everything back to defaults."
        >
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
  );
}
