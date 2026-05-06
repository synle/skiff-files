// Connections page — Phase 2a flavor. Lets the user open / list / drop
// SFTP connections. Saved connections (drafts that aren't currently
// connected) live in localStorage; live connections are owned by the
// Rust registry.
//
// Phase 2b will tie this to the Browser via an `sftp://<id>/<path>`
// scheme so clicking a connection in the sidebar starts browsing.
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import { useEffect, useState } from "react";
import {
  connCreateSftp,
  connDisconnect,
  connList,
  type ConnectionInfo,
  type SftpConfig,
} from "../api/conn";

const STORAGE_KEY = "skiff-files.connections.sftp.v1";

/** Saved (not necessarily live) draft. Kept on the client so users don't
 *  re-type host/user every time. We never persist passwords or key
 *  passphrases — those go to the OS keychain in Phase 2b. */
interface SftpDraft {
  id: string; // local-only id (not registry id)
  label: string;
  host: string;
  port: number;
  user: string;
  authMode: "password" | "privateKey";
  privateKeyPath?: string;
}

function loadDrafts(): SftpDraft[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SftpDraft[]) : [];
  } catch {
    return [];
  }
}

function saveDrafts(drafts: SftpDraft[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    /* private mode — silently drop */
  }
}

export default function ConnectionsPage() {
  const [drafts, setDrafts] = useState<SftpDraft[]>(() => loadDrafts());
  const [live, setLive] = useState<ConnectionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form state — kept local so Add Connection doesn't dirty the rest of
  // the app's state.
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [user, setUser] = useState("");
  const [authMode, setAuthMode] = useState<"password" | "privateKey">(
    "password",
  );
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState("");

  useEffect(() => {
    saveDrafts(drafts);
  }, [drafts]);

  // Refresh the live-connection list once on mount and after every
  // successful connect/disconnect. Polling would be overkill for Phase 2a.
  // Also dispatches a window event so the Sidebar can update its host list
  // without holding a reference to this page.
  const refreshLive = async () => {
    try {
      setLive(await connList());
      window.dispatchEvent(new CustomEvent("skiff:connections-changed"));
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void refreshLive();
  }, []);

  const handleConnect = async () => {
    setError(null);
    setBusy(true);
    const config: SftpConfig = {
      host,
      port,
      user,
      password: authMode === "password" ? password : undefined,
      privateKeyPath: authMode === "privateKey" ? privateKeyPath : undefined,
      privateKeyPassphrase:
        authMode === "privateKey" && privateKeyPassphrase
          ? privateKeyPassphrase
          : undefined,
    };
    try {
      await connCreateSftp(config);
      // Save this as a draft for next time (without secrets).
      const label = `${user}@${host}:${port}`;
      const draft: SftpDraft = {
        id: crypto.randomUUID(),
        label,
        host,
        port,
        user,
        authMode,
        privateKeyPath:
          authMode === "privateKey" ? privateKeyPath : undefined,
      };
      setDrafts((d) => [
        ...d.filter((x) => x.label !== label),
        draft,
      ]);
      // Clear secrets from the form — leave host/user so the user can connect again.
      setPassword("");
      setPrivateKeyPassphrase("");
      void refreshLive();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await connDisconnect(id);
      void refreshLive();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDeleteDraft = (id: string) => {
    setDrafts((d) => d.filter((x) => x.id !== id));
  };

  const loadDraft = (d: SftpDraft) => {
    setHost(d.host);
    setPort(d.port);
    setUser(d.user);
    setAuthMode(d.authMode);
    setPrivateKeyPath(d.privateKeyPath ?? "");
  };

  return (
    <Box sx={{ p: 3, overflow: "auto", maxWidth: 760 }}>
      <Typography variant="h4" gutterBottom>
        Connections
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack spacing={4}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            New SFTP connection
          </Typography>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Host"
                size="small"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                label="Port"
                size="small"
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value) || 22)}
                sx={{ width: 100 }}
              />
              <TextField
                label="User"
                size="small"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                sx={{ flex: 1 }}
              />
            </Stack>

            <Select
              size="small"
              value={authMode}
              onChange={(e) =>
                setAuthMode(e.target.value as "password" | "privateKey")
              }
              sx={{ maxWidth: 240 }}
            >
              <MenuItem value="password">Password</MenuItem>
              <MenuItem value="privateKey">Private key</MenuItem>
            </Select>

            {authMode === "password" ? (
              <TextField
                label="Password"
                size="small"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            ) : (
              <Stack spacing={2}>
                <TextField
                  label="Private key path"
                  size="small"
                  value={privateKeyPath}
                  onChange={(e) => setPrivateKeyPath(e.target.value)}
                  helperText="Absolute path to an OpenSSH private key file."
                />
                <TextField
                  label="Passphrase (optional)"
                  size="small"
                  type="password"
                  value={privateKeyPassphrase}
                  onChange={(e) => setPrivateKeyPassphrase(e.target.value)}
                />
              </Stack>
            )}

            <Box>
              <Button
                variant="contained"
                disabled={busy || !host || !user}
                onClick={() => void handleConnect()}
              >
                {busy ? "Connecting…" : "Connect"}
              </Button>
            </Box>
          </Stack>
        </Paper>

        <Box>
          <Stack
            direction="row"
            sx={{
              mb: 0.5,
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <Typography variant="h6">Active connections</Typography>
            {live.length > 1 && (
              <Button
                size="small"
                color="warning"
                onClick={() => {
                  if (
                    window.confirm(
                      `Disconnect all ${live.length} connections?`,
                    )
                  ) {
                    void Promise.all(live.map((c) => connDisconnect(c.id)))
                      .then(refreshLive)
                      .catch((e) => setError(String(e)));
                  }
                }}
              >
                Disconnect all
              </Button>
            )}
          </Stack>
          {live.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No live connections.
            </Typography>
          ) : (
            <List dense>
              {live.map((c) => (
                <ListItem
                  key={c.id}
                  secondaryAction={
                    <IconButton
                      edge="end"
                      onClick={() => void handleDisconnect(c.id)}
                      aria-label={`Disconnect ${c.label}`}
                    >
                      <LinkOffIcon />
                    </IconButton>
                  }
                >
                  <LinkIcon fontSize="small" sx={{ mr: 1 }} />
                  <ListItemText
                    primary={c.label}
                    secondary={
                      <Chip size="small" label={c.kind.toUpperCase()} />
                    }
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Box>

        <Divider />

        <Box>
          <Typography variant="h6" gutterBottom>
            Saved drafts
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Quick-fill the form above. Passwords are never saved.
          </Typography>
          {drafts.length === 0 ? (
            <Typography variant="body2" color="text.disabled">
              No saved connections.
            </Typography>
          ) : (
            <List dense>
              {drafts.map((d) => (
                <ListItem
                  key={d.id}
                  secondaryAction={
                    <IconButton
                      edge="end"
                      onClick={() => handleDeleteDraft(d.id)}
                      aria-label={`Delete ${d.label}`}
                    >
                      <DeleteIcon />
                    </IconButton>
                  }
                  onClick={() => loadDraft(d)}
                  sx={{ cursor: "pointer" }}
                >
                  <ListItemText
                    primary={d.label}
                    secondary={
                      d.authMode === "password"
                        ? "password auth"
                        : "private key auth"
                    }
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      </Stack>
    </Box>
  );
}
