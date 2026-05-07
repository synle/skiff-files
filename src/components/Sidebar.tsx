// Left sidebar — Phase 1 only ships Favorites + a Settings link. Hosts and
// Devices sections come online when the connection layer lands in Phase 2.
import {
  Box,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
} from "@mui/material";
import HomeIcon from "@mui/icons-material/Home";
import DescriptionIcon from "@mui/icons-material/Description";
import DesktopWindowsIcon from "@mui/icons-material/DesktopWindows";
import DownloadIcon from "@mui/icons-material/Download";
import SettingsIcon from "@mui/icons-material/Settings";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import HubIcon from "@mui/icons-material/Hub";
import CircleIcon from "@mui/icons-material/Circle";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import CloseIcon from "@mui/icons-material/Close";
import HistoryIcon from "@mui/icons-material/History";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import { Link as RouterLink } from "react-router";
import { useEffect, useState } from "react";
import { connList, type ConnectionInfo } from "../api/conn";
import {
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useSettings,
} from "../state/settings";
import { startSync } from "../api/client";

/** MIME type the FileList row uses to carry dragged paths. Newline-
 *  joined for multi-select drops. Sidebar host items handle this MIME
 *  in onDrop; OS drag-drop into the Browser pane uses Tauri's separate
 *  drag-drop event so the two flows don't collide. */
export const SKIFF_DRAG_MIME = "application/x-skiff-paths";

interface Favorite {
  label: string;
  /** Relative-from-home segment. The Browser resolves this against the actual
   *  home dir before navigating. */
  rel: string;
  icon: React.ReactNode;
}

const FAVORITES: Favorite[] = [
  { label: "Home", rel: "", icon: <HomeIcon fontSize="small" /> },
  { label: "Desktop", rel: "Desktop", icon: <DesktopWindowsIcon fontSize="small" /> },
  { label: "Documents", rel: "Documents", icon: <DescriptionIcon fontSize="small" /> },
  { label: "Downloads", rel: "Downloads", icon: <DownloadIcon fontSize="small" /> },
];

interface Props {
  /** Absolute home dir, resolved at app start. May be empty during the first
   *  paint — favorite buttons are disabled until it arrives. */
  home: string;
  onNavigate: (path: string) => void;
}

/** Simple list of favorite shortcuts + Connections + a Settings link. */
export default function Sidebar({ home, onNavigate }: Props) {
  // POSIX-style join is fine here — Tauri normalizes the slashes for us when
  // we hand the path to canonicalize / list_dir.
  const join = (rel: string) => (rel ? `${home}/${rel}` : home);

  const { settings, update } = useSettings();
  /** Rename a bookmark's display label without changing its target
   *  path. Uses a native `window.prompt` to keep this change tiny —
   *  a richer inline edit affordance can land later if users ask. */
  const renameBookmark = (id: string) => {
    const current = settings.bookmarks.find((b) => b.id === id);
    if (!current) return;
    const next = window.prompt("Rename bookmark", current.label);
    if (next == null) return; // user cancelled
    const trimmed = next.trim();
    if (!trimmed || trimmed === current.label) return;
    update(
      "bookmarks",
      settings.bookmarks.map((b) =>
        b.id === id ? { ...b, label: trimmed } : b,
      ),
    );
  };

  const removeBookmark = (id: string) => {
    update(
      "bookmarks",
      settings.bookmarks.filter((b) => b.id !== id),
    );
  };

  /** Are we currently collapsed for a section? Missing key = expanded. */
  const isCollapsed = (id: string): boolean =>
    !!settings.sidebarCollapsed[id];
  const toggleSection = (id: string) => {
    const collapsed = isCollapsed(id);
    if (settings.sidebarAccordion && collapsed) {
      // Accordion mode: expanding one auto-collapses every other
      // visible section. Hidden sections aren't touched (their
      // collapsed state is moot). Keys are derived from the section
      // IDs the Sidebar renders.
      const ALL_IDS = ["favorites", "bookmarks", "recent", "hosts", "devices"];
      const next: Record<string, boolean> = { ...settings.sidebarCollapsed };
      for (const k of ALL_IDS) {
        if (k !== id) next[k] = true;
      }
      next[id] = false;
      update("sidebarCollapsed", next);
      return;
    }
    update("sidebarCollapsed", {
      ...settings.sidebarCollapsed,
      [id]: !collapsed,
    });
  };
  /** Is the section visible at all? Missing key = visible (default).
   *  Hidden sections render nothing — neither header nor body. */
  const isVisible = (id: string): boolean =>
    settings.sidebarSectionsVisible[id] !== false;

  /** Section header — clickable; flips the chevron and toggles
   *  collapsed state. Pure presentation; the children are rendered
   *  by the caller and gated separately. */
  const SectionHeader = ({ id, label }: { id: string; label: string }) => {
    const collapsed = isCollapsed(id);
    return (
      <Box
        component="button"
        onClick={() => toggleSection(id)}
        aria-expanded={!collapsed}
        aria-controls={`sidebar-section-${id}`}
        sx={{
          appearance: "none",
          background: "transparent",
          border: 0,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          width: "100%",
          textAlign: "left",
          px: 2,
          pt: 1.5,
          color: "text.secondary",
          fontSize: "0.6875rem",
          fontWeight: 500,
          letterSpacing: "0.08333em",
          textTransform: "uppercase",
          "&:hover": { color: "text.primary" },
        }}
      >
        {collapsed ? (
          <KeyboardArrowRightIcon sx={{ fontSize: 14 }} />
        ) : (
          <KeyboardArrowDownIcon sx={{ fontSize: 14 }} />
        )}
        {label}
      </Box>
    );
  };

  // Live connections, refreshed on mount + when other code dispatches the
  // 'skiff:connections-changed' event (Connections page does that on
  // connect/disconnect). A poll loop would be wasted work given how rare
  // these state changes are.
  const [connections, setConnections] = useState<ConnectionInfo[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      connList()
        .then((c) => !cancelled && setConnections(c))
        .catch(() => !cancelled && setConnections([]));
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener("skiff:connections-changed", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("skiff:connections-changed", onChange);
    };
  }, []);

  /** Drag-to-resize. The handle is a thin Box on the sidebar's right
   *  edge with cursor:col-resize. mouseDown captures the starting
   *  coordinates; mousemove updates the width; mouseup tears down
   *  the listeners. We use document-level mousemove rather than the
   *  handle's own so a fast drag past the edge doesn't drop the
   *  pointer outside our listener. */
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = settings.sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const next = Math.max(
        SIDEBAR_WIDTH_MIN,
        Math.min(SIDEBAR_WIDTH_MAX, startW + dx),
      );
      update("sidebarWidth", next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <Box
      component="nav"
      aria-label="Sidebar"
      sx={{
        width: settings.sidebarWidth,
        flexShrink: 0,
        borderRight: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        // Position relative so the absolute resize handle anchors
        // here, not at the document root.
        position: "relative",
      }}
    >
      <Box sx={{ flex: 1, overflow: "auto" }}>
        {isVisible("favorites") && <SectionHeader id="favorites" label="Favorites" />}
        {isVisible("favorites") && !isCollapsed("favorites") && (
          <List dense disablePadding id="sidebar-section-favorites">
            {FAVORITES.map((f) => (
              <ListItem key={f.label} disablePadding>
                <ListItemButton
                  disabled={!home}
                  onClick={() => onNavigate(join(f.rel))}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>{f.icon}</ListItemIcon>
                  <ListItemText primary={f.label} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}

        {isVisible("bookmarks") && settings.bookmarks.length > 0 && (
          <>
            <SectionHeader id="bookmarks" label="Bookmarks" />
            {!isCollapsed("bookmarks") && (
            <List dense disablePadding id="sidebar-section-bookmarks">
              {settings.bookmarks.map((b) => (
                <ListItem
                  key={b.id}
                  disablePadding
                  secondaryAction={
                    <IconButton
                      size="small"
                      edge="end"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeBookmark(b.id);
                      }}
                      aria-label={`Remove bookmark ${b.label}`}
                      sx={{ p: 0.25 }}
                    >
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  }
                >
                  <ListItemButton
                    onClick={() => onNavigate(b.path)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      renameBookmark(b.id);
                    }}
                    title="Right-click to rename"
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <BookmarkIcon fontSize="small" color="primary" />
                    </ListItemIcon>
                    <ListItemText
                      primary={b.label}
                      slotProps={{
                        primary: { variant: "body2", noWrap: true },
                      }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
            )}
          </>
        )}

        {isVisible("recent") && settings.recentPaths.length > 0 && (
          <>
            <SectionHeader id="recent" label="Recent" />
            {!isCollapsed("recent") && (
            <List dense disablePadding id="sidebar-section-recent">
              {settings.recentPaths.slice(0, 5).map((p) => {
                // Pretty label: basename + a short parent hint so the
                // list isn't ambiguous when multiple folders share a
                // basename ("src" in two different repos, etc.).
                const segs = p.split(/[\\/]/).filter(Boolean);
                const label = segs.at(-1) ?? p;
                const parent = segs.length >= 2 ? segs[segs.length - 2] : "";
                return (
                  <ListItem key={p} disablePadding>
                    <ListItemButton onClick={() => onNavigate(p)}>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <HistoryIcon
                          fontSize="small"
                          sx={{ color: "text.secondary" }}
                        />
                      </ListItemIcon>
                      <ListItemText
                        primary={label}
                        secondary={parent || undefined}
                        slotProps={{
                          primary: { variant: "body2", noWrap: true },
                          secondary: { variant: "caption", noWrap: true },
                        }}
                      />
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
            )}
          </>
        )}

        {isVisible("hosts") && <SectionHeader id="hosts" label="Hosts" />}
        {isVisible("hosts") && !isCollapsed("hosts") && (
        <Box id="sidebar-section-hosts">
        {connections == null ? (
          <Box sx={{ px: 2, py: 0.5 }}>
            <CircularProgress size={14} />
          </Box>
        ) : connections.length === 0 ? (
          <List dense disablePadding>
            <ListItem disablePadding>
              <ListItemButton component={RouterLink} to="/connections">
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <HubIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary="Add connection…"
                  slotProps={{ primary: { variant: "body2" } }}
                />
              </ListItemButton>
            </ListItem>
          </List>
        ) : (
          <List dense disablePadding>
            {connections.map((c) => (
              <ListItem key={c.id} disablePadding>
                <ListItemButton
                  onClick={() =>
                    onNavigate(`sftp://${c.id}/`)
                  }
                  // Drag-drop target: dropping a Skiff selection here
                  // starts a Skiffsync job from the dragged paths to a
                  // user-prompted destination on the remote. Uses the
                  // custom MIME so OS-file drags fall through to the
                  // Browser pane's existing drop handler.
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(SKIFF_DRAG_MIME)) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                    }
                  }}
                  onDrop={(e) => {
                    const raw = e.dataTransfer.getData(SKIFF_DRAG_MIME);
                    if (!raw) return;
                    e.preventDefault();
                    const paths = raw.split("\n").filter(Boolean);
                    if (paths.length === 0) return;
                    const remoteDest = window.prompt(
                      `Sync ${paths.length} item${paths.length === 1 ? "" : "s"} to ${c.label}. Destination path on remote:`,
                      "/",
                    );
                    if (!remoteDest) return;
                    for (const p of paths) {
                      // Nest each entry under <dest>/<basename>.
                      const segs = p.split(/[\\/]/).filter(Boolean);
                      const base = segs.at(-1) ?? p;
                      const target = `sftp://${c.id}${remoteDest.endsWith("/") ? remoteDest : remoteDest + "/"}${base}`;
                      void startSync(p, target, {
                        maxSizeGb: 100,
                        conflictPolicy: "skip",
                      }).catch(() => {
                        /* errors surface in TransfersPage */
                      });
                    }
                  }}
                  aria-label={`Browse ${c.label}`}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    {settings.sidebarShowStatusDots ? (
                      <Tooltip title="Connected">
                        <CircleIcon
                          sx={{ fontSize: 10, color: "success.main" }}
                        />
                      </Tooltip>
                    ) : (
                      <HubIcon fontSize="small" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={c.label}
                    slotProps={{
                      primary: { variant: "body2", noWrap: true },
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
            <ListItem disablePadding>
              <ListItemButton component={RouterLink} to="/connections">
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <HubIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary="Manage connections…"
                  slotProps={{ primary: { variant: "body2" } }}
                />
              </ListItemButton>
            </ListItem>
          </List>
        )}
        </Box>
        )}

        {isVisible("devices") && <SectionHeader id="devices" label="Devices" />}
        {isVisible("devices") && !isCollapsed("devices") && (
          <Typography
            variant="caption"
            sx={{ px: 2, color: "text.disabled", display: "block" }}
            id="sidebar-section-devices"
          >
            (mounted volumes — Phase 5)
          </Typography>
        )}
      </Box>

      <List dense disablePadding sx={{ borderTop: 1, borderColor: "divider" }}>
        <ListItem disablePadding>
          <ListItemButton component={RouterLink} to="/transfers">
            <ListItemIcon sx={{ minWidth: 32 }}>
              <SwapHorizIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Transfers" />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton component={RouterLink} to="/settings">
            <ListItemIcon sx={{ minWidth: 32 }}>
              <SettingsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Settings" />
          </ListItemButton>
        </ListItem>
      </List>

      {/* Resize handle — thin column on the right edge. We make it
          slightly wider than 1px so the cursor target is forgiving;
          the visible divider is the parent Box's border. */}
      <Box
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={startDrag}
        sx={{
          position: "absolute",
          top: 0,
          right: -3,
          bottom: 0,
          width: 6,
          cursor: "col-resize",
          // Light primary tint on hover so the user discovers the
          // handle. Stays invisible at rest.
          transition: "background-color 120ms",
          "&:hover": { backgroundColor: "primary.light" },
          zIndex: 1,
        }}
      />
    </Box>
  );
}
