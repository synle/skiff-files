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
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import { useEffect, useState } from "react";
import {
  connDisconnect,
  connKnownHostsList,
  connKnownHostsRemove,
  connList,
  type ConnectionInfo,
  type KnownHostEntry,
} from "../api/conn";
import {
  loadSmbDrafts,
  saveSmbDrafts,
  type SmbDraft,
} from "../state/connectionDrafts";
import RemoteConnectDialog, {
  type RemoteConnectRequest,
} from "../components/RemoteConnectDialog";

const STORAGE_KEY = "skiff-files.connections.sftp.v1";

/** Build the SMB URL the OS-native handler accepts. macOS / Linux
 *  use forward slashes; Windows accepts the same scheme via Edge's
 *  webview but typically wants UNC `\\server\share` — `start
 *  smb://...` works on Windows too in practice.
 *
 *  Pulls the host from `host` (the canonical field shared with
 *  RemoteConnectDialog). The pre-0.2.265 schema stored the same
 *  value under `server`; `loadSmbDrafts` migrates that on read so
 *  this builder doesn't need to fall back. */
function smbUrl(d: { host: string; share: string; user: string }): string {
  const userPart = d.user ? `${encodeURIComponent(d.user)}@` : "";
  const sharePart = d.share ? `/${encodeURIComponent(d.share)}` : "";
  return `smb://${userPart}${d.host}${sharePart}`;
}

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
  const [smbDrafts, setSmbDrafts] = useState<SmbDraft[]>(() => loadSmbDrafts());
  const [live, setLive] = useState<ConnectionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Drives the unified Add-connection modal (the same
   *  RemoteConnectDialog the address bar uses). `null` = closed;
   *  any non-null value opens the dialog seeded with that request.
   *  Sharing one dialog between the address-bar flow and this page
   *  guarantees both entry points stay visually consistent — adding
   *  a new field for a backend means editing one component, not two. */
  const [addRequest, setAddRequest] = useState<RemoteConnectRequest | null>(
    null,
  );
  const addOpen = addRequest !== null;
  const setAddOpen = (v: boolean) => {
    if (v) {
      // Seed a blank SFTP request — the user picks protocol inside
      // the dialog via its Protocol Select. Empty host/null port lets
      // the dialog start with all fields editable instead of pre-
      // filled from a typed URL.
      setAddRequest({
        scheme: "sftp",
        host: "",
        port: null,
        remotePath: "/",
      });
    } else {
      setAddRequest(null);
    }
  };
  useEffect(() => {
    saveDrafts(drafts);
  }, [drafts]);

  useEffect(() => {
    saveSmbDrafts(smbDrafts);
  }, [smbDrafts]);

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

  /** Reorder a draft within its list by `delta` slots (negative = up,
   *  positive = down). No-op if the move would leave the array. The
   *  arrow buttons disable themselves at the ends, but this guards
   *  against keyboard shortcuts or future programmatic callers. */
  function moveBy<T extends { id: string }>(
    list: T[],
    id: string,
    delta: number,
  ): T[] {
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return list;
    const j = i + delta;
    if (j < 0 || j >= list.length) return list;
    const next = list.slice();
    const [item] = next.splice(i, 1);
    next.splice(j, 0, item);
    return next;
  }
  const moveSmbDraft = (id: string, delta: number) =>
    setSmbDrafts((prev) => moveBy(prev, id, delta));
  const moveSftpDraft = (id: string, delta: number) =>
    setDrafts((prev) => moveBy(prev, id, delta));

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

  // loadDraft removed — clicking a Saved SFTP row now seeds the
  // unified RemoteConnectDialog via setAddRequest instead of writing
  // to the hidden inline form's state. The TODO cleanup pass will
  // also drop host/port/user/authMode/privateKeyPath state entirely.

  return (
    <Box sx={{ flex: 1, p: 3, overflow: "auto" }}>
      <Box sx={{ maxWidth: 760, mx: "auto" }}>
      <Stack direction="row" sx={{ alignItems: "center", mb: 1 }}>
        <Typography variant="h4" sx={{ flex: 1 }}>
          Manage Connections
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setAddOpen(true)}
        >
          Add connection
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Open SFTP, FTP, and SMB connections. The Add connection button
        opens the same dialog used by the address bar — one place to
        configure every remote backend.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack spacing={4}>

        {/* Saved SMB connections. Clicking the chain icon opens the
         *  unified RemoteConnectDialog pre-filled with the draft's
         *  host/port/user/share — same modal used by Add Connection
         *  and the address bar. Up/down arrows let the user reorder
         *  so the most-used share floats to the top. */}
        {smbDrafts.length > 0 && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Saved SMB connections
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Click the link icon to open the connect dialog pre-filled.
              Passwords are never saved.
            </Typography>
            <List dense>
              {smbDrafts.map((d, i) => (
                <ListItem
                  key={d.id}
                  secondaryAction={
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="Move up">
                        <span>
                          <IconButton
                            size="small"
                            disabled={i === 0}
                            onClick={() => moveSmbDraft(d.id, -1)}
                            aria-label={`Move ${d.label} up`}
                          >
                            <ArrowUpwardIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Move down">
                        <span>
                          <IconButton
                            size="small"
                            disabled={i === smbDrafts.length - 1}
                            onClick={() => moveSmbDraft(d.id, 1)}
                            aria-label={`Move ${d.label} down`}
                          >
                            <ArrowDownwardIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Open connect dialog">
                        <span>
                          <IconButton
                            size="small"
                            onClick={() =>
                              // Open the unified Connect dialog pre-seeded
                              // with this draft's host / port / user /
                              // share. The dialog's open-effect picks the
                              // share off `remotePath` (leading slash +
                              // name) and surfaces this same draft in the
                              // matches list. Password is the only field
                              // the user still has to type — we never
                              // persist creds.
                              setAddRequest({
                                scheme: "smb",
                                host: d.host,
                                port: d.port,
                                user: d.user,
                                remotePath: d.share ? `/${d.share}` : "/",
                              })
                            }
                            aria-label={`Open ${d.label}`}
                          >
                            <LinkIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Delete saved connection">
                        <IconButton
                          size="small"
                          onClick={() =>
                            setSmbDrafts((prev) =>
                              prev.filter((x) => x.id !== d.id),
                            )
                          }
                          aria-label={`Delete ${d.label}`}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  }
                >
                  <ListItemText
                    primary={d.label}
                    secondary={smbUrl({
                      host: d.host,
                      share: d.share,
                      user: d.user,
                    })}
                  />
                </ListItem>
              ))}
            </List>
          </Paper>
        )}

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
                    <Tooltip title="Disconnect">
                      <IconButton
                        edge="end"
                        onClick={() => void handleDisconnect(c.id)}
                        aria-label={`Disconnect ${c.label}`}
                      >
                        <LinkOffIcon />
                      </IconButton>
                    </Tooltip>
                  }
                >
                  <LinkIcon fontSize="small" sx={{ mr: 1 }} />
                  <ListItemText
                    primary={c.label}
                    // Render secondary as a <span> so the Chip's <div>
                    // root doesn't get nested inside a <p> (MUI's
                    // default Typography component for the secondary
                    // slot) — that's invalid HTML and React 19 will
                    // hydrate-error it.
                    slotProps={{ secondary: { component: "span" } }}
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
            Saved SFTP connections
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Click the row to open the connect dialog pre-filled.
            Passwords are never saved.
          </Typography>
          {drafts.length === 0 ? (
            <Typography variant="body2" color="text.disabled">
              No saved connections.
            </Typography>
          ) : (
            <List dense>
              {drafts.map((d, i) => (
                <ListItem
                  key={d.id}
                  secondaryAction={
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="Move up">
                        <span>
                          <IconButton
                            edge="end"
                            size="small"
                            disabled={i === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveSftpDraft(d.id, -1);
                            }}
                            aria-label={`Move ${d.label} up`}
                          >
                            <ArrowUpwardIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Move down">
                        <span>
                          <IconButton
                            edge="end"
                            size="small"
                            disabled={i === drafts.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveSftpDraft(d.id, 1);
                            }}
                            aria-label={`Move ${d.label} down`}
                          >
                            <ArrowDownwardIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Rename label">
                        <IconButton
                          edge="end"
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRenameDraft(d.id);
                          }}
                          aria-label={`Rename ${d.label}`}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Duplicate">
                        <IconButton
                          edge="end"
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicateDraft(d.id);
                          }}
                          aria-label={`Duplicate ${d.label}`}
                        >
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete saved connection">
                        <IconButton
                          edge="end"
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDraft(d.id);
                          }}
                          aria-label={`Delete ${d.label}`}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  }
                  onClick={() =>
                    // Open the unified dialog seeded with this draft's
                    // host/port/user — same modal as Add Connection and
                    // the address bar. The dialog's match-list will
                    // surface this draft for one-click selection.
                    setAddRequest({
                      scheme: "sftp",
                      host: d.host,
                      port: d.port,
                      user: d.user,
                      remotePath: "/",
                    })
                  }
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
      <RemoteConnectDialog
        open={addOpen}
        request={addRequest}
        onClose={() => setAddOpen(false)}
        onConnected={() => {
          // Dialog saved a draft (if user opted in) + opened the
          // live connection. Refresh both lists so the new entries
          // appear without a tab reload, then close.
          setAddOpen(false);
          void refreshLive();
          // Re-read drafts from localStorage — RemoteConnectDialog
          // owns the persistence; this page is just a consumer.
          setDrafts(loadDrafts());
          setSmbDrafts(loadSmbDrafts());
        }}
      />
    </Box>
  );
}
