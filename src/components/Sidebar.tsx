// Left sidebar — Phase 1 only ships Favorites + a Settings link. Hosts and
// Devices sections come online when the connection layer lands in Phase 2.
import {
  Badge,
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
import DeleteIcon from "@mui/icons-material/Delete";
import HomeIcon from "@mui/icons-material/Home";
import DescriptionIcon from "@mui/icons-material/Description";
import DesktopWindowsIcon from "@mui/icons-material/DesktopWindows";
import DownloadIcon from "@mui/icons-material/Download";
import SettingsIcon from "@mui/icons-material/Settings";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import HubIcon from "@mui/icons-material/Hub";
import StorageIcon from "@mui/icons-material/Storage";
import UsbIcon from "@mui/icons-material/Usb";
import CircleIcon from "@mui/icons-material/Circle";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import CloseIcon from "@mui/icons-material/Close";
import HistoryIcon from "@mui/icons-material/History";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import SidebarContextMenu, {
  type SidebarContextState,
} from "./SidebarContextMenu";
import { OPEN_IN_TAB_EVENT, type Page } from "../App";
import { useEffect, useState } from "react";
import { connList, type ConnectionInfo } from "../api/conn";
import {
  fsMounts,
  fsOpenWithDefault,
  fsRevealInOs,
  fsTrashMany,
  fsTrashPath,
  type MountedVolume,
} from "../api/fs";
import LaunchIcon from "@mui/icons-material/Launch";
import SortByAlphaIcon from "@mui/icons-material/SortByAlpha";
import ViewWeekIcon from "@mui/icons-material/ViewWeek";
import SearchIcon from "@mui/icons-material/Search";
import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank";
import { formatBytes } from "../util/format";
import { onDone, onError, onProgress, syncList } from "../api/sync";
import {
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useSettings,
} from "../state/settings";
import { startSync } from "../api/client";
import { pushTrashBatch } from "../util/trashStack";

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

/** Section header — clickable; flips the chevron and toggles
 *  collapsed state. Defined outside Sidebar so React doesn't tear
 *  down + remount it on every parent render (that broke the click
 *  flow before — the user could click the header but state never
 *  updated because the listener was attached to a stale element).
 *
 *  Optional `onHide` adds a small × button at the right edge that
 *  hides the entire section (so the user doesn't have to dig into
 *  Settings → Sidebar to hide a section they don't use). The icon
 *  is intentionally tiny + only appears on hover so it doesn't
 *  invite accidental clicks. */
function SectionHeader({
  id,
  label,
  collapsed,
  onToggle,
  onHide,
}: {
  id: string;
  label: string;
  collapsed: boolean;
  /** Receives the modifier flag — when Cmd/Ctrl is held, the
   *  parent should collapse / expand ALL sections instead of just
   *  the clicked one. */
  onToggle: (modifier: boolean) => void;
  onHide?: () => void;
}) {
  return (
    <Box
      sx={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        // Reveal the hide button on hover only — full-time visibility
        // is too easy to mis-click with the section header just above.
        "&:hover .sidebar-section-hide": { opacity: 1 },
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={(e: React.MouseEvent) =>
          onToggle(e.metaKey || e.ctrlKey)
        }
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
          flex: 1,
          textAlign: "left",
          px: 2,
          pt: 1.5,
          pb: 0.25,
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
      {onHide && (
        <Tooltip title="Hide section (re-enable in Settings → Sidebar)">
          <IconButton
            className="sidebar-section-hide"
            size="small"
            onClick={(e) => {
              // Stop the parent header click from also firing the
              // collapse toggle.
              e.stopPropagation();
              onHide();
            }}
            sx={{
              position: "absolute",
              right: 4,
              top: 8,
              p: 0.25,
              opacity: 0,
              transition: "opacity 120ms",
              color: "text.disabled",
              "&:hover": { color: "text.primary" },
            }}
            aria-label={`Hide ${label} section`}
          >
            <CloseIcon sx={{ fontSize: 12 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

interface Props {
  /** Absolute home dir, resolved at app start. May be empty during the first
   *  paint — favorite buttons are disabled until it arrives. */
  home: string;
  /** Active top-level page — drives the Settings/Transfers/Connections
   *  buttons' selected styling. */
  page: Page;
  /** Switch the active page. App owns the state. */
  onSwitchPage: (p: Page) => void;
  onNavigate: (path: string) => void;
}

/** Simple list of favorite shortcuts + Connections + a Settings link. */
export default function Sidebar({ home, page, onSwitchPage, onNavigate }: Props) {
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

  /** Move a bookmark one slot in the list. Clamped at the boundary
   *  so the up/down icons can stay always-rendered without cluttering
   *  the row with disabled-state styling. */
  const moveBookmark = (id: string, direction: "up" | "down") => {
    const idx = settings.bookmarks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= settings.bookmarks.length) return;
    const next = [...settings.bookmarks];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    update("bookmarks", next);
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
  const toggleSection = (id: string, allSections = false) => {
    const ALL_IDS = [
      "favorites",
      "bookmarks",
      "workspaces",
      "searches",
      "syncjobs",
      "selections",
      "recent",
      "hosts",
      "devices",
    ];
    if (allSections) {
      // Cmd-click on a header → flip ALL sections to the OPPOSITE
      // of the clicked section's current state. So if the clicked
      // section was expanded, every section collapses; if it was
      // collapsed, every section expands. Matches OS-tree gestures
      // (Finder Cmd-click on a disclosure triangle).
      const target = !isCollapsed(id);
      const next: Record<string, boolean> = { ...settings.sidebarCollapsed };
      for (const k of ALL_IDS) next[k] = target;
      update("sidebarCollapsed", next);
      return;
    }
    const collapsed = isCollapsed(id);
    if (settings.sidebarAccordion && collapsed) {
      // Accordion mode: expanding one auto-collapses every other
      // visible section. Hidden sections aren't touched (their
      // collapsed state is moot). Keys are derived from the section
      // IDs the Sidebar renders.
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

  /** Hide a section entirely. Persisted in
   *  `Settings.sidebarSectionsVisible[id] = false`. Mirrors the
   *  toggles on Settings → Sidebar so users have a one-click escape
   *  hatch from the Sidebar itself. */
  const hideSection = (id: string) => {
    update("sidebarSectionsVisible", {
      ...settings.sidebarSectionsVisible,
      [id]: false,
    });
  };

  /** Anchor + actions for the per-row context menu. Null when no
   *  menu is open. */
  const [contextMenu, setContextMenu] = useState<SidebarContextState | null>(
    null,
  );

  /** Hide a hardcoded favorite (Home / Desktop / Documents / Downloads
   *  / Trash). Persisted via `hiddenFavorites: string[]` so the
   *  setting survives restart. */
  const hideFavorite = (rel: string) => {
    if (settings.hiddenFavorites.includes(rel)) return;
    update("hiddenFavorites", [...settings.hiddenFavorites, rel]);
  };

  /** Drop a single recent path. The Browser keeps adding paths to
   *  the head of `recentPaths` on every navigation; this lets the
   *  user prune entries one-off without nuking the whole list. */
  const removeRecent = (path: string) => {
    update(
      "recentPaths",
      settings.recentPaths.filter((p) => p !== path),
    );
  };

  /** Promote a recent / favorite path to a bookmark in one click.
   *  Skips when the path already lives in bookmarks. */
  const bookmarkPath = (path: string, label: string) => {
    if (settings.bookmarks.some((b) => b.path === path)) return;
    update("bookmarks", [
      ...settings.bookmarks,
      { id: crypto.randomUUID(), label, path },
    ]);
  };

  /** Closure over toggleSection + isCollapsed for the SectionHeader
   *  child component (defined outside this function so React doesn't
   *  recreate the type on every parent render — that was breaking
   *  the click handler in some renders). */
  const renderSectionHeader = (id: string, label: string) => (
    <SectionHeader
      id={id}
      label={label}
      collapsed={isCollapsed(id)}
      onToggle={(modifier) => toggleSection(id, modifier)}
      onHide={() => hideSection(id)}
    />
  );

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

  /** Mounted volumes for the Devices section. Refreshed on a 10s
   *  interval since plug-events aren't surfaced through Tauri yet —
   *  cheap query (sysinfo's `Disks::new_with_refreshed_list`). */
  const [mounts, setMounts] = useState<MountedVolume[] | null>(null);
  /** OS Trash / Recycle Bin path — populated by fs_trash_path on
   *  mount. `null` on Windows (Recycle Bin isn't a real fs path)
   *  and on platforms where the home dir can't be resolved; in
   *  both cases we hide the Trash favorite. */
  const [trashPath, setTrashPath] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fsTrashPath()
      .then((p) => !cancelled && setTrashPath(p))
      .catch(() => !cancelled && setTrashPath(null));
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      fsMounts()
        .then((m) => !cancelled && setMounts(m))
        .catch(() => !cancelled && setMounts([]));
    void refresh();
    const handle = window.setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  /** Active in-flight sync job ids — drives the badge over the
   *  Transfers nav link. We seed from `sync_list` then maintain
   *  incrementally via the Tauri progress / done / error events. */
  const [activeJobs, setActiveJobs] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    void syncList()
      .then((js) => {
        if (cancelled) return;
        const initial = new Set<string>(
          js
            .filter(
              (j) =>
                j.state === "planning" ||
                j.state === "running" ||
                j.state === "paused",
            )
            .map((j) => j.id),
        );
        setActiveJobs(initial);
      })
      .catch(() => {
        /* outside Tauri / no engine — leave the badge unset */
      });
    const unlisteners: Array<() => void> = [];
    void Promise.all([
      onProgress((p) => {
        setActiveJobs((prev) => {
          if (prev.has(p.jobId)) return prev;
          const next = new Set(prev);
          next.add(p.jobId);
          return next;
        });
      }),
      onDone((s) => {
        setActiveJobs((prev) => {
          if (!prev.has(s.jobId)) return prev;
          const next = new Set(prev);
          next.delete(s.jobId);
          return next;
        });
      }),
      onError((e) => {
        setActiveJobs((prev) => {
          if (!prev.has(e.jobId)) return prev;
          const next = new Set(prev);
          next.delete(e.jobId);
          return next;
        });
      }),
    ]).then((fns) => {
      if (cancelled) {
        for (const fn of fns) fn();
        return;
      }
      unlisteners.push(...fns);
    });
    return () => {
      cancelled = true;
      for (const fn of unlisteners) fn();
    };
  }, []);

  /** Drag-to-resize. The handle is a thin Box on the sidebar's right
   *  edge with cursor:col-resize. mouseDown captures the starting
   *  coordinates; mousemove updates the width; mouseup tears down
   *  the listeners. We use document-level mousemove rather than the
   *  handle's own so a fast drag past the edge doesn't drop the
   *  pointer outside our listener. */
  /** Live drag width. While the user is dragging the resize handle,
   *  width updates land here for the visual; the persisted setting
   *  only commits on mouseup. Decoupling the two keeps the persist
   *  effect (and the cross-window settings:changed broadcast) from
   *  firing 60 times a second during a drag — which used to race
   *  with the listener's reloadFromDisk and leave the sidebar
   *  "snapping back" after a resize. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const effectiveWidth = dragWidth ?? settings.sidebarWidth;
  /** Bookmark filter input — only shown when there are enough
   *  bookmarks that scrolling becomes painful (>= 10). Substring
   *  match against label, case-insensitive. Empty = show all. */
  const [bookmarkFilter, setBookmarkFilter] = useState("");

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = settings.sidebarWidth;
    let lastNext = startW;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      lastNext = Math.max(
        SIDEBAR_WIDTH_MIN,
        Math.min(SIDEBAR_WIDTH_MAX, startW + dx),
      );
      setDragWidth(lastNext);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      // Commit ONCE at the end of the drag — single persist tick,
      // single settings:changed emit, no race with the listener.
      update("sidebarWidth", lastNext);
      setDragWidth(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <Box
      component="nav"
      aria-label="Sidebar"
      sx={{
        width: effectiveWidth,
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
        {isVisible("favorites") && renderSectionHeader("favorites", "Favorites")}
        {isVisible("favorites") && !isCollapsed("favorites") && (
          <List dense disablePadding id="sidebar-section-favorites">
            {FAVORITES.filter(
              (f) => !settings.hiddenFavorites.includes(f.rel),
            ).map((f) => (
              <ListItem key={f.label} disablePadding>
                <ListItemButton
                  disabled={!home}
                  onClick={() => onNavigate(join(f.rel))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      section: "favorites",
                      itemId: f.rel,
                      actions: [
                        {
                          key: "bookmark",
                          icon: <BookmarkIcon fontSize="small" />,
                          label: "Add to bookmarks",
                          onClick: () =>
                            bookmarkPath(join(f.rel), f.label),
                        },
                        {
                          key: "hide",
                          icon: <VisibilityOffIcon fontSize="small" />,
                          label: `Hide "${f.label}"`,
                          onClick: () => hideFavorite(f.rel),
                        },
                      ],
                    });
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>{f.icon}</ListItemIcon>
                  <ListItemText primary={f.label} />
                </ListItemButton>
              </ListItem>
            ))}
            {trashPath && !settings.hiddenFavorites.includes("trash") && (
              <ListItem disablePadding>
                {/* macOS sandboxes ~/.Trash via TCC — read_dir errors with
                 *  "Operation not permitted" without Full Disk Access. Reveal
                 *  it in Finder instead, which has the entitlement and a
                 *  better Trash UI (Empty Trash / Put Back) anyway. */}
                <ListItemButton
                  onClick={() => {
                    void fsOpenWithDefault(trashPath).catch(() => {});
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      section: "favorites",
                      itemId: "trash",
                      actions: [
                        {
                          key: "hide",
                          icon: <VisibilityOffIcon fontSize="small" />,
                          label: 'Hide "Trash"',
                          onClick: () => hideFavorite("trash"),
                        },
                      ],
                    });
                  }}
                  // Drop target for "drag rows here to delete" — Finder
                  // muscle memory. Accepts the path-drag MIME the
                  // FileList rows emit. Local paths only; sftp:// is
                  // skipped silently (those go through right-click
                  // "Move to Trash" which uses conn_remove instead).
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
                    const paths = raw
                      .split("\n")
                      .filter((p) => p && !p.startsWith("sftp://"));
                    if (paths.length === 0) return;
                    if (
                      !window.confirm(
                        `Move ${paths.length} item${paths.length === 1 ? "" : "s"} to Trash?`,
                      )
                    ) {
                      return;
                    }
                    pushTrashBatch(paths);
                    void fsTrashMany(paths).catch(() => {
                      /* failure surfaces via the next list_dir refresh */
                    });
                    // Nudge any open Browser to refresh — not strictly
                    // necessary (the watcher will catch it within
                    // ~150ms) but feels snappier.
                    window.dispatchEvent(
                      new CustomEvent("skiff:trash-completed"),
                    );
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <DeleteIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Trash" />
                </ListItemButton>
              </ListItem>
            )}
          </List>
        )}

        {isVisible("bookmarks") && settings.bookmarks.length > 0 && (
          <Box
            // Drop target for "drag folder into Bookmarks → add new
            // bookmark". Bubbles up from below: a drop on a bookmark
            // row preventDefaults via its own handler (existing
            // sync-into-bookmark flow), so this fires only when the
            // drop landed on the section header / list whitespace.
            // Falls through to the inner row handlers when those
            // accept the drop first.
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
              // Each path becomes a new bookmark, deduped by path.
              const incoming = raw
                .split("\n")
                .filter(Boolean)
                .filter(
                  (p) =>
                    !settings.bookmarks.some((b) => b.path === p),
                )
                .map((p) => {
                  const segs = p.split(/[\\/]/).filter(Boolean);
                  return {
                    id: crypto.randomUUID(),
                    label: segs.at(-1) ?? p,
                    path: p,
                  };
                });
              if (incoming.length === 0) return;
              update("bookmarks", [...settings.bookmarks, ...incoming]);
            }}
          >
            {renderSectionHeader("bookmarks", "Bookmarks")}
            {!isCollapsed("bookmarks") && settings.bookmarks.length >= 5 && (
              <Box sx={{ px: 2, py: 0.5, display: "flex", gap: 0.5, alignItems: "center" }}>
                {settings.bookmarks.length >= 10 && (
                  <input
                    type="text"
                    placeholder="Filter bookmarks…"
                    value={bookmarkFilter}
                    onChange={(e) => setBookmarkFilter(e.target.value)}
                    style={{
                      flex: 1,
                      padding: "4px 6px",
                      fontSize: "0.75rem",
                      background: "transparent",
                      border: "1px solid",
                      borderColor: "rgba(127,127,127,0.3)",
                      borderRadius: 4,
                      color: "inherit",
                    }}
                  />
                )}
                <Tooltip title="Sort A→Z">
                  <IconButton
                    size="small"
                    onClick={() => {
                      const sorted = [...settings.bookmarks].sort((a, b) =>
                        a.label.localeCompare(b.label, undefined, {
                          sensitivity: "base",
                          numeric: true,
                        }),
                      );
                      update("bookmarks", sorted);
                    }}
                    aria-label="Sort bookmarks A to Z"
                  >
                    <SortByAlphaIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            )}
            {!isCollapsed("bookmarks") && (
            <List dense disablePadding id="sidebar-section-bookmarks">
              {settings.bookmarks
                .filter((b) =>
                  bookmarkFilter
                    ? b.label
                        .toLowerCase()
                        .includes(bookmarkFilter.toLowerCase())
                    : true,
                )
                .map((b, i) => (
                <ListItem
                  key={b.id}
                  disablePadding
                  // Mouse drag-reorder. Uses a separate MIME from the
                  // path-drop flow on bookmark rows so the two
                  // gestures don't collide. Reading the source id
                  // from dataTransfer in onDrop tells us which row to
                  // splice + where.
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      "application/x-skiff-bookmark",
                      b.id,
                    );
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    if (
                      e.dataTransfer.types.includes(
                        "application/x-skiff-bookmark",
                      )
                    ) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }
                  }}
                  onDrop={(e) => {
                    const sourceId = e.dataTransfer.getData(
                      "application/x-skiff-bookmark",
                    );
                    if (!sourceId || sourceId === b.id) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const list = settings.bookmarks;
                    const sIdx = list.findIndex((x) => x.id === sourceId);
                    const tIdx = list.findIndex((x) => x.id === b.id);
                    if (sIdx < 0 || tIdx < 0) return;
                    const next = [...list];
                    const [moved] = next.splice(sIdx, 1);
                    next.splice(tIdx, 0, moved);
                    update("bookmarks", next);
                  }}
                  secondaryAction={
                    <Box sx={{ display: "flex", gap: 0.25 }}>
                      <IconButton
                        size="small"
                        edge="end"
                        disabled={i === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveBookmark(b.id, "up");
                        }}
                        aria-label={`Move ${b.label} up`}
                        sx={{ p: 0.25 }}
                      >
                        <KeyboardArrowUpIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                      <IconButton
                        size="small"
                        edge="end"
                        disabled={i === settings.bookmarks.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveBookmark(b.id, "down");
                        }}
                        aria-label={`Move ${b.label} down`}
                        sx={{ p: 0.25 }}
                      >
                        <KeyboardArrowDownIcon sx={{ fontSize: 14 }} />
                      </IconButton>
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
                    </Box>
                  }
                >
                  <ListItemButton
                    onClick={() => onNavigate(b.path)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      // Use the full-list index so Move up/down stay
                      // consistent regardless of an active bookmark
                      // filter — moving a row up should swap with its
                      // original neighbor, not with whatever rendered
                      // right above it post-filter.
                      const realIdx = settings.bookmarks.findIndex(
                        (x) => x.id === b.id,
                      );
                      const isFirst = realIdx === 0;
                      const isLast = realIdx === settings.bookmarks.length - 1;
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        section: "bookmarks",
                        itemId: b.id,
                        actions: [
                          ...(b.path.startsWith("sftp://")
                            ? []
                            : [
                                {
                                  key: "reveal",
                                  icon: <LaunchIcon fontSize="small" />,
                                  label: "Show in Finder/Explorer",
                                  dividerAfter: true,
                                  onClick: () => {
                                    void fsRevealInOs(b.path).catch(() => {});
                                  },
                                },
                              ]),
                          {
                            key: "rename",
                            icon: <EditIcon fontSize="small" />,
                            label: "Rename…",
                            onClick: () => renameBookmark(b.id),
                          },
                          {
                            key: "up",
                            icon: <KeyboardArrowUpIcon fontSize="small" />,
                            label: "Move up",
                            disabled: isFirst,
                            onClick: () => moveBookmark(b.id, "up"),
                          },
                          {
                            key: "down",
                            icon: <KeyboardArrowDownIcon fontSize="small" />,
                            label: "Move down",
                            disabled: isLast,
                            dividerAfter: true,
                            onClick: () => moveBookmark(b.id, "down"),
                          },
                          {
                            key: "remove",
                            icon: <CloseIcon fontSize="small" />,
                            label: "Remove",
                            onClick: () => removeBookmark(b.id),
                          },
                        ],
                      });
                    }}
                    // Drop a Skiff selection here to sync into the
                    // bookmark's path. Mirrors the host-drop flow but
                    // skips the destination prompt since the bookmark
                    // already names a path.
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
                      if (
                        !window.confirm(
                          `Sync ${paths.length} item${paths.length === 1 ? "" : "s"} into ${b.label}?`,
                        )
                      ) {
                        return;
                      }
                      for (const p of paths) {
                        const segs = p.split(/[\\/]/).filter(Boolean);
                        const base = segs.at(-1) ?? p;
                        const dest = b.path.endsWith("/")
                          ? `${b.path}${base}`
                          : `${b.path}/${base}`;
                        void startSync(p, dest, {
                          maxSizeGb: 100,
                          conflictPolicy: "skip",
                        }).catch(() => {
                          /* errors surface in TransfersPage */
                        });
                      }
                    }}
                    title="Right-click to rename · drop here to sync"
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
          </Box>
        )}

        {isVisible("workspaces") && settings.tabWorkspaces.length > 0 && (
          <>
            {renderSectionHeader("workspaces", "Workspaces")}
            {!isCollapsed("workspaces") &&
              settings.tabWorkspaces.length >= 5 && (
                <Box sx={{ px: 2, py: 0.5, display: "flex", justifyContent: "flex-end" }}>
                  <Tooltip title="Sort A→Z">
                    <IconButton
                      size="small"
                      onClick={() => {
                        const sorted = [...settings.tabWorkspaces].sort(
                          (a, b) =>
                            a.label.localeCompare(b.label, undefined, {
                              sensitivity: "base",
                              numeric: true,
                            }),
                        );
                        update("tabWorkspaces", sorted);
                      }}
                      aria-label="Sort workspaces A to Z"
                    >
                      <SortByAlphaIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
            {!isCollapsed("workspaces") && (
              <List dense disablePadding id="sidebar-section-workspaces">
                {settings.tabWorkspaces.map((ws) => (
                  <ListItem
                    key={ws.id}
                    disablePadding
                    // Drag-reorder: same shape as the bookmarks
                    // section. Custom MIME so it doesn't collide
                    // with file-row drags or bookmark drags.
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        "application/x-skiff-workspace",
                        ws.id,
                      );
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      if (
                        e.dataTransfer.types.includes(
                          "application/x-skiff-workspace",
                        )
                      ) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(e) => {
                      const sourceId = e.dataTransfer.getData(
                        "application/x-skiff-workspace",
                      );
                      if (!sourceId || sourceId === ws.id) return;
                      e.preventDefault();
                      const list = settings.tabWorkspaces;
                      const fromIdx = list.findIndex((x) => x.id === sourceId);
                      const toIdx = list.findIndex((x) => x.id === ws.id);
                      if (fromIdx < 0 || toIdx < 0) return;
                      const next = [...list];
                      const [moved] = next.splice(fromIdx, 1);
                      next.splice(toIdx, 0, moved);
                      update("tabWorkspaces", next);
                    }}
                  >
                    <ListItemButton
                      onClick={() => {
                        const ok = window.confirm(
                          `Replace your current tabs with "${ws.label}" (${ws.tabs.length} tab${ws.tabs.length === 1 ? "" : "s"})?`,
                        );
                        if (!ok) return;
                        // Same event the command palette uses;
                        // BrowserTabs listens.
                        window.dispatchEvent(
                          new CustomEvent("skiff:restore-workspace", {
                            detail: ws,
                          }),
                        );
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          section: "workspaces",
                          itemId: ws.id,
                          actions: [
                            {
                              key: "append",
                              label: "Append (add to current tabs)",
                              onClick: () =>
                                window.dispatchEvent(
                                  new CustomEvent("skiff:append-workspace", {
                                    detail: ws,
                                  }),
                                ),
                            },
                            {
                              key: "rename",
                              icon: <EditIcon fontSize="small" />,
                              label: "Rename…",
                              onClick: () => {
                                const next = window.prompt(
                                  "Rename workspace:",
                                  ws.label,
                                );
                                if (next === null) return;
                                const trimmed = next.trim();
                                if (!trimmed) return;
                                update(
                                  "tabWorkspaces",
                                  settings.tabWorkspaces.map((x) =>
                                    x.id === ws.id
                                      ? { ...x, label: trimmed }
                                      : x,
                                  ),
                                );
                              },
                            },
                            {
                              key: "delete",
                              icon: <CloseIcon fontSize="small" />,
                              label: "Delete",
                              onClick: () =>
                                update(
                                  "tabWorkspaces",
                                  settings.tabWorkspaces.filter(
                                    (x) => x.id !== ws.id,
                                  ),
                                ),
                            },
                          ],
                        });
                      }}
                      title={`Restore "${ws.label}" — ${ws.tabs.length} tab${ws.tabs.length === 1 ? "" : "s"} · right-click to rename / delete`}
                    >
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <ViewWeekIcon
                          fontSize="small"
                          sx={{ color: "text.secondary" }}
                        />
                      </ListItemIcon>
                      <ListItemText
                        primary={ws.label}
                        secondary={`${ws.tabs.length} tab${ws.tabs.length === 1 ? "" : "s"}`}
                        slotProps={{
                          primary: { variant: "body2", noWrap: true },
                          secondary: { variant: "caption" },
                        }}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </>
        )}

        {isVisible("searches") && settings.savedSearches.length > 0 && (
          <>
            {renderSectionHeader("searches", "Searches")}
            {!isCollapsed("searches") &&
              settings.savedSearches.length >= 5 && (
                <Box sx={{ px: 2, py: 0.5, display: "flex", justifyContent: "flex-end" }}>
                  <Tooltip title="Sort A→Z">
                    <IconButton
                      size="small"
                      onClick={() => {
                        const sorted = [...settings.savedSearches].sort(
                          (a, b) =>
                            a.label.localeCompare(b.label, undefined, {
                              sensitivity: "base",
                              numeric: true,
                            }),
                        );
                        update("savedSearches", sorted);
                      }}
                      aria-label="Sort searches A to Z"
                    >
                      <SortByAlphaIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
            {!isCollapsed("searches") && (
              <List dense disablePadding id="sidebar-section-searches">
                {settings.savedSearches.map((s) => (
                  <ListItem
                    key={s.id}
                    disablePadding
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        "application/x-skiff-search",
                        s.id,
                      );
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      if (
                        e.dataTransfer.types.includes(
                          "application/x-skiff-search",
                        )
                      ) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(e) => {
                      const sourceId = e.dataTransfer.getData(
                        "application/x-skiff-search",
                      );
                      if (!sourceId || sourceId === s.id) return;
                      e.preventDefault();
                      const list = settings.savedSearches;
                      const fromIdx = list.findIndex((x) => x.id === sourceId);
                      const toIdx = list.findIndex((x) => x.id === s.id);
                      if (fromIdx < 0 || toIdx < 0) return;
                      const next = [...list];
                      const [moved] = next.splice(fromIdx, 1);
                      next.splice(toIdx, 0, moved);
                      update("savedSearches", next);
                    }}
                  >
                    <ListItemButton
                      onClick={() => {
                        // Browser listens; switching to the Browser
                        // page first ensures the search applies to a
                        // visible Browser instance.
                        onSwitchPage("browser");
                        queueMicrotask(() =>
                          window.dispatchEvent(
                            new CustomEvent("skiff:run-saved-search", {
                              detail: s,
                            }),
                          ),
                        );
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          section: "bookmarks",
                          itemId: s.id,
                          actions: [
                            {
                              key: "rename",
                              icon: <EditIcon fontSize="small" />,
                              label: "Rename…",
                              onClick: () => {
                                const next = window.prompt(
                                  "Rename saved search:",
                                  s.label,
                                );
                                if (next === null) return;
                                const trimmed = next.trim();
                                if (!trimmed) return;
                                update(
                                  "savedSearches",
                                  settings.savedSearches.map((x) =>
                                    x.id === s.id
                                      ? { ...x, label: trimmed }
                                      : x,
                                  ),
                                );
                              },
                            },
                            {
                              key: "delete",
                              icon: <CloseIcon fontSize="small" />,
                              label: "Delete",
                              onClick: () =>
                                update(
                                  "savedSearches",
                                  settings.savedSearches.filter(
                                    (x) => x.id !== s.id,
                                  ),
                                ),
                            },
                          ],
                        });
                      }}
                      title={`Run "${s.label}" — ${s.query}${s.regex ? " (regex)" : ""}${s.caseSensitive ? " (case)" : ""}${s.recursive ? " (recursive)" : ""}`}
                    >
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <SearchIcon
                          fontSize="small"
                          sx={{ color: "text.secondary" }}
                        />
                      </ListItemIcon>
                      <ListItemText
                        primary={s.label}
                        secondary={s.query}
                        slotProps={{
                          primary: { variant: "body2", noWrap: true },
                          secondary: {
                            variant: "caption",
                            sx: { fontFamily: "monospace" },
                          },
                        }}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </>
        )}

        {isVisible("syncjobs") && settings.savedSyncJobs.length > 0 && (
          <>
            {renderSectionHeader("syncjobs", "Sync jobs")}
            {!isCollapsed("syncjobs") &&
              settings.savedSyncJobs.length >= 5 && (
                <Box sx={{ px: 2, py: 0.5, display: "flex", justifyContent: "flex-end" }}>
                  <Tooltip title="Sort A→Z">
                    <IconButton
                      size="small"
                      onClick={() => {
                        const sorted = [...settings.savedSyncJobs].sort(
                          (a, b) =>
                            a.label.localeCompare(b.label, undefined, {
                              sensitivity: "base",
                              numeric: true,
                            }),
                        );
                        update("savedSyncJobs", sorted);
                      }}
                      aria-label="Sort sync jobs A to Z"
                    >
                      <SortByAlphaIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
            {!isCollapsed("syncjobs") && (
              <List dense disablePadding id="sidebar-section-syncjobs">
                {settings.savedSyncJobs.map((j) => (
                  <ListItem
                    key={j.id}
                    disablePadding
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        "application/x-skiff-syncjob",
                        j.id,
                      );
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      if (
                        e.dataTransfer.types.includes(
                          "application/x-skiff-syncjob",
                        )
                      ) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(e) => {
                      const sourceId = e.dataTransfer.getData(
                        "application/x-skiff-syncjob",
                      );
                      if (!sourceId || sourceId === j.id) return;
                      e.preventDefault();
                      const list = settings.savedSyncJobs;
                      const fromIdx = list.findIndex((x) => x.id === sourceId);
                      const toIdx = list.findIndex((x) => x.id === j.id);
                      if (fromIdx < 0 || toIdx < 0) return;
                      const next = [...list];
                      const [moved] = next.splice(fromIdx, 1);
                      next.splice(toIdx, 0, moved);
                      update("savedSyncJobs", next);
                    }}
                  >
                    <ListItemButton
                      onClick={() => {
                        // Mirrors the palette flow: confirm before
                        // running a real transfer.
                        const ok = window.confirm(
                          `Run sync job "${j.label}"?\n\n${j.src} → ${j.dest}`,
                        );
                        if (!ok) return;
                        onSwitchPage("transfers");
                        queueMicrotask(() =>
                          window.dispatchEvent(
                            new CustomEvent("skiff:run-sync-job", {
                              detail: j.id,
                            }),
                          ),
                        );
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          section: "bookmarks",
                          itemId: j.id,
                          actions: [
                            {
                              key: "dryrun",
                              label: "Run as dry-run",
                              onClick: () => {
                                onSwitchPage("transfers");
                                window.dispatchEvent(
                                  new CustomEvent("skiff:run-sync-job", {
                                    detail: { id: j.id, dryRun: true },
                                  }),
                                );
                              },
                            },
                            {
                              key: "rename",
                              icon: <EditIcon fontSize="small" />,
                              label: "Rename…",
                              onClick: () => {
                                const next = window.prompt(
                                  "Rename sync job:",
                                  j.label,
                                );
                                if (next === null) return;
                                const trimmed = next.trim();
                                if (!trimmed) return;
                                update(
                                  "savedSyncJobs",
                                  settings.savedSyncJobs.map((x) =>
                                    x.id === j.id
                                      ? { ...x, label: trimmed }
                                      : x,
                                  ),
                                );
                              },
                            },
                            {
                              key: "delete",
                              icon: <CloseIcon fontSize="small" />,
                              label: "Delete",
                              onClick: () =>
                                update(
                                  "savedSyncJobs",
                                  settings.savedSyncJobs.filter(
                                    (x) => x.id !== j.id,
                                  ),
                                ),
                            },
                          ],
                        });
                      }}
                      title={`Run "${j.label}" — ${j.src} → ${j.dest}`}
                    >
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <SwapHorizIcon
                          fontSize="small"
                          sx={{ color: "text.secondary" }}
                        />
                      </ListItemIcon>
                      <ListItemText
                        primary={j.label}
                        secondary={j.conflictPolicy}
                        slotProps={{
                          primary: { variant: "body2", noWrap: true },
                          secondary: { variant: "caption" },
                        }}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </>
        )}

        {isVisible("selections") && settings.savedSelections.length > 0 && (
          <>
            {renderSectionHeader("selections", "Selections")}
            {!isCollapsed("selections") &&
              settings.savedSelections.length >= 5 && (
                <Box sx={{ px: 2, py: 0.5, display: "flex", justifyContent: "flex-end" }}>
                  <Tooltip title="Sort A→Z">
                    <IconButton
                      size="small"
                      onClick={() => {
                        const sorted = [...settings.savedSelections].sort(
                          (a, b) =>
                            a.label.localeCompare(b.label, undefined, {
                              sensitivity: "base",
                              numeric: true,
                            }),
                        );
                        update("savedSelections", sorted);
                      }}
                      aria-label="Sort selections A to Z"
                    >
                      <SortByAlphaIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
            {!isCollapsed("selections") && (
              <List dense disablePadding id="sidebar-section-selections">
                {settings.savedSelections.map((s) => (
                  <ListItem
                    key={s.id}
                    disablePadding
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        "application/x-skiff-selection",
                        s.id,
                      );
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      if (
                        e.dataTransfer.types.includes(
                          "application/x-skiff-selection",
                        )
                      ) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(e) => {
                      const sourceId = e.dataTransfer.getData(
                        "application/x-skiff-selection",
                      );
                      if (!sourceId || sourceId === s.id) return;
                      e.preventDefault();
                      const list = settings.savedSelections;
                      const fromIdx = list.findIndex((x) => x.id === sourceId);
                      const toIdx = list.findIndex((x) => x.id === s.id);
                      if (fromIdx < 0 || toIdx < 0) return;
                      const next = [...list];
                      const [moved] = next.splice(fromIdx, 1);
                      next.splice(toIdx, 0, moved);
                      update("savedSelections", next);
                    }}
                  >
                    <ListItemButton
                      onClick={() => {
                        // Switch to Browser then dispatch — same
                        // pattern as workspaces / searches.
                        onSwitchPage("browser");
                        queueMicrotask(() =>
                          window.dispatchEvent(
                            new CustomEvent("skiff:restore-selection", {
                              detail: s.paths,
                            }),
                          ),
                        );
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          section: "bookmarks",
                          itemId: s.id,
                          actions: [
                            {
                              key: "open-as-tabs",
                              label: "Open paths as tabs",
                              onClick: () => {
                                // Each path becomes a new tab. Skip
                                // sftp:// paths that aren't real
                                // browseable folders without an
                                // active connection. We treat
                                // PARENT folders for files (so the
                                // user lands at the file's parent
                                // and can see context).
                                for (const p of s.paths) {
                                  // OPEN_IN_TAB_EVENT seeds a new
                                  // tab at the dispatched path.
                                  // BrowserTabs listens.
                                  window.dispatchEvent(
                                    new CustomEvent(OPEN_IN_TAB_EVENT, {
                                      detail: p,
                                    }),
                                  );
                                }
                              },
                            },
                            {
                              key: "rename",
                              icon: <EditIcon fontSize="small" />,
                              label: "Rename…",
                              onClick: () => {
                                const next = window.prompt(
                                  "Rename selection group:",
                                  s.label,
                                );
                                if (next === null) return;
                                const trimmed = next.trim();
                                if (!trimmed) return;
                                update(
                                  "savedSelections",
                                  settings.savedSelections.map((x) =>
                                    x.id === s.id
                                      ? { ...x, label: trimmed }
                                      : x,
                                  ),
                                );
                              },
                            },
                            {
                              key: "delete",
                              icon: <CloseIcon fontSize="small" />,
                              label: "Delete",
                              onClick: () =>
                                update(
                                  "savedSelections",
                                  settings.savedSelections.filter(
                                    (x) => x.id !== s.id,
                                  ),
                                ),
                            },
                          ],
                        });
                      }}
                      title={`Restore "${s.label}" — ${s.paths.length} path${s.paths.length === 1 ? "" : "s"}`}
                    >
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <CheckBoxOutlineBlankIcon
                          fontSize="small"
                          sx={{ color: "text.secondary" }}
                        />
                      </ListItemIcon>
                      <ListItemText
                        primary={s.label}
                        secondary={`${s.paths.length} path${s.paths.length === 1 ? "" : "s"}`}
                        slotProps={{
                          primary: { variant: "body2", noWrap: true },
                          secondary: { variant: "caption" },
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
            {renderSectionHeader("recent", "Recent")}
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
                    <ListItemButton
                      onClick={() => onNavigate(p)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        const alreadyBookmarked = settings.bookmarks.some(
                          (bk) => bk.path === p,
                        );
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          section: "recent",
                          itemId: p,
                          actions: [
                            ...(p.startsWith("sftp://")
                              ? []
                              : [
                                  {
                                    key: "reveal",
                                    icon: <LaunchIcon fontSize="small" />,
                                    label: "Show in Finder/Explorer",
                                    dividerAfter: true,
                                    onClick: () => {
                                      void fsRevealInOs(p).catch(() => {});
                                    },
                                  },
                                ]),
                            {
                              key: "bookmark",
                              icon: <BookmarkIcon fontSize="small" />,
                              label: "Add to bookmarks",
                              disabled: alreadyBookmarked,
                              dividerAfter: true,
                              onClick: () => bookmarkPath(p, label),
                            },
                            {
                              key: "remove",
                              icon: <CloseIcon fontSize="small" />,
                              label: "Remove from recent",
                              onClick: () => removeRecent(p),
                            },
                          ],
                        });
                      }}
                    >
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

        {isVisible("hosts") && renderSectionHeader("hosts", "Hosts")}
        {isVisible("hosts") && !isCollapsed("hosts") && (
        <Box id="sidebar-section-hosts">
        {connections == null ? (
          <Box sx={{ px: 2, py: 0.5 }}>
            <CircularProgress size={14} />
          </Box>
        ) : connections.length === 0 ? (
          <List dense disablePadding>
            <ListItem disablePadding>
              <ListItemButton onClick={() => onSwitchPage("connections")}>
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
              <ListItemButton onClick={() => onSwitchPage("connections")}>
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

        {isVisible("devices") && renderSectionHeader("devices", "Devices")}
        {isVisible("devices") && !isCollapsed("devices") && (
          mounts == null ? (
            <Box sx={{ px: 2, py: 0.5 }} id="sidebar-section-devices">
              <CircularProgress size={14} />
            </Box>
          ) : mounts.length === 0 ? (
            <Typography
              variant="caption"
              sx={{ px: 2, color: "text.disabled", display: "block" }}
              id="sidebar-section-devices"
            >
              No mounted volumes
            </Typography>
          ) : (
            <List dense disablePadding id="sidebar-section-devices">
              {mounts.map((m) => (
                <ListItem key={m.mountPoint} disablePadding>
                  <ListItemButton
                    onClick={() => onNavigate(m.mountPoint)}
                    title={`${m.mountPoint}${m.total > 0 ? ` · ${formatBytes(m.free)} free of ${formatBytes(m.total)}` : ""}`}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      {m.removable ? (
                        <UsbIcon fontSize="small" />
                      ) : (
                        <StorageIcon fontSize="small" />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={m.name}
                      secondary={
                        m.total > 0
                          ? `${formatBytes(m.free)} free`
                          : undefined
                      }
                      slotProps={{
                        primary: { variant: "body2", noWrap: true },
                        secondary: { variant: "caption" },
                      }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )
        )}
      </Box>

      <List dense disablePadding sx={{ borderTop: 1, borderColor: "divider" }}>
        <ListItem disablePadding>
          <ListItemButton onClick={() => onSwitchPage("transfers")} selected={page === "transfers"}>
            <ListItemIcon sx={{ minWidth: 32 }}>
              <Badge
                badgeContent={activeJobs.size}
                color="primary"
                invisible={activeJobs.size === 0}
                overlap="circular"
              >
                <SwapHorizIcon fontSize="small" />
              </Badge>
            </ListItemIcon>
            <ListItemText primary="Transfers" />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton
            selected={page === "settings"}
            onClick={() => onSwitchPage("settings")}
          >
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
      {/* Per-section context menu. Sidebar rows set up their own
          actions; this just renders whatever's in `contextMenu`. */}
      <SidebarContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(null)}
      />
    </Box>
  );
}
