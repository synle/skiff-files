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
  Autocomplete,
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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  connCreateFtp,
  connCreateSftp,
  connCreateSmb,
  smbListShares,
} from "../api/conn";
import PathPickerField from "./PathPickerField";
import {
  loadFtpDrafts,
  loadSftpDrafts,
  loadSmbDrafts,
  matchFtpDraftsForHost,
  matchSftpDraftsForHost,
  matchSmbDraftsForHost,
  saveFtpDrafts,
  saveSftpDrafts,
  saveSmbDrafts,
  type FtpDraft,
  type SftpDraft,
  type SmbDraft,
} from "../state/connectionDrafts";

export interface RemoteConnectRequest {
  /** "sftp", "ftp", or "smb" — picked from the URL prefix. */
  scheme: "sftp" | "ftp" | "smb";
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
  const [scheme, setScheme] = useState<"sftp" | "ftp" | "smb">("ftp");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(21);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<SftpAuth>("password");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState("");
  // SMB-specific extras (share + AD domain). Set from a saved draft
  // on Use-click or directly from the form.
  const [smbShare, setSmbShare] = useState("");
  const [smbDomain, setSmbDomain] = useState("");
  /** Live list of disk shares the supplied credentials can see, used
   *  to populate the Share field's autocomplete options. Empty until
   *  the backend probe succeeds; a failed probe leaves it empty so
   *  the user can still free-type a share name. */
  const [smbShareOptions, setSmbShareOptions] = useState<string[]>([]);
  const [smbShareLoading, setSmbShareLoading] = useState(false);
  /** Bumped each time the user changes host/user/password/port —
   *  identifies an in-flight share-list request so a stale response
   *  doesn't overwrite the options for a subsequent attempt. */
  const smbProbeSeq = useRef(0);
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
  const [smbDrafts, setSmbDrafts] = useState<SmbDraft[]>([]);

  useEffect(() => {
    if (!open || !request) return;
    setSftpDrafts(loadSftpDrafts());
    setFtpDrafts(loadFtpDrafts());
    setSmbDrafts(loadSmbDrafts());
    setScheme(request.scheme);
    setHost(request.host);
    setPort(
      request.port ??
        (request.scheme === "sftp"
          ? 22
          : request.scheme === "smb"
            ? 445
            : 21),
    );
    setUser(request.user ?? (request.scheme === "ftp" ? "anonymous" : ""));
    setPassword(request.scheme === "ftp" ? "anonymous@" : "");
    setAuthMode("password");
    setPrivateKeyPath("");
    setPrivateKeyPassphrase("");
    // SMB-specific: try to pre-fill share from the typed remote
    // path's first segment (`smb://host/share/...`). Strip the leading
    // slash + take the first chunk. Empty stays empty so the field
    // is editable.
    if (request.scheme === "smb" && request.remotePath) {
      const trimmed = request.remotePath.replace(/^\/+/, "");
      const firstSlash = trimmed.indexOf("/");
      setSmbShare(firstSlash >= 0 ? trimmed.slice(0, firstSlash) : trimmed);
    } else {
      setSmbShare("");
    }
    setSmbDomain("");
    setSmbShareOptions([]);
    setSmbShareLoading(false);
    setSaveDraft(false);
    setSelectedDraftId(null);
    setError(null);
    setBusy(false);
  }, [open, request]);

  /** Manually trigger the SMB share-list probe with the form's
   *  current host / user / password / port / domain. Fires
   *  NetShareEnumAll server-side, feeds the result into the Share
   *  field's Autocomplete options.
   *
   *  CRITICAL: this must NEVER be wired to a useEffect over
   *  `[password]` — every keystroke would fire a probe with a
   *  partial password, and SMB servers (especially OpenWrt /
   *  router-based Samba) ban the source IP after a small number
   *  of rapid failed logins. The result is the legitimate full-
   *  password connect attempt gets TCP-dropped ("Disconnected from
   *  server") because the IP is already in the deny list. We call
   *  this on `onOpen` of the Share Autocomplete instead, so the
   *  probe only runs when the user explicitly asks for it — exactly
   *  once per dropdown open with the form's settled values. */
  const probeSmbShares = () => {
    if (scheme !== "smb") return;
    if (!host || !user || !password || !port) {
      setSmbShareOptions([]);
      setSmbShareLoading(false);
      return;
    }
    const seq = ++smbProbeSeq.current;
    setSmbShareLoading(true);
    void smbListShares({ host, port, user, password, domain: smbDomain })
      .then((names) => {
        if (smbProbeSeq.current !== seq) return;
        setSmbShareOptions(names);
      })
      .catch(() => {
        if (smbProbeSeq.current !== seq) return;
        // Probe failure isn't surfaced as an error — the user can
        // still type a share manually and the real Connect-button
        // call will report the auth/network problem with full
        // context. We just clear the options so a stale list from
        // a previous probe doesn't mislead.
        setSmbShareOptions([]);
      })
      .finally(() => {
        if (smbProbeSeq.current !== seq) return;
        setSmbShareLoading(false);
      });
  };

  // When the user edits host / port / user / password / domain, the
  // previously fetched share list no longer matches the new auth.
  // Clear the options (but DO NOT re-probe — see the comment above
  // `probeSmbShares`). The next dropdown-open re-fetches with the
  // settled values.
  useEffect(() => {
    setSmbShareOptions([]);
    setSmbShareLoading(false);
  }, [scheme, host, port, user, password, smbDomain]);

  const matches = useMemo(() => {
    if (!request) return [] as Array<
      | { kind: "sftp"; draft: SftpDraft }
      | { kind: "ftp"; draft: FtpDraft }
      | { kind: "smb"; draft: SmbDraft }
    >;
    // Only surface drafts matching the URL's scheme — typing `ftp://`
    // shouldn't suggest SSH credentials and vice-versa.
    if (request.scheme === "sftp") {
      const sftp = matchSftpDraftsForHost(
        sftpDrafts,
        request.host,
        request.port,
      );
      return sftp.map((d) => ({ kind: "sftp" as const, draft: d }));
    }
    if (request.scheme === "smb") {
      const smb = matchSmbDraftsForHost(smbDrafts, request.host, request.port);
      return smb.map((d) => ({ kind: "smb" as const, draft: d }));
    }
    const ftp = matchFtpDraftsForHost(ftpDrafts, request.host, request.port);
    return ftp.map((d) => ({ kind: "ftp" as const, draft: d }));
  }, [request, sftpDrafts, ftpDrafts, smbDrafts]);

  const applyDraft = (
    entry:
      | { kind: "sftp"; draft: SftpDraft }
      | { kind: "ftp"; draft: FtpDraft }
      | { kind: "smb"; draft: SmbDraft },
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
    } else if (entry.kind === "smb") {
      setSmbShare(entry.draft.share);
      setSmbDomain(entry.draft.domain);
      setAuthMode("password");
      setPassword(""); // user fills in real password
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
      } else if (scheme === "smb") {
        uuid = await connCreateSmb({
          host,
          port,
          share: smbShare,
          user,
          password,
          domain: smbDomain || undefined,
        });
        if (saveDraft && selectedDraftId == null) {
          // Friendly label: include the share suffix only when the
          // user picked one. Empty share = "browse all shares" mode,
          // and `admin@host:445/` would read as a typo.
          const baseLabel = smbDomain
            ? `${smbDomain}\\${user}@${host}:${port}`
            : `${user || "guest"}@${host}:${port}`;
          const next: SmbDraft = {
            id: `smb-${Date.now()}`,
            label: smbShare ? `${baseLabel}/${smbShare}` : baseLabel,
            host,
            port,
            share: smbShare,
            user,
            domain: smbDomain,
          };
          const merged = [...smbDrafts, next];
          saveSmbDrafts(merged);
          setSmbDrafts(merged);
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
      // For SMB the path tail depends on whether the user picked a
      // specific share. With a non-empty share, the connection binds
      // it at session-setup so the URL drops the share segment
      // (everything after `smb://<uuid>/` is share-relative). With an
      // empty share (0.2.277 share-agnostic mode), the connection
      // routes per-share at access time, so the URL must preserve
      // the share segment — `smb://<uuid>/<share-name>/<rel>`. For
      // SFTP / FTP the full remotePath survives as-is.
      let tail: string;
      if (scheme === "smb" && smbShare) {
        const trimmed = (request.remotePath || "/").replace(/^\/+/, "");
        const slash = trimmed.indexOf("/");
        tail = slash >= 0 ? `/${trimmed.slice(slash + 1)}` : "/";
      } else {
        tail = request.remotePath || "/";
      }
      // Bug 7 (0.2.279) — surface the new connection to every listener
      // (Sidebar HOSTS accordion, BrowserTabs tab labels, PathBar
      // friendly-label map) immediately. `ConnectionsPage` already
      // dispatches this on its inline-flow connects; the address-bar /
      // RemoteConnectDialog path was missing it, so newly-added SMB
      // (and SFTP / FTP) hosts only appeared in the sidebar after the
      // user navigated away and back. Fire BEFORE `onConnected` so the
      // Sidebar's `connList()` refresh wins the race with the route
      // change. Local-storage drafts are persisted above; that's a
      // separate channel.
      window.dispatchEvent(new CustomEvent("skiff:connections-changed"));
      onConnected(`${scheme}://${uuid}${tail}`);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!request) return null;

  return (
    // Render the Dialog's Paper as a real <form> so the browser
    // enforces `required` on every TextField with that prop. Hitting
    // Enter inside any field — or clicking Connect (type="submit") —
    // submits via this handler; if anything required is empty the
    // browser shows its native "Please fill out this field" tooltip
    // anchored to the offending input. preventDefault stops the
    // synthetic navigation form-submit triggers by default.
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          // MUI v9 types Paper as HTMLDivElement so its SubmitEvent
          // generic is HTMLDivElement — incorrect once we swap the
          // root with `component: "form"`. The runtime element is a
          // real <form>, so `currentTarget` IS an HTMLFormElement at
          // runtime; the cast just unwedges the static check.
          onSubmit: ((e: React.FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            void handleConnect();
          }) as unknown as React.FormEventHandler<HTMLDivElement>,
        },
      }}
    >
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
                            ? `SFTP · ${draft.user}@${draft.host}:${draft.port} · ${m.draft.authMode}`
                            : m.kind === "smb"
                              ? `SMB · ${draft.user || "guest"}@${draft.host}:${draft.port}/${m.draft.share}`
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
                  const v = e.target.value as "sftp" | "ftp" | "smb";
                  setScheme(v);
                  // Update default port when scheme flips. Only nudge
                  // the port when the current value matches one of
                  // the other defaults — preserves an explicitly-typed
                  // port (e.g. 2121) when the user re-picks the
                  // protocol.
                  if (v === "sftp" && (port === 21 || port === 445)) setPort(22);
                  if (v === "ftp" && (port === 22 || port === 445)) setPort(21);
                  if (v === "smb" && (port === 21 || port === 22)) setPort(445);
                }}
              >
                <MenuItem value="sftp">SFTP / SSH</MenuItem>
                <MenuItem value="ftp">FTP (plain)</MenuItem>
                <MenuItem value="smb">SMB / Samba</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              required
              label="Host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              required
              label="Port"
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value) || 0)}
              // HTML5 number-input min keeps the native validator
              // honest — `required` on a `type="number"` field with
              // value 0 would technically pass otherwise.
              slotProps={{ htmlInput: { min: 1, max: 65535 } }}
              sx={{ width: 100 }}
            />
          </Stack>

          {scheme === "sftp" ? (
            <>
              <TextField
                size="small"
                required
                label="User"
                value={user}
                onChange={(e) => setUser(e.target.value)}
              />
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
                  required
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              )}
              {authMode === "privateKey" && (
                <>
                  <PathPickerField
                    required
                    label="Private key path"
                    value={privateKeyPath}
                    onChange={setPrivateKeyPath}
                    placeholder="~/.ssh/id_ed25519"
                    filters={[
                      // SSH key files typically have no extension
                      // (`id_rsa`, `id_ed25519`), so we include the
                      // "All files" filter alongside the common
                      // exported / converted formats so a user with
                      // a PuTTY-style `.ppk` or PEM-exported key can
                      // still pick it via the dialog.
                      { name: "SSH keys", extensions: ["pem", "key", "ppk"] },
                      { name: "All files", extensions: ["*"] },
                    ]}
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
            <>
              {/* User + Password on one row — credentials read left-to-right
                  the way most NAS / FTP login UIs lay them out. SFTP keeps
                  its own layout above because the auth radio collapses
                  Password under a conditional render. */}
              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  // FTP defaults to "anonymous"; we pre-fill on open
                  // so the field is never actually empty there. SMB
                  // has no anonymous concept — require it.
                  required={scheme === "smb"}
                  label="User"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  helperText={
                    scheme === "ftp"
                      ? "Leave as 'anonymous' for public FTP mirrors."
                      : undefined
                  }
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  // FTP anonymous mirrors accept "anonymous@" as the
                  // password — pre-filled. SMB needs a real one.
                  required={scheme === "smb"}
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  helperText={
                    scheme === "ftp"
                      ? "Leave as 'anonymous@' for public mirrors."
                      : "Never persisted."
                  }
                  sx={{ flex: 1 }}
                />
              </Stack>

              {scheme === "smb" && (
                <Stack direction="row" spacing={1}>
                  {/* Share is now OPTIONAL (0.2.277, Bug 5). Leave it
                      empty and the connection enters share-agnostic
                      mode: the address bar form becomes
                      `smb://<uuid>/<share-name>/<path>` and listing
                      the root URL returns the server's shares as
                      virtual folders. Filling Share keeps the older
                      "bind one share at session-setup" shape, which
                      avoids a round-trip per share if you only care
                      about one. freeSolo keeps manual typing open
                      for NAS firmwares that hide their shares from
                      NetShareEnumAll. */}
                  <Autocomplete
                    freeSolo
                    size="small"
                    options={smbShareOptions}
                    value={smbShare}
                    onChange={(_e, v) => setSmbShare(typeof v === "string" ? v : "")}
                    onInputChange={(_e, v) => setSmbShare(v)}
                    // Probe is on-open only: typing the password
                    // pre-probe would fire a request with every
                    // keystroke and burn through router-level fail2ban
                    // throttles. Opening the dropdown means the user
                    // has settled on the credentials.
                    onOpen={probeSmbShares}
                    loading={smbShareLoading}
                    loadingText="Listing shares…"
                    noOptionsText="Fill host / user / password to list shares"
                    sx={{ flex: 1 }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Share (optional)"
                        helperText={
                          smbShareLoading
                            ? "Listing shares…"
                            : smbShareOptions.length > 0
                              ? `${smbShareOptions.length} share${smbShareOptions.length === 1 ? "" : "s"} available — pick one or leave empty to browse all`
                              : "Leave empty to browse every share, or pick one"
                        }
                      />
                    )}
                  />
                  <TextField
                    size="small"
                    label="Domain (optional)"
                    value={smbDomain}
                    onChange={(e) => setSmbDomain(e.target.value)}
                    helperText="AD domain; leave empty for home / NAS"
                    sx={{ flex: 1 }}
                  />
                </Stack>
              )}
            </>
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
        <Button onClick={onClose} disabled={busy} type="button">
          Cancel
        </Button>
        <Button
          variant="contained"
          type="submit"
          // No onClick — submission flows through the <form onSubmit>
          // on the Dialog's Paper. That path runs the browser's
          // built-in validity check first, which is what surfaces the
          // "Please fill out this field" tooltip on missing required
          // inputs. An onClick would bypass that check.
          disabled={busy}
        >
          {busy ? "Connecting…" : "Connect"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
