// Breadcrumb path bar with click-to-jump segments and an editable input mode.
// Pressing Enter in edit mode navigates; Escape cancels. We canonicalize via
// the Rust backend so `~/foo` and `../bar` resolve to absolute paths the rest
// of the app can rely on.
import {
  Box,
  Breadcrumbs,
  Chip,
  IconButton,
  Link,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import HomeIcon from "@mui/icons-material/Home";
import { useEffect, useRef, useState } from "react";
import { fsCanonicalize, fsRevealInOs } from "../api/fs";
import { parseRemoteUrl } from "../util/remoteResolve";
import { listDir } from "../api/client";
import { pathSegments } from "../util/format";
import { humanizeRemoteUrl } from "../util/humanizeRemoteUrl";
import { isRemote, parseLocation } from "../util/location";
import { completePath, splitForCompletion } from "../util/autocomplete";
import { OPEN_IN_TAB_EVENT } from "../App";
import { connList, type ConnectionInfo } from "../api/conn";

interface Props {
  path: string;
  onNavigate: (path: string) => void;
  onHome: () => void;
  /** Counter that flips the bar into edit mode whenever it changes.
   *  Browser increments it in response to Cmd/Ctrl+L. We use a counter
   *  rather than a boolean so repeated presses re-focus even when the
   *  bar is already editing (matches browser address-bar muscle memory). */
  focusRequest?: number;
}

/** Two modes: breadcrumb (default) and editable text. Toggle via the pencil. */
export default function PathBar({ path, onNavigate, onHome, focusRequest }: Props) {
  const [editing, setEditing] = useState(false);
  // `draft` always holds the *humanized* form (`smb://admin@host:445/G`)
  // when the current path is remote — never the raw `smb://<uuid>/`
  // routing key. UUIDs are an internal-only routing key and would
  // confuse the user if they ever ended up in the address bar (and
  // copy-pasting one elsewhere would send the UUID instead of the host).
  const [draft, setDraft] = useState(path);
  /** Per-segment right-click menu state. `null` = closed. */
  const [segMenu, setSegMenu] = useState<{
    x: number;
    y: number;
    segPath: string;
  } | null>(null);

  // Connection-id → registry label map. Lets us swap the raw UUID at
  // the start of an `smb://<uuid>/…` / `sftp://<uuid>/…` breadcrumb
  // for a human label (`admin@192.168.1.1:445/G`) — same shape the tab
  // strip in `BrowserTabs` already uses. Outside Tauri (test runs) the
  // initial `connList()` rejects and we keep the empty map; the
  // breadcrumb gracefully falls back to the UUID.
  const [connMap, setConnMap] = useState<Map<string, ConnectionInfo>>(
    new Map(),
  );
  useEffect(() => {
    const refresh = () => {
      void connList()
        .then((list) => setConnMap(new Map(list.map((c) => [c.id, c]))))
        .catch(() => { /* outside Tauri — keep empty */ });
    };
    refresh();
    window.addEventListener("skiff:connections-changed", refresh);
    return () =>
      window.removeEventListener("skiff:connections-changed", refresh);
  }, []);

  // `id → label` view of the connMap that `humanizeRemoteUrl` consumes
  // directly. Recomputed when `connMap` changes; cheap enough to skip
  // a useMemo cache.
  const labelMap = new Map(
    Array.from(connMap.entries(), ([id, info]) => [id, info.label]),
  );
  /** Always return the user-facing form of a path. Remote paths get
   *  their UUID prefix swapped for the friendly host label so the
   *  address bar reads `smb://admin@host:445/G/sub` instead of
   *  `smb://<uuid>/sub` — UUIDs are an internal routing key the user
   *  should never see (clicking the pencil used to leak them into the
   *  draft, which then surfaced macOS Finder's "df204a67-… server not
   *  found" toast when the URL was forwarded to the OS). */
  const humanize = (p: string) => humanizeRemoteUrl(p, labelMap);

  // External "please focus me" pulses (Cmd/Ctrl+L from Browser). The
  // counter pattern means repeated presses re-fire even when we're
  // already in edit mode; the autoFocus on the TextField handles the
  // first transition and the explicit focus() the subsequent ones.
  useEffect(() => {
    if (focusRequest === undefined || focusRequest === 0) return;
    setEditing(true);
    setDraft(humanize(path));
    // Wait a tick so the TextField mounts before we focus / select.
    queueMicrotask(() => {
      const el = document.querySelector<HTMLInputElement>(
        'input[aria-label="Path"]',
      );
      el?.focus();
      el?.select();
    });
    // Intentionally don't depend on `path` — only fire when the
    // counter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);
  /** Cache of the last parent listing, keyed by parent path. Avoids
   *  re-issuing list_dir on every Tab press. Cleared when the parent
   *  changes (the next Tab refetches). */
  const cacheRef = useRef<{ parent: string; entries: { name: string; isDir: boolean }[] } | null>(null);

  // Keep the draft in sync with the current path so the next edit-mode
  // opening starts from the latest value. We deliberately skip the sync
  // while the user is editing — otherwise the connMap-resolved
  // re-humanize would clobber a half-typed value (the autocomplete
  // tests regressed exactly here when connList resolved mid-Tab).
  useEffect(() => {
    if (editing) return;
    setDraft(humanize(path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, connMap, editing]);


  const segments = pathSegments(path);
  // Remote-aware breadcrumb shape: when the path is `smb://<uuid>/…`
  // we render a protocol chip + the friendly connection label in
  // place of the first breadcrumb segment (the UUID). The remaining
  // share-relative segments render unchanged. Mirrors the tab-strip
  // contract so the address bar and the tab title read identically.
  const loc = parseLocation(path);
  const isRemoteLoc = loc.backend.kind !== "local";
  const remoteConn =
    loc.backend.kind !== "local"
      ? connMap.get(loc.backend.connectionId) ?? null
      : null;
  // Skip the leading "/" segment AND, for remote paths, the
  // connection-id segment — both are replaced by the protocol chip
  // + friendly label rendered separately. Local paths keep their
  // existing slice (just drop the visual "/").
  const visibleSegments = segments.filter((seg, idx) => {
    if (seg.label === "/") return false;
    if (isRemoteLoc && idx === 0) return false; // raw UUID
    return true;
  });

  const commit = async () => {
    const target = draft.trim();
    if (!target) {
      setEditing(false);
      return;
    }
    // Remote paths are already absolute — there's no `~` expansion in
    // `sftp://` and we don't have a remote canonicalize endpoint yet.
    if (isRemote(target)) {
      // Friendly-form roundtrip: the address bar now SHOWS
      // `smb://admin@host:445/G/sub` (humanized) when the underlying
      // path is `smb://<uuid>/sub`. If the user commits that same
      // friendly form against a connection that's already live, we
      // can skip the connect dialog and go straight to the canonical
      // `<scheme>://<id>/...` URL. Sort by label-length DESCENDING so
      // bound-share labels (`...:445/G`) win over the bare-host
      // label (`...:445`) for the same connection — otherwise the
      // shorter prefix would match `/G/sub` as the remote path tail
      // and we'd lose the share binding.
      const sorted = [...connMap.entries()].sort(
        (a, b) => b[1].label.length - a[1].label.length,
      );
      for (const [id, info] of sorted) {
        const friendlyPrefix = `${info.kind}://${info.label}`;
        if (target === friendlyPrefix || target.startsWith(friendlyPrefix + "/")) {
          const tail = target.slice(friendlyPrefix.length) || "/";
          onNavigate(`${info.kind}://${id}${tail}`);
          setEditing(false);
          return;
        }
      }
      // No active connection matches — fall back to the host-form
      // resolver. FTP/SFTP host-form URLs (e.g. `ftp://192.168.1.1/pub`,
      // `sftp://example.com:2222/`) need to be resolved against the
      // saved-drafts list — and possibly prompt the user for
      // credentials — before we can navigate to a canonical
      // `<scheme>://<uuid>/...` URL. `parseRemoteUrl` returns the
      // shape `RemoteConnectDialog` consumes; Browser listens on
      // window for the event and opens the dialog. UUID-shaped URLs
      // (parseRemoteUrl returns null for them) skip the dialog and
      // navigate directly.
      const req = parseRemoteUrl(target);
      if (req) {
        setEditing(false);
        window.dispatchEvent(
          new CustomEvent("skiff:connect-to-remote", { detail: req }),
        );
        return;
      }
      onNavigate(target);
      setEditing(false);
      return;
    }
    try {
      const abs = await fsCanonicalize(target);
      onNavigate(abs);
    } catch {
      // Fall back to the raw input — if it doesn't exist the list_dir call
      // downstream will surface a friendlier error in the file list.
      onNavigate(target);
    }
    setEditing(false);
  };

  /** Tab handler: fetch the parent's entries (cached per-parent) and
   *  rewrite `draft` with the completed value via the pure helper.
   *  Silent on no-progress / no-match — the user just sees Tab do
   *  nothing, matching shell autocomplete behavior. */
  const completeWithTab = async () => {
    const { parent } = splitForCompletion(draft);
    if (!parent) return;
    let entries = cacheRef.current?.parent === parent ? cacheRef.current.entries : null;
    if (!entries) {
      try {
        const list = await listDir(parent);
        entries = list.map((e) => ({ name: e.name, isDir: e.isDir }));
        cacheRef.current = { parent, entries };
      } catch {
        return; // parent doesn't exist / unreachable — silently bail
      }
    }
    const next = completePath(draft, entries);
    if (next != null) setDraft(next);
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        py: 0.5,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Tooltip title="Home">
        <IconButton size="small" onClick={onHome} aria-label="Home">
          <HomeIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {editing ? (
        <TextField
          autoFocus
          size="small"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") {
              setDraft(path);
              setEditing(false);
            }
            if (e.key === "Tab") {
              // Don't let Tab leave the input; that would break the
              // typical shell-style "press Tab again to keep
              // completing" muscle memory.
              e.preventDefault();
              void completeWithTab();
            }
          }}
          onBlur={() => setEditing(false)}
          sx={{ flexGrow: 1 }}
          slotProps={{ htmlInput: { "aria-label": "Path" } }}
        />
      ) : (
        <Box
          sx={{
            flexGrow: 1,
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            overflow: "hidden",
          }}
        >
          {loc.backend.kind !== "local" && (
            // Protocol chip — SMB / SFTP / FTP — same shape the tab
            // strip uses. Tooltip carries the raw connection id so
            // users can still copy/paste the UUID if they need to.
            <Tooltip
              title={`${loc.backend.kind.toUpperCase()} · ${loc.backend.connectionId}`}
            >
              <Chip
                size="small"
                label={loc.backend.kind.toUpperCase()}
                onClick={() => onNavigate(segments[0]?.path ?? path)}
                aria-label={`${loc.backend.kind} connection root`}
                sx={{
                  height: 18,
                  fontSize: 10,
                  cursor: "pointer",
                  "& .MuiChip-label": { px: 0.5 },
                }}
              />
            </Tooltip>
          )}
          {isRemoteLoc && remoteConn && (
            // Friendly registry label (e.g. `admin@192.168.1.1:445/G`)
            // replacing the raw UUID at the start of the breadcrumb.
            // Clickable — navigates to the connection root.
            <Link
              component="button"
              onClick={() => onNavigate(segments[0]?.path ?? path)}
              underline="hover"
              color="inherit"
              title={remoteConn.label}
              sx={{ fontSize: "0.875rem", fontWeight: 500, whiteSpace: "nowrap" }}
            >
              {remoteConn.label}
            </Link>
          )}
          <Breadcrumbs
            sx={{ flexGrow: 1, overflow: "hidden", minWidth: 0 }}
            maxItems={6}
            onContextMenu={(e) => {
              // Right-click anywhere in the breadcrumb strip copies
              // the full current path to the clipboard. Best-effort —
              // silent fallback in tests / browsers without clipboard
              // permission.
              e.preventDefault();
              if (typeof navigator !== "undefined" && navigator.clipboard) {
                void navigator.clipboard.writeText(path);
              }
            }}
            title="Right-click to copy full path"
          >
            {visibleSegments.map((seg) => (
              <Link
                key={seg.path}
                component="button"
                onClick={() => onNavigate(seg.path)}
                onContextMenu={(e: React.MouseEvent) => {
                  // Stop the parent Breadcrumbs handler (which copies
                  // the full path) so the per-segment menu wins.
                  e.preventDefault();
                  e.stopPropagation();
                  setSegMenu({
                    x: e.clientX,
                    y: e.clientY,
                    segPath: seg.path,
                  });
                }}
                underline="hover"
                color="inherit"
                // Hover surfaces the full path-up-to-here, useful when
                // the breadcrumb truncates with `maxItems` and the user
                // wants to know what a middle segment actually points at.
                title={seg.path}
                sx={{ fontSize: "0.875rem" }}
              >
                {seg.label}
              </Link>
            ))}
          </Breadcrumbs>
        </Box>
      )}

      <Tooltip title={editing ? "Cancel" : "Edit path"}>
        <IconButton
          size="small"
          onClick={() => setEditing((e) => !e)}
          aria-label="Edit path"
        >
          <EditIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Menu
        open={segMenu != null}
        onClose={() => setSegMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={
          segMenu ? { top: segMenu.y, left: segMenu.x } : undefined
        }
        slotProps={{ list: { dense: true } }}
      >
        <MenuItem
          onClick={() => {
            if (segMenu) onNavigate(segMenu.segPath);
            setSegMenu(null);
          }}
        >
          Open
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (segMenu) {
              window.dispatchEvent(
                new CustomEvent(OPEN_IN_TAB_EVENT, { detail: segMenu.segPath }),
              );
            }
            setSegMenu(null);
          }}
        >
          Open in new tab
        </MenuItem>
        <MenuItem
          disabled={!!segMenu && isRemote(segMenu.segPath)}
          onClick={() => {
            if (segMenu) void fsRevealInOs(segMenu.segPath).catch(() => {});
            setSegMenu(null);
          }}
        >
          Reveal in Finder/Explorer
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (segMenu && navigator?.clipboard) {
              void navigator.clipboard.writeText(segMenu.segPath);
            }
            setSegMenu(null);
          }}
        >
          Copy path
        </MenuItem>
      </Menu>
    </Box>
  );
}
