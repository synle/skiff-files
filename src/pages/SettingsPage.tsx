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
  Typography,
} from "@mui/material";
import { useSettings } from "../state/settings";

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
          title="Advanced"
          description="Other sections (Connections, Transfers, Keyboard) will appear as later phases land."
        >
          <Box>
            <Button
              variant="outlined"
              color="warning"
              onClick={reset}
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
