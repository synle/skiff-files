// Manage Connections page — single merged list. Replaces the old
// "Active connections" + "Saved SFTP / FTP / SMB connections" split
// (which forced users to track the same entry across two stores)
// with one row per saved connection. Each row shows:
//   - protocol chip (FTP / SFTP / SMB)
//   - friendly label
//   - status pill ("Connected" green / "Disconnected" grey)
//   - row actions: Connect or Disconnect toggle, Edit, Delete
//
// Source of truth is `Settings.connections`. Live-connection state
// comes from `connList()` (the Rust registry) and is matched into
// rows by connection id.
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
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import LinkIcon from "@mui/icons-material/Link";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  connDisconnect,
  connKnownHostsList,
  connKnownHostsRemove,
  connList,
  type ConnectionInfo,
  type KnownHostEntry,
} from "../api/conn";
import RemoteConnectDialog, {
  type RemoteConnectRequest,
} from "../components/RemoteConnectDialog";
import ConfirmDialog from "../components/ConfirmDialog";
import { useSettings } from "../state/settings";
import {
  removeConnection,
  type SavedConnection,
} from "../state/connectionStore";

/** Build the request payload the dialog needs to open in edit mode
 *  for a particular saved connection. Mirrors the typed-URL shape
 *  the address bar produces; the dialog handles the rest. */
function requestForEdit(c: SavedConnection): RemoteConnectRequest {
  return {
    scheme: c.kind,
    host: c.host,
    port: c.port,
    user: c.user,
    remotePath: "/",
  };
}

export default function ConnectionsPage() {
  const { settings, update } = useSettings();
  /** Live SMB/SFTP/FTP sessions held by Rust. Matched to saved rows
   *  by id so we can render a status pill + toggle between Connect
   *  and Disconnect actions. */
  const [live, setLive] = useState<ConnectionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Opens `RemoteConnectDialog` in add-mode (no id) or edit-mode
   *  (`editingId` set). Null = closed. */
  const [dialogState, setDialogState] = useState<
    | { mode: "add"; request: RemoteConnectRequest }
    | { mode: "edit"; request: RemoteConnectRequest; editingId: string }
    | null
  >(null);
  /** Delete-confirmation state. */
  const [pendingDelete, setPendingDelete] = useState<SavedConnection | null>(
    null,
  );

  /** TOFU-pinned host fingerprints. Refreshed alongside live state. */
  const [knownHosts, setKnownHosts] = useState<KnownHostEntry[]>([]);
  const refreshKnownHosts = () => {
    connKnownHostsList()
      .then(setKnownHosts)
      .catch(() => setKnownHosts([]));
  };

  /** Pull live sessions from Rust. Does NOT broadcast
   *  `skiff:connections-changed` — that event is dispatched by the
   *  action sites (dialog on connect, disconnect button, delete
   *  flow). Listening AND dispatching from the same place creates
   *  a feedback loop. */
  const refreshLive = useCallback(async () => {
    try {
      const list = await connList();
      setLive(list);
    } catch (e) {
      // outside Tauri / no connections — keep empty
      setLive([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refreshLive();
    refreshKnownHosts();
    // Re-pull whenever some other surface fires the event (e.g. the
    // dialog completing a connect from the address bar).
    const onChange = () => void refreshLive();
    window.addEventListener("skiff:connections-changed", onChange);
    return () =>
      window.removeEventListener("skiff:connections-changed", onChange);
  }, [refreshLive]);

  /** Index of live sessions by id — O(1) lookup while rendering rows. */
  const liveById = useMemo(
    () => new Map(live.map((c) => [c.id, c])),
    [live],
  );

  /** Disconnect a live session. Saved entry stays. */
  const disconnect = async (id: string) => {
    try {
      await connDisconnect(id);
      await refreshLive();
      window.dispatchEvent(new CustomEvent("skiff:connections-changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Open the dialog in add-mode. */
  const openAdd = () => {
    setDialogState({
      mode: "add",
      // Seed a blank request — the user picks protocol inside the
      // dialog via its Protocol Select.
      request: { scheme: "sftp", host: "", port: null, remotePath: "/" },
    });
  };

  /** Open the dialog in edit-mode pre-filled from a saved row. */
  const openEdit = (c: SavedConnection) => {
    setDialogState({
      mode: "edit",
      request: requestForEdit(c),
      editingId: c.id,
    });
  };

  /** Delete a saved entry (+ disconnect any live session sharing the id). */
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    if (liveById.has(id)) {
      try {
        await connDisconnect(id);
      } catch {
        /* surface no error — we still want to remove the saved entry */
      }
    }
    update("connections", removeConnection(settings.connections, id));
    setPendingDelete(null);
    await refreshLive();
    window.dispatchEvent(new CustomEvent("skiff:connections-changed"));
  };

  /** Reconnect a saved row. For password-auth schemes without a
   *  remembered password, this falls through to the dialog (which
   *  pre-fills everything except the password and prompts). For
   *  rows with rememberPassword + password, we *still* open the
   *  dialog today (auto-connect-from-saved is a follow-up); the
   *  user just clicks Connect again and the cached password is
   *  pre-filled. */
  const reconnect = (c: SavedConnection) => {
    openEdit(c);
  };

  return (
    <Box sx={{ flex: 1, p: 3, overflow: "auto" }}>
      <Box sx={{ maxWidth: 760, mx: "auto" }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
            mb: 1,
          }}
        >
          <Typography variant="h5">Manage Connections</Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={openAdd}
            aria-label="Add connection"
          >
            Add connection
          </Button>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Open SFTP, FTP, and SMB connections. All saved here — passwords
          are kept only when you opt in.
        </Typography>

        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Connections
          </Typography>
          {settings.connections.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No connections yet. Click <strong>Add connection</strong>{" "}
              to set one up.
            </Typography>
          ) : (
            <List dense disablePadding>
              {settings.connections.map((c) => {
                const isLive = liveById.has(c.id);
                return (
                  <ListItem
                    key={c.id}
                    sx={{
                      borderTop: 1,
                      borderColor: "divider",
                      "&:first-of-type": { borderTop: 0 },
                    }}
                    secondaryAction={
                      <Box
                        sx={{
                          display: "flex",
                          gap: 0.5,
                          alignItems: "center",
                        }}
                      >
                        <Tooltip
                          title={
                            isLive
                              ? "Disconnect (the saved entry stays)"
                              : "Open this connection"
                          }
                        >
                          <IconButton
                            size="small"
                            onClick={() =>
                              isLive ? void disconnect(c.id) : reconnect(c)
                            }
                            aria-label={
                              isLive ? `Disconnect ${c.label}` : `Connect ${c.label}`
                            }
                            color={isLive ? "warning" : "primary"}
                          >
                            {isLive ? (
                              <PowerSettingsNewIcon fontSize="small" />
                            ) : (
                              <LinkIcon fontSize="small" />
                            )}
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Edit connection details">
                          <IconButton
                            size="small"
                            onClick={() => openEdit(c)}
                            aria-label={`Edit ${c.label}`}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete this saved connection">
                          <IconButton
                            size="small"
                            onClick={() => setPendingDelete(c)}
                            aria-label={`Delete ${c.label}`}
                            color="error"
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    }
                  >
                    <ListItemText
                      primary={
                        <Box
                          sx={{
                            display: "flex",
                            gap: 1,
                            alignItems: "center",
                            minWidth: 0,
                          }}
                        >
                          <Chip
                            size="small"
                            label={c.kind.toUpperCase()}
                            sx={{
                              height: 18,
                              fontSize: 10,
                              fontWeight: 600,
                              "& .MuiChip-label": { px: 0.6 },
                            }}
                          />
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 500,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              minWidth: 0,
                            }}
                          >
                            {c.label}
                          </Typography>
                          <Chip
                            size="small"
                            label={isLive ? "Connected" : "Disconnected"}
                            color={isLive ? "success" : "default"}
                            variant={isLive ? "filled" : "outlined"}
                            sx={{
                              height: 18,
                              fontSize: 10,
                              "& .MuiChip-label": { px: 0.6 },
                            }}
                          />
                          {c.rememberPassword && (
                            <Tooltip title="Password is remembered in your app settings">
                              <Chip
                                size="small"
                                label="Saved password"
                                variant="outlined"
                                sx={{
                                  height: 18,
                                  fontSize: 10,
                                  "& .MuiChip-label": { px: 0.6 },
                                }}
                              />
                            </Tooltip>
                          )}
                        </Box>
                      }
                      secondary={`${c.host}:${c.port}${c.user ? ` · ${c.user}` : ""}`}
                      slotProps={{
                        secondary: { variant: "caption" },
                      }}
                    />
                  </ListItem>
                );
              })}
            </List>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Known hosts (TOFU)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Server fingerprints captured on first connect. Delete an entry
            to re-trust the host on the next connection.
          </Typography>
          {knownHosts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No known hosts pinned yet.
            </Typography>
          ) : (
            <List dense disablePadding>
              {knownHosts.map(([hostPort, fingerprint]) => {
                // KnownHostEntry is a tuple `[host:port, fingerprint]`
                // from the Tauri binding. Split for the remove call.
                const lastColon = hostPort.lastIndexOf(":");
                const host =
                  lastColon > 0 ? hostPort.slice(0, lastColon) : hostPort;
                const portStr =
                  lastColon > 0 ? hostPort.slice(lastColon + 1) : "";
                return (
                  <ListItem
                    key={hostPort}
                    sx={{
                      borderTop: 1,
                      borderColor: "divider",
                      "&:first-of-type": { borderTop: 0 },
                    }}
                    secondaryAction={
                      <Tooltip title="Delete fingerprint (re-trust on next connect)">
                        <IconButton
                          size="small"
                          onClick={() => {
                            void connKnownHostsRemove(`${host}:${portStr}`).then(
                              refreshKnownHosts,
                            );
                          }}
                          aria-label={`Delete fingerprint for ${hostPort}`}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    }
                  >
                    <ListItemText
                      primary={hostPort}
                      secondary={fingerprint}
                      slotProps={{
                        primary: { variant: "body2" },
                        secondary: {
                          variant: "caption",
                          sx: { fontFamily: "monospace" },
                        },
                      }}
                    />
                  </ListItem>
                );
              })}
            </List>
          )}
        </Paper>

        <Divider sx={{ my: 3 }} />

        <Typography variant="caption" color="text.secondary">
          Passwords are stored only when the "Remember password" toggle in
          the connect dialog is on, and currently live in the same{" "}
          <code>settings.json</code> as the rest of the app. OS Keychain
          support is on the roadmap.
        </Typography>
      </Box>

      <RemoteConnectDialog
        open={dialogState != null}
        request={dialogState?.request ?? null}
        editingConnectionId={
          dialogState?.mode === "edit" ? dialogState.editingId : undefined
        }
        onClose={() => setDialogState(null)}
        onConnected={() => {
          setDialogState(null);
          void refreshLive();
        }}
      />

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete saved connection?"
        message={
          pendingDelete
            ? `Delete "${pendingDelete.label}"? The saved details (host, user, share) will be removed. Any live session will be disconnected. This can't be undone.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </Box>
  );
}
