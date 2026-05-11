// Address-bar URL → connection resolver dialog (0.2.264).
//
// When the user types a host-form remote URL (`ftp://host`, `sftp://host`)
// PathBar fires `skiff:connect-to-remote` and Browser mounts this
// dialog. The dialog matches the typed host against saved drafts
// (sftp + ftp localStorage) and lets the user:
//   - one-click "Use" a saved match (still prompts for password when
//     the saved auth mode is "password" — we never persist creds)
//   - manually fill in a brand-new connection (host/port pre-filled
//     from the typed URL)
//   - optionally save the new draft for later
//
// On Connect we call `conn_create_sftp` / `conn_create_ftp`, persist
// any "save for later" draft, then call `onConnected(uuidUrl)` so the
// caller can navigate to the canonical URL form.

import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { connCreateFtp, connCreateSftp } from "../api/conn";
import {
  loadFtpDrafts,
  loadSftpDrafts,
  matchFtpDraftsForHost,
  matchSftpDraftsForHost,
  saveFtpDrafts,
  saveSftpDrafts,
  type FtpDraft,
  type SftpDraft,
} from "../state/connectionDrafts";

export interface RemoteConnectRequest {
  /** "sftp" or "ftp" — picked from the URL prefix. */
  scheme: "sftp" | "ftp";
  /** Hostname / IP the user typed. */
  host: string;
  /** Port from the URL, or null when omitted (defaults: sftp=22,
   *  ftp=21). null means "match any saved port on this host". */
  port: number | null;
  /** Optional user@host:port — pre-fills the User field. */
  user?: string;
  /** Path tail (everything after the host segment). */
  remotePath: string;
}

interface Props {
  open: boolean;
  request: RemoteConnectRequest | null;
  onClose: () => void;
  /** Called after a successful connect with the canonical
   *  `<scheme>://<uuid>/<remotePath>` URL the caller should navigate
   *  to. */
  onConnected: (canonicalUrl: string) => void;
}

type SftpAuth = "password" | "privateKey" | "agent";

export default function RemoteConnectDialog({
  open,
  request,
  onClose,
  onConnected,
}: Props) {
  const [scheme, setScheme] = useState<"sftp" | "ftp">("ftp");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(21);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<SftpAuth>("password");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState("");
  const [saveDraft, setSaveDraft] = useState(false);
  /** Tracks which saved draft (if any) is pre-filling the form, so
   *  switching back to "new" is a single click and the "Save for
   *  later" checkbox flips appropriately. */
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload drafts every open — localStorage may have changed in
  // another window (multi-window settings sync).
  const [sftpDrafts, setSftpDrafts] = useState<SftpDraft[]>([]);
  const [ftpDrafts, setFtpDrafts] = useState<FtpDraft[]>([]);

  useEffect(() => {
    if (!open || !request) return;
    setSftpDrafts(loadSftpDrafts());
    setFtpDrafts(loadFtpDrafts());
    setScheme(request.scheme);
    setHost(request.host);
    setPort(request.port ?? (request.scheme === "sftp" ? 22 : 21));
    setUser(request.user ?? (request.scheme === "ftp" ? "anonymous" : ""));
    setPassword(request.scheme === "ftp" ? "anonymous@" : "");
    setAuthMode("password");
    setPrivateKeyPath("");
    setPrivateKeyPassphrase("");
    setSaveDraft(false);
    setSelectedDraftId(null);
    setError(null);
    setBusy(false);
  }, [open, request]);

  const matches = useMemo(() => {
    if (!request) return [] as Array<
      | { kind: "sftp"; draft: SftpDraft }
      | { kind: "ftp"; draft: FtpDraft }
    >;
    const sftp = matchSftpDraftsForHost(sftpDrafts, request.host, request.port);
    const ftp = matchFtpDraftsForHost(ftpDrafts, request.host, request.port);
    // Only surface drafts matching the URL's scheme — typing `ftp://`
    // shouldn't suggest SSH credentials and vice-versa.
    if (request.scheme === "sftp") {
      return sftp.map((d) => ({ kind: "sftp" as const, draft: d }));
    }
    return ftp.map((d) => ({ kind: "ftp" as const, draft: d }));
  }, [request, sftpDrafts, ftpDrafts]);

  const applyDraft = (
    entry:
      | { kind: "sftp"; draft: SftpDraft }
      | { kind: "ftp"; draft: FtpDraft },
  ) => {
    setScheme(entry.kind);
    setHost(entry.draft.host);
    setPort(entry.draft.port);
    setUser(entry.draft.user);
    setSelectedDraftId(entry.draft.id);
    setSaveDraft(false); // already saved
    if (entry.kind === "sftp") {
      setAuthMode(entry.draft.authMode);
      setPrivateKeyPath(entry.draft.privateKeyPath ?? "");
      setPassword("");
      setPrivateKeyPassphrase("");
    } else {
      setAuthMode("password");
      setPassword(""); // user fills in real password (or "anonymous@" stays empty)
    }
  };

  const handleConnect = async () => {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      let uuid: string;
      if (scheme === "sftp") {
        uuid = await connCreateSftp({
          host,
          port,
          user,
          password: authMode === "password" ? password : undefined,
          privateKeyPath:
            authMode === "privateKey" ? privateKeyPath : undefined,
          privateKeyPassphrase:
            authMode === "privateKey" ? privateKeyPassphrase : undefined,
          useAgent: authMode === "agent",
        });
        if (saveDraft && selectedDraftId == null) {
          const next: SftpDraft = {
            id: `sftp-${Date.now()}`,
            label: `${user || "user"}@${host}:${port}`,
            host,
            port,
            user,
            authMode,
            privateKeyPath:
              authMode === "privateKey" ? privateKeyPath : undefined,
          };
          const merged = [...sftpDrafts, next];
          saveSftpDrafts(merged);
          setSftpDrafts(merged);
        }
      } else {
        uuid = await connCreateFtp({
          host,
          port,
          user: user || undefined,
          password: password || undefined,
        });
        if (saveDraft && selectedDraftId == null) {
          const next: FtpDraft = {
            id: `ftp-${Date.now()}`,
            label:
              user && user !== "anonymous"
                ? `${user}@${host}:${port}`
                : `${host}:${port}`,
            host,
            port,
            user: user || "anonymous",
          };
          const merged = [...ftpDrafts, next];
          saveFtpDrafts(merged);
          setFtpDrafts(merged);
        }
      }
      onConnected(
        `${scheme}://${uuid}${request.remotePath || "/"}`,
      );
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!request) return null;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Connect to {request.host}
        {request.port != null ? `:${request.port}` : ""}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {/* Matching saved drafts — listed first so the common case
              (re-connecting to a known host) is a single click. */}
          {matches.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Use a saved connection
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mb: 1 }}
              >
                {matches.length === 1
                  ? "One saved match for this host:"
                  : `${matches.length} saved matches for this host — pick one or fill in a new connection below.`}
              </Typography>
              <List dense disablePadding>
                {matches.map((m) => {
                  const draft = m.draft;
                  return (
                    <ListItemButton
                      key={`${m.kind}:${draft.id}`}
                      selected={selectedDraftId === draft.id}
                      onClick={() => applyDraft(m)}
                    >
                      <ListItemText
                        primary={draft.label}
                        secondary={
                          m.kind === "sftp"
                            ? `${m.kind.toUpperCase()} · ${draft.user}@${draft.host}:${draft.port} · ${m.draft.authMode}`
                            : `FTP · ${draft.user}@${draft.host}:${draft.port}`
                        }
                      />
                    </ListItemButton>
                  );
                })}
              </List>
              <Divider sx={{ mt: 1 }} />
            </Box>
          )}

          {/* Connection form. Pre-filled either from a clicked saved
              draft or from the parsed URL. The user always fills in
              the password (we never persist it). */}
          <Typography variant="subtitle2">
            {selectedDraftId
              ? "Edit before connecting"
              : matches.length > 0
                ? "Or enter a new connection"
                : "Enter connection details"}
          </Typography>

          <Stack direction="row" spacing={1}>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel id="rcd-scheme-label">Protocol</InputLabel>
              <Select
                labelId="rcd-scheme-label"
                label="Protocol"
                value={scheme}
                onChange={(e) => {
                  const v = e.target.value as "sftp" | "ftp";
                  setScheme(v);
                  // Update default port when scheme flips.
                  if (v === "sftp" && port === 21) setPort(22);
                  if (v === "ftp" && port === 22) setPort(21);
                }}
              >
                <MenuItem value="sftp">SFTP / SSH</MenuItem>
                <MenuItem value="ftp">FTP (plain)</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              label="Port"
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value) || 0)}
              sx={{ width: 100 }}
            />
          </Stack>

          <TextField
            size="small"
            label="User"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            helperText={
              scheme === "ftp"
                ? "Leave as 'anonymous' for public FTP mirrors."
                : undefined
            }
          />

          {scheme === "sftp" ? (
            <>
              <FormControl size="small">
                <Typography variant="caption" sx={{ mb: 0.5 }}>
                  Authentication
                </Typography>
                <RadioGroup
                  row
                  value={authMode}
                  onChange={(e) => setAuthMode(e.target.value as SftpAuth)}
                >
                  <FormControlLabel
                    value="password"
                    control={<Radio size="small" />}
                    label="Password"
                  />
                  <FormControlLabel
                    value="privateKey"
                    control={<Radio size="small" />}
                    label="Private key"
                  />
                  <FormControlLabel
                    value="agent"
                    control={<Radio size="small" />}
                    label="SSH agent"
                  />
                </RadioGroup>
              </FormControl>

              {authMode === "password" && (
                <TextField
                  size="small"
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              )}
              {authMode === "privateKey" && (
                <>
                  <TextField
                    size="small"
                    label="Private key path"
                    value={privateKeyPath}
                    onChange={(e) => setPrivateKeyPath(e.target.value)}
                    placeholder="~/.ssh/id_ed25519"
                  />
                  <TextField
                    size="small"
                    label="Passphrase (optional)"
                    type="password"
                    value={privateKeyPassphrase}
                    onChange={(e) => setPrivateKeyPassphrase(e.target.value)}
                  />
                </>
              )}
              {authMode === "agent" && (
                <Typography variant="caption" color="text.secondary">
                  Uses your running ssh-agent. No password needed.
                </Typography>
              )}
            </>
          ) : (
            <TextField
              size="small"
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              helperText="Leave as 'anonymous@' for public FTP mirrors."
            />
          )}

          {/* Save-as-draft toggle. Off when a saved draft is the
              source (already persisted); on by default for new
              connections so re-typing the host later reuses it. */}
          {selectedDraftId == null && (
            <FormControlLabel
              control={
                <Switch
                  checked={saveDraft}
                  onChange={(e) => setSaveDraft(e.target.checked)}
                />
              }
              label="Save this connection for next time"
            />
          )}

          {error && (
            <Typography variant="caption" color="error">
              {error}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleConnect()}
          disabled={busy || !host || !port}
        >
          {busy ? "Connecting…" : "Connect"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
