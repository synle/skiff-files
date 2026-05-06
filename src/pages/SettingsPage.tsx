import { useState } from "react";
import {
  Card,
  CardContent,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";

/** Settings page — local-only dummy form to demonstrate the layout. */
export default function SettingsPage() {
  const [name, setName] = useState("My App");
  const [autoStart, setAutoStart] = useState(false);

  return (
    <Stack spacing={3}>
      <Typography variant="h4">Settings</Typography>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <TextField
              label="Display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                />
              }
              label="Launch at login"
            />
            <Typography variant="caption" color="text.secondary">
              These settings are not persisted yet — wire them to a Tauri command
              (see `lib.rs`) when you start building.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
