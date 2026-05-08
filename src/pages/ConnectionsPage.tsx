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
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import { useEffect, useState } from "react";
import {
  connCreateSftp,
  connDisconnect,
  connKnownHostsList,
  connKnownHostsRemove,
  connList,
  sshConfigHosts,
  type ConnectionInfo,
  type KnownHostEntry,
  type SftpConfig,
  type SshConfigHost,
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
  authMode: "password" | "privateKey" | "agent";
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
  const [authMode, setAuthMode] = useState<
    "password" | "privateKey" | "agent"
  >("password");
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState("");

  useEffect(() => {
    saveDrafts(drafts);
  }, [drafts]);

  /** Imported entries from `~/.ssh/config`. Loaded once on mount; the
   *  user shouldn't expect mid-session changes to surface without a
   *  refresh. */
  const [sshHosts, setSshHosts] = useState<SshConfigHost[]>([]);
  /** TOFU-pinned host fingerprints. Refreshed alongside the live
   *  connection list so deleting + reconnecting picks up changes. */
  const [knownHosts, setKnownHosts] = useState<KnownHostEntry[]>([]);
  const refreshKnownHosts = () => {
    connKnownHostsList()
      .then(setKnownHosts)
      .catch(() => setKnownHosts([]));
  };
  useEffect(() => {
    refreshKnownHosts();
  }, []);
  useEffect(() => {
    sshConfigHosts()
      .then(setSshHosts)
      .catch(() => setSshHosts([]));
  }, []);

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

  /** True after a successful test, false after failure, null for idle.
   *  Drives a small inline message under the form so the user sees
   *  whether their settings actually work without having to keep the
   *  connection open or check the live list. */
  const [testResult, setTestResult] = useState<
    { ok: boolean; message: string } | null
  >(null);

  /** Establish + immediately tear down a connection just to verify
   *  host/port/auth work. Useful before saving a draft you don't
   *  want to actually start browsing. */
  const handleTest = async () => {
    setError(null);
    setTestResult(null);
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
      useAgent: authMode === "agent",
    };
    try {
      const id = await connCreateSftp(config);
      // Tear down immediately — the goal is verification, not browsing.
      try {
        await connDisconnect(id);
      } catch {
        /* best-effort — leaking a connection is recoverable via
           "Disconnect all" in the live list */
      }
      setTestResult({ ok: true, message: `Connected to ${host}:${port} as ${user}.` });
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally {
      setBusy(false);
    }
  };

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
      useAgent: authMode === "agent",
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

  /** Clone a draft as a new entry the user can edit independently —
   *  useful for "I want a 'staging' variant of my 'production' setup
   *  without retyping host/user". The label gets a " (copy)" suffix
   *  (or " (copy 2)" / "… (copy 3)" if collisions exist) so the list
   *  stays readable. */
  /** Rename a saved draft's display label. The label seeds from
   *  `${user}@${host}:${port}` on save, but power users with multiple
   *  accounts on the same host want to disambiguate ("prod box",
   *  "stage box"). Pure presentation — host/user/port stay unchanged. */
  const handleRenameDraft = (id: string) => {
    const current = drafts.find((x) => x.id === id);
    if (!current) return;
    const next = window.prompt("Rename connection", current.label);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === current.label) return;
    setDrafts((d) =>
      d.map((x) => (x.id === id ? { ...x, label: trimmed } : x)),
    );
  };

  const handleDuplicateDraft = (id: string) => {
    setDrafts((d) => {
      const original = d.find((x) => x.id === id);
      if (!original) return d;
      const baseLabel = `${original.label} (copy)`;
      const existing = new Set(d.map((x) => x.label));
      let label = baseLabel;
      let n = 2;
      while (existing.has(label)) {
        label = `${original.label} (copy ${n++})`;
      }
      return [...d, { ...original, id: crypto.randomUUID(), label }];
    });
  };

  const loadDraft = (d: SftpDraft) => {
    setHost(d.host);
    setPort(d.port);
    setUser(d.user);
    setAuthMode(d.authMode);
    setPrivateKeyPath(d.privateKeyPath ?? "");
  };

  return (
    <Box sx={{ flex: 1, p: 3, overflow: "auto" }}>
      <Box sx={{ maxWidth: 760, mx: "auto" }}>
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
            {sshHosts.length > 0 && (
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="caption" color="text.secondary">
                  Import from <code>~/.ssh/config</code>:
                </Typography>
                <Select
                  size="small"
                  displayEmpty
                  value=""
                  onChange={(e) => {
                    const name = e.target.value as string;
                    const h = sshHosts.find((x) => x.name === name);
                    if (!h) return;
                    setHost(h.hostName ?? h.name);
                    if (h.user) setUser(h.user);
                    if (h.port) setPort(h.port);
                    if (h.identityFile) {
                      setAuthMode("privateKey");
                      setPrivateKeyPath(h.identityFile);
                    }
                  }}
                  sx={{ minWidth: 200 }}
                  aria-label="Import host from ssh config"
                >
                  <MenuItem value="" disabled>
                    Pick a host…
                  </MenuItem>
                  {sshHosts.map((h) => (
                    <MenuItem key={h.name} value={h.name}>
                      {h.name}
                      {h.hostName ? ` (${h.hostName})` : ""}
                    </MenuItem>
                  ))}
                </Select>
              </Stack>
            )}
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
                setAuthMode(
                  e.target.value as "password" | "privateKey" | "agent",
                )
              }
              sx={{ maxWidth: 240 }}
            >
              <MenuItem value="password">Password</MenuItem>
              <MenuItem value="privateKey">Private key</MenuItem>
              <MenuItem value="agent">ssh-agent</MenuItem>
            </Select>

            {authMode === "agent" ? (
              <Typography variant="caption" color="text.secondary">
                Reads identities from <code>$SSH_AUTH_SOCK</code>. Make sure
                your agent is running and has loaded the key for this host
                (<code>ssh-add -l</code> to verify).
              </Typography>
            ) : authMode === "password" ? (
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

            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={busy || !host || !user}
                onClick={() => void handleConnect()}
              >
                {busy ? "Connecting…" : "Connect"}
              </Button>
              <Button
                variant="outlined"
                disabled={busy || !host || !user}
                onClick={() => void handleTest()}
              >
                Test
              </Button>
            </Stack>
            {testResult && (
              <Alert
                severity={testResult.ok ? "success" : "error"}
                onClose={() => setTestResult(null)}
                sx={{ mt: 1 }}
              >
                {testResult.message}
              </Alert>
            )}
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
                    <Stack direction="row" spacing={0.5}>
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameDraft(d.id);
                        }}
                        aria-label={`Rename ${d.label}`}
                        title="Rename label"
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDuplicateDraft(d.id);
                        }}
                        aria-label={`Duplicate ${d.label}`}
                        title="Duplicate"
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteDraft(d.id);
                        }}
                        aria-label={`Delete ${d.label}`}
                        title="Delete"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  }
                  onClick={() => loadDraft(d)}
                  sx={{ cursor: "pointer" }}
                >
                  <ListItemText
                    primary={d.label}
                    secondary={
                      d.authMode === "password"
                        ? "password auth"
                        : d.authMode === "agent"
                          ? "ssh-agent auth"
                          : "private key auth"
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
            Known hosts (TOFU)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Server fingerprints captured on first connect. Delete an
            entry to re-trust the host on the next connection.
          </Typography>
          {knownHosts.length === 0 ? (
            <Typography variant="body2" color="text.disabled">
              No known hosts yet.
            </Typography>
          ) : (
            <List dense>
              {knownHosts.map(([keyId, fp]) => (
                <ListItem
                  key={keyId}
                  secondaryAction={
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Forget ${keyId}? The next connect will TOFU-trust whatever key the server presents.`,
                          )
                        ) {
                          void connKnownHostsRemove(keyId).then(
                            refreshKnownHosts,
                          );
                        }
                      }}
                      aria-label={`Forget ${keyId}`}
                      title="Forget host"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  }
                >
                  <ListItemText
                    primary={keyId}
                    secondary={`SHA256:${fp}`}
                    slotProps={{
                      secondary: {
                        sx: { fontFamily: "monospace", fontSize: "0.7rem" },
                      },
                    }}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      </Stack>
      </Box>
    </Box>
  );
}
