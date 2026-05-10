// Virtualized file list. Renders only the visible rows via @tanstack/react-virtual,
// which keeps the DOM small (and scrolling smooth) at 100k entries — see the
// speed targets in TODO.md.
//
// Sort and selection are owned here because they're list-local concerns; the
// parent Browser owns navigation, refresh, and the underlying entries array.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Box, Typography, Checkbox } from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Entry } from "../api/fs";
import IconForKind from "./IconForKind";
import GalleryThumb from "./GalleryThumb";
import {
  formatBytes,
  formatMtimeAs,
  formatMtimeRelative,
} from "../util/format";
import { setFileClipboard } from "../util/fileClipboard";
import {
  fetchFolderSize,
  getCachedFolderSize,
} from "../util/folderSizeCache";
import { startNativeDrag } from "../api/drag";
import { TAG_COLORS, tagColorHex } from "../util/tagColors";
import type { TagColor } from "../state/settings";
import type { Density, ShowExtensions, ViewMode } from "../state/settings";

export type SortKey = "name" | "size" | "mtime" | "ctime" | "kind" | "tag";
export type SortDir = "asc" | "desc";

interface Props {
  entries: Entry[];
  /** Folders always sort first within a group, regardless of `sortKey`. */
  sortKey: SortKey;
  sortDir: SortDir;
  onSortChange: (key: SortKey) => void;
  /** Called when a folder is double-clicked or Enter pressed on it. */
  onOpenDir: (entry: Entry) => void;
  /** Called when a file is double-clicked. The Browser routes this
   *  to `fs_open_with_default` so the OS picks the app. Optional —
   *  when omitted, file double-click is a no-op (current behavior). */
  onOpenFile?: (entry: Entry) => void;
  /** Called when a folder is middle-clicked (mouse button 1). The
   *  Browser routes this through a window event so BrowserTabs can
   *  spawn a new tab. Matches browser muscle memory: middle-click =
   *  open in new tab. Cmd/Ctrl+click stays reserved for additive
   *  multi-select to match Finder / Explorer conventions. */
  onOpenDirInNewTab?: (entry: Entry) => void;
  /** When false, keyboard nav handlers are disabled — for tabs that
   *  aren't in the foreground. */
  isActive?: boolean;
  /** Fires whenever a row is clicked. The "primary" selection drives the
   *  preview pane; multi-select is tracked here and reported via
   *  `onSelectionChange`. */
  onPrimarySelect?: (entry: Entry | null) => void;
  /** Fires whenever the multi-selection set changes. The parent uses
   *  this to drive the StatusBar count + total-size display. */
  onSelectionChange?: (selectedPaths: string[]) => void;
  /** Right-click handler — Browser wraps this in the actual context
   *  menu so the FileList stays focused on rendering. We forward both
   *  the entry and the click coords so the menu can anchor near the
   *  cursor. */
  onContext?: (entry: Entry, x: number, y: number) => void;
  density: Density;
  showExtensions: ShowExtensions;
  /** When true (default), folders sort above files regardless of the
   *  active sort key. When false, folders and files intermix purely
   *  by the chosen sort. Settings → Default View → "Group folders
   *  before files" controls this. */
  groupFoldersFirst?: boolean;
  /** Optional substring to highlight inside each row's name. Drives
   *  the bold-highlight visual when the user is filtering or
   *  recursive-finding. Empty / undefined disables highlighting. */
  highlightQuery?: string;
  /** Called when one or more entries are dropped onto a FOLDER row
   *  in this FileList. The Browser routes the dropped paths into a
   *  Skiffsync targeting `targetFolder`. Without this prop, folder
   *  rows aren't drop targets. */
  onDropOntoFolder?: (paths: string[], targetFolder: Entry) => void;
  /** Right-click on empty whitespace in the list (not on a row).
   *  Browser uses this to show "New folder / New file / Paste" at
   *  the cursor coordinates. */
  onContextEmpty?: (x: number, y: number) => void;
  /** Path of the row whose right-click context menu is currently
   *  open. Drives a non-state cosmetic outline so the user can see
   *  which row the menu is operating on (separate from selection /
   *  focus). When `null` no row is highlighted. */
  contextMenuPath?: string | null;
  /** Per-path color tags (Finder-style). Keys are full paths;
   *  values are TagColor enum strings. Optional — when omitted no
   *  tag dots render. */
  fileTags?: Record<string, string>;
  /** Per-extension icon-kind override. Lowercase ext (no dot) →
   *  FileKind. Empty / missing keys fall through to the entry's
   *  underlying kind. */
  customFileKinds?: Record<string, string>;
  /** Date format for the Modified column. Defaults to "locale".
   *  Optional so existing callers / tests continue to work without
   *  touching the prop. */
  dateFormat?: "locale" | "iso" | "short" | "relative";
  /** Per-column visibility for list view. Name is always shown;
   *  the other three are individually hideable. */
  hideColumns?: { size?: boolean; modified?: boolean; kind?: boolean };
  /** Visual layout. `list` is the virtualized list (default); other
   *  modes render a non-virtualized grid of cards (tile = small
   *  icons, gallery = larger icons / thumbs, column = wide rows).
   *  Performance budget for non-list views: ~5k entries before
   *  scroll feel degrades — large folders should stay on list. */
  view?: ViewMode;
  /** Path of the folder these entries represent. Drives per-folder
   *  scroll-position memory: when the user navigates away and back,
   *  FileList restores the previous scrollTop. Optional — when
   *  omitted, scroll memory is disabled. */
  path?: string;
  /** Inline rename callback. Called with the entry being renamed
   *  and the new name (basename only — the parent dir is unchanged).
   *  Resolves on success / rejects on failure (collision, permission,
   *  cross-FS, etc.). When omitted, F2 falls through to whatever the
   *  parent's keyboard handler does. */
  onRename?: (entry: Entry, newName: string) => Promise<void>;
}

/** Resolve the icon-display kind for an entry: user override on the
 *  extension wins over the underlying Entry.kind. Folders + symlinks
 *  bypass the override since their kind isn't tied to an extension. */
function resolveDisplayKind(
  entry: Entry,
  custom: Record<string, string>,
): string {
  if (entry.isDir || entry.isSymlink) return entry.kind;
  const dot = entry.name.lastIndexOf(".");
  if (dot < 1 || dot === entry.name.length - 1) return entry.kind;
  const ext = entry.name.slice(dot + 1).toLowerCase();
  return custom[ext] || entry.kind;
}

/** Sort entries either with folders-first (Finder default) or fully
 *  intermixed depending on `groupFoldersFirst`. */
function sortEntries(
  entries: Entry[],
  key: SortKey,
  dir: SortDir,
  groupFoldersFirst: boolean,
  fileTags: Record<string, string> = {},
): Entry[] {
  const mul = dir === "asc" ? 1 : -1;
  // Tag-sort uses the canonical TAG_COLORS order so reds cluster
  // before oranges before yellows etc. — same order the chip strip
  // renders. Untagged rows go to the end regardless of direction;
  // the user wants tagged things grouped together.
  const tagRank = (path: string): number => {
    const t = fileTags[path];
    if (!t) return Number.MAX_SAFE_INTEGER;
    const idx = TAG_COLORS.indexOf(t as TagColor);
    return idx < 0 ? Number.MAX_SAFE_INTEGER : idx;
  };
  const cmp = (a: Entry, b: Entry): number => {
    switch (key) {
      case "size":
        return (a.size - b.size) * mul;
      case "mtime":
        return ((a.mtime ?? 0) - (b.mtime ?? 0)) * mul;
      case "ctime":
        return ((a.ctime ?? 0) - (b.ctime ?? 0)) * mul;
      case "kind":
        return a.kind.localeCompare(b.kind) * mul || a.name.localeCompare(b.name);
      case "tag": {
        const ra = tagRank(a.path);
        const rb = tagRank(b.path);
        if (ra !== rb) return (ra - rb) * mul;
        return a.name.localeCompare(b.name);
      }
      case "name":
      default:
        return a.name.localeCompare(b.name, undefined, { numeric: true }) * mul;
    }
  };
  if (!groupFoldersFirst) {
    return [...entries].sort(cmp);
  }
  const groups = { dirs: [] as Entry[], files: [] as Entry[] };
  for (const e of entries) {
    (e.isDir ? groups.dirs : groups.files).push(e);
  }
  groups.dirs.sort(cmp);
  groups.files.sort(cmp);
  return [...groups.dirs, ...groups.files];
}

/** Module-level cache of scroll positions per folder path. Keeps
 *  navigation feel like a real file manager — leave a folder mid-
 *  scroll, come back, the scroll is where you left it. Cleared
 *  implicitly on app reload (intentional: avoids stale offsets
 *  bound to removed folders). Bounded loosely; entries naturally
 *  fall out of working memory as the user navigates. */
const scrollMemory = new Map<string, number>();

/** Kinds whose icon is recognizable enough that the extension isn't
 *  load-bearing for "what is this". Used by the `whenAmbiguous` extension
 *  policy. Binary / unknown / symlink fall through and keep their tail. */
const RECOGNIZABLE_KINDS = new Set([
  "image",
  "video",
  "audio",
  "pdf",
  "text",
  "markdown",
  "code",
  "archive",
  "spreadsheet",
  "document",
]);

/** Strip the extension based on the policy. Folders never have their
 *  name rewritten; symlinks behave as their target's kind. */
function displayName(e: Entry, showExtensions: ShowExtensions): string {
  if (e.isDir) return e.name;
  if (showExtensions === "always") return e.name;
  if (showExtensions === "whenAmbiguous" && !RECOGNIZABLE_KINDS.has(e.kind)) {
    return e.name;
  }
  const dot = e.name.lastIndexOf(".");
  return dot > 0 ? e.name.slice(0, dot) : e.name;
}

/** Render `name` with the first case-insensitive occurrence of `query`
 *  wrapped in a `<strong>`. Returns the plain string when there's no
 *  match or the query is empty. Pure helper — split out so the FileList
 *  row can stay tight. */
function renderHighlighted(name: string, query: string): React.ReactNode {
  if (!query) return name;
  const lower = name.toLowerCase();
  const q = query.toLowerCase();
  const i = lower.indexOf(q);
  if (i < 0) return name;
  const before = name.slice(0, i);
  const match = name.slice(i, i + query.length);
  const after = name.slice(i + query.length);
  return (
    <>
      {before}
      <Box
        component="strong"
        sx={{
          fontWeight: 700,
          color: "primary.main",
          backgroundColor: "action.selected",
          borderRadius: 0.5,
          px: 0.25,
        }}
      >
        {match}
      </Box>
      {after}
    </>
  );
}

/** Inline rename editor. Shown in place of the file name when F2 is
 *  pressed. Auto-focuses, selects the stem (everything before the
 *  last "." for files; whole name for folders / dotfiles) so the
 *  user can immediately type a replacement. Enter / blur commits;
 *  Esc cancels. */
function RenameInput({
  entry,
  draft,
  onDraftChange,
  onCommit,
  onCancel,
}: {
  entry: Entry;
  draft: string;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  // useRef so we can imperatively select the stem AFTER mount.
  // setSelectionRange in a useLayoutEffect fires before paint so the
  // user never sees the full-name selection flash.
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Stem = up to the last "." for non-folders that have an
    // extension (e.g. "report.pdf" → select "report"). Folders +
    // dotfiles (e.g. ".env") get the whole name selected so the
    // user can replace cleanly.
    if (!entry.isDir) {
      const lastDot = entry.name.lastIndexOf(".");
      if (lastDot > 0) {
        el.setSelectionRange(0, lastDot);
        return;
      }
    }
    el.select();
  }, []);
  return (
    <input
      ref={ref}
      value={draft}
      onChange={(e) => onDraftChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      // Blur commits — Finder behavior. Esc beats blur because it
      // sets renamingPath = null first, which unmounts this input.
      onBlur={onCommit}
      onClick={(e) => e.stopPropagation()}
      // Inherit theme typography so the input looks like the
      // Typography it replaces. Reset OS textfield styling.
      style={{
        font: "inherit",
        color: "inherit",
        background: "rgba(127, 127, 127, 0.15)",
        border: "1px solid rgba(127, 127, 127, 0.4)",
        borderRadius: 4,
        padding: "1px 4px",
        outline: "none",
        width: "100%",
        boxSizing: "border-box",
      }}
    />
  );
}

/** Header cell with click-to-sort + indicator arrow.
 *  Active column is rendered in `text.primary` with a 14 px MUI arrow
 *  icon; inactive columns reveal a faint arrow on hover so the column
 *  advertises that it's sortable without occupying visual weight when
 *  idle. The icon lives in a fixed-width 18 px slot so column widths
 *  stay stable when the active sort flips between columns. */
function HeaderCell({
  label,
  active,
  dir,
  onClick,
  width,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  width: CSSProperties["width"];
}) {
  const Arrow = dir === "asc" ? ArrowUpwardIcon : ArrowDownwardIcon;
  return (
    <Box
      role="columnheader"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      onClick={onClick}
      sx={{
        flex: width === undefined ? 1 : `0 0 ${width}`,
        width,
        cursor: "pointer",
        userSelect: "none",
        fontWeight: active ? 700 : 600,
        fontSize: "0.8125rem",
        color: active ? "text.primary" : "text.secondary",
        px: 1,
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        "&:hover": { color: "text.primary" },
        "&:hover .sort-indicator-hint": { opacity: 0.4 },
      }}
    >
      <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </Box>
      <Box
        component="span"
        sx={{
          width: 18,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "flex-start",
          flexShrink: 0,
        }}
      >
        {active ? (
          <Arrow sx={{ fontSize: 14 }} />
        ) : (
          <ArrowUpwardIcon
            className="sort-indicator-hint"
            sx={{ fontSize: 14, opacity: 0, transition: "opacity 120ms" }}
          />
        )}
      </Box>
    </Box>
  );
}

/** Virtualized grid for tile / gallery / column views. Computes
 *  columns-per-row from container width via ResizeObserver, then
 *  virtualizes the resulting row count. Each row's render function
 *  inlines columnsPerRow cells. Performance: O(visible rows) — a
 *  10k-entry folder in tile view is identical to a 10k-entry list. */
interface FileGridViewProps {
  sorted: Entry[];
  view: ViewMode;
  selected: Set<string>;
  focusedIdx: number;
  contextMenuPath: string | null;
  /** Forwarded from FileList for per-folder scroll memory. */
  path?: string;
  /** Inline rename state forwarded from FileList. When `path` matches
   *  the cell's entry.path, the cell renders a RenameInput instead
   *  of the static label. */
  renamingPath?: string | null;
  renameDraft?: string;
  onRenameDraftChange?: (v: string) => void;
  onCommitRename?: () => void;
  onCancelRename?: () => void;
  /** Paths currently being dragged. Their cells render at half opacity
   *  so the user can see what's in flight. Cleared on dragend. */
  draggingPaths: Set<string>;
  /** Mark paths as dragging when a drag starts (or [] to clear on
   *  end). FileList owns the state so the list-view code path uses
   *  the same Set + visual treatment. */
  onDraggingChange: (paths: Set<string>) => void;
  showExtensions: ShowExtensions;
  highlightQuery: string;
  onRowClick: (e: Entry, evt: React.MouseEvent) => void;
  onRowMouseDown: (e: Entry, evt: React.MouseEvent) => void;
  onRowDouble: (e: Entry) => void;
  onContext?: (entry: Entry, x: number, y: number) => void;
  onPrimarySelect?: (entry: Entry | null) => void;
  onContextEmpty?: (x: number, y: number) => void;
  /** Called whenever the computed columns-per-row changes. The
   *  FileList parent uses this to drive 2D arrow-key navigation
   *  in grid views (↑↓ jumps by cols, ←→ is ±1). Decoupled this
   *  way so FileGridView stays the single owner of the layout
   *  measurement (ResizeObserver). */
  onColsChange?: (cols: number) => void;
  /** Apply the rubber-band selection result. `paths` are the cells
   *  currently overlapping the drag rectangle. `additive` is true
   *  when the user held Cmd / Shift during the drag — those modes
   *  add to the existing selection instead of replacing it. */
  onRubberBand?: (paths: Set<string>, additive: boolean) => void;
  /** Date format used in the column-view metadata line. */
  dateFormat?: "locale" | "iso" | "short" | "relative";
  /** Per-extension icon override, threaded down so the grid views
   *  honor the same custom kinds as the list view. */
  customFileKinds?: Record<string, string>;
}

function FileGridView(props: FileGridViewProps) {
  const {
    sorted,
    view,
    selected,
    focusedIdx,
    contextMenuPath,
    showExtensions,
    highlightQuery,
    onRowClick,
    onRowMouseDown,
    onRowDouble,
    onContext,
    onPrimarySelect,
    onContextEmpty,
    onColsChange,
    onRubberBand,
    draggingPaths,
    onDraggingChange,
    path,
    renamingPath = null,
    renameDraft = "",
    onRenameDraftChange,
    onCommitRename,
    onCancelRename,
    dateFormat = "locale",
    customFileKinds = {},
  } = props;

  // Per-view sizing tuned to make the four grid modes visibly
  // distinct even when the folder has no image thumbnails:
  //   tile   = compact 80 px cell, small icon — "many at a glance"
  //   gallery = roomy 160 px cell, large icon, card affordance
  //             (rounded bg + shadow) so each entry reads as a
  //             "tile in a frame" even without a thumbnail
  //   column = wide 240 px cell, icon + name + bold size/mtime line
  //             so it's obviously a metadata-forward layout
  const cellWidth = view === "tile" ? 80 : view === "gallery" ? 160 : 240;
  const cellHeight = view === "tile" ? 88 : view === "gallery" ? 150 : 56;
  const iconSize = view === "tile" ? 32 : view === "gallery" ? 72 : 28;

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  // Use useLayoutEffect so the initial width measurement runs BEFORE
  // the browser paints. With useEffect the first frame would render
  // at containerWidth=0 → cols=1, and the user'd see a 1-column
  // flash before ResizeObserver fired and corrected the layout.
  // That manifested as visible flicker every time the user toggled
  // into a non-list view mode.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        // Round to integer + only update when the column-affecting
        // width actually changed. Sub-pixel drift from layout reflow
        // would otherwise re-render every frame.
        setContainerWidth((prev) => (prev === w ? prev : w));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Padding on the parent + gap between cells eats into available
  // width; keep a small buffer so the last column doesn't overflow.
  // Default to a wide-enough fallback (1 column) until the layout
  // effect runs — the real width arrives in the same paint frame
  // thanks to useLayoutEffect, so this default never reaches the
  // user as a visible state.
  const usableWidth = Math.max(0, containerWidth - 16);
  const cellSlot = cellWidth + 8; // cellWidth + gap
  const cols = containerWidth === 0
    ? 1
    : Math.max(1, Math.floor(usableWidth / cellSlot));
  const rowCount = Math.ceil(sorted.length / cols);

  // Notify parent when cols changes so FileList's keyboard handler
  // can drive 2D arrow-key navigation. useEffect (not in render) so
  // we don't fire setState-inside-render on the parent.
  useEffect(() => {
    onColsChange?.(cols);
  }, [cols, onColsChange]);

  // Per-folder scroll memory. Save the container's scrollTop on
  // every scroll (debounced via rAF). On entries / path change,
  // restore the saved offset for the new path. Also save once on
  // unmount so the position survives a tab switch / view switch.
  useEffect(() => {
    if (!path) return;
    const el = containerRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        scrollMemory.set(path, el.scrollTop);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      // Defensive: capture final position on unmount (the rAF may
      // not have fired before this cleanup runs).
      scrollMemory.set(path, el.scrollTop);
    };
  }, [path]);

  // Restore scroll position when entries / path change. Wait one
  // tick so the virtualizer renders rows before we set scrollTop —
  // setting it pre-render gets clamped to 0 by the empty container
  // height.
  useEffect(() => {
    if (!path) return;
    const el = containerRef.current;
    if (!el) return;
    const saved = scrollMemory.get(path) ?? 0;
    if (saved === 0) return;
    // requestAnimationFrame so the row layout flushes first.
    const raf = requestAnimationFrame(() => {
      el.scrollTop = saved;
    });
    return () => cancelAnimationFrame(raf);
    // sorted is the entries-changed signal; cols change also matters
    // since the virtualizer's row count depends on it.
  }, [path, sorted, cols]);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => cellHeight + 8, // row height + vertical gap
    overscan: 4,
  });

  // Rubber-band (drag rectangle) selection. State lives in a ref +
  // mirror state — refs for the hot mousemove path (avoid 60fps
  // setState), state for the rectangle render. Coords are in the
  // SCROLL container's coordinate system so they stay valid as the
  // user drags past the edge and the container scrolls.
  const dragRef = useRef<{
    startX: number;
    startY: number;
    additive: boolean;
    /** Snapshot of the selection at drag-start. Used to compute the
     *  live preview each mousemove: plain drag REPLACES with the
     *  current hit set; additive (Cmd/Shift) drag UNIONS the snapshot
     *  with the current hit set. Without the snapshot an additive
     *  drag would re-merge growing rectangles into an ever-larger
     *  selection that never shrinks. */
    baseSelection: Set<string>;
  } | null>(null);
  const [dragRect, setDragRect] = useState<
    | {
        left: number;
        top: number;
        width: number;
        height: number;
      }
    | null
  >(null);

  /** Convert a viewport-relative event into the container's
   *  local coordinate system (accounting for scroll position). */
  const localCoords = (clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: clientX - r.left + el.scrollLeft,
      y: clientY - r.top + el.scrollTop,
    };
  };

  /** Bounding box for cell at index `idx` in the rendered grid.
   *  Same math the render path uses (cellSlot × col, cellHeight × row,
   *  +/- p1=8px padding) so hit-testing matches what the user sees. */
  const cellBox = (idx: number) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    // Outer container has p=1 (8px). The grid row inside is laid out
    // with `gridTemplateColumns: repeat(cols, 1fr)` + `gap: 1` (8px).
    // We approximate the cell width as cellSlot - gap, anchoring at
    // p1 + col * cellSlot.
    const left = 8 + col * cellSlot;
    const top = 8 + row * (cellHeight + 8);
    return { left, top, right: left + cellWidth, bottom: top + cellHeight };
  };

  // Window-level mousemove + mouseup handlers — installed only while
  // a drag is active. CRITICAL: mouseup MUST be on `window`, not the
  // container, because the user can release the mouse anywhere on
  // screen and we still need to commit + clear the rectangle. The
  // previous container-only handler left phantom rectangles when the
  // user dragged past the toolbar / sidebar / app edge.
  useEffect(() => {
    if (!dragRect) return;
    // Auto-scroll: while the rubber-band is active and the cursor
    // sits near the container's top or bottom edge, scroll the
    // container so the user can extend the selection past the
    // viewport. Driven by an rAF loop that reads the latest cursor
    // position from a ref. Without this, dragging "downward" stops
    // selecting once the cursor hits the visible bottom — surprising
    // for users coming from Finder.
    let lastClientY = 0;
    let rafId = 0;
    const SCROLL_EDGE_PX = 30;
    const SCROLL_SPEED_PX = 12;
    const tick = () => {
      const el = containerRef.current;
      if (el && dragRef.current) {
        const r = el.getBoundingClientRect();
        if (lastClientY > r.bottom - SCROLL_EDGE_PX) {
          // Faster the closer to the edge.
          const t = Math.min(
            1,
            (lastClientY - (r.bottom - SCROLL_EDGE_PX)) / SCROLL_EDGE_PX,
          );
          el.scrollTop += SCROLL_SPEED_PX * t;
        } else if (lastClientY < r.top + SCROLL_EDGE_PX) {
          const t = Math.min(
            1,
            (r.top + SCROLL_EDGE_PX - lastClientY) / SCROLL_EDGE_PX,
          );
          el.scrollTop -= SCROLL_SPEED_PX * t;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    const onMove = (e: MouseEvent) => {
      lastClientY = e.clientY;
      if (!dragRef.current) return;
      // Clamp to the container's bounding rect so the rectangle
      // doesn't extend visually into the toolbar / sidebar.
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const clampedX = Math.max(r.left, Math.min(r.right, e.clientX));
      const clampedY = Math.max(r.top, Math.min(r.bottom, e.clientY));
      const localX = clampedX - r.left + el.scrollLeft;
      const localY = clampedY - r.top + el.scrollTop;
      const left = Math.min(dragRef.current.startX, localX);
      const top = Math.min(dragRef.current.startY, localY);
      const right = Math.max(dragRef.current.startX, localX);
      const bottom = Math.max(dragRef.current.startY, localY);
      const width = Math.abs(localX - dragRef.current.startX);
      const height = Math.abs(localY - dragRef.current.startY);
      setDragRect({ left, top, width, height });
      // Live-preview the selection: every cell whose bounding box
      // overlaps the current rect joins the hit set. Plain drag
      // REPLACES (selection = hit). Additive drag UNIONS the
      // baseSelection snapshot with the hit set so the user can
      // see live which cells are landing in the selection.
      if (width < 4 && height < 4) return; // sub-4px = treat as click; don't commit yet
      const hit = new Set<string>();
      for (let i = 0; i < sorted.length; i++) {
        const b = cellBox(i);
        if (
          b.right >= left &&
          b.left <= right &&
          b.bottom >= top &&
          b.top <= bottom
        ) {
          hit.add(sorted[i].path);
        }
      }
      if (dragRef.current.additive) {
        const merged = new Set(dragRef.current.baseSelection);
        for (const p of hit) merged.add(p);
        onRubberBand?.(merged, false /* replace, not additive */);
      } else {
        onRubberBand?.(hit, false);
      }
    };
    const onUp = (e: MouseEvent) => {
      if (!dragRef.current) {
        setDragRect(null);
        return;
      }
      // Selection has been live-committed on every mousemove already
      // — onUp just tears down the rectangle + handles the "click on
      // empty space" case (sub-4px drag = click; clears selection on
      // plain click, preserves on modifier).
      const el = containerRef.current;
      const r = el?.getBoundingClientRect();
      const clampedX = r
        ? Math.max(r.left, Math.min(r.right, e.clientX))
        : e.clientX;
      const clampedY = r
        ? Math.max(r.top, Math.min(r.bottom, e.clientY))
        : e.clientY;
      const localX = el && r ? clampedX - r.left + el.scrollLeft : 0;
      const localY = el && r ? clampedY - r.top + el.scrollTop : 0;
      const right = Math.max(dragRef.current.startX, localX);
      const left = Math.min(dragRef.current.startX, localX);
      const bottom = Math.max(dragRef.current.startY, localY);
      const top = Math.min(dragRef.current.startY, localY);
      const isClick = right - left < 4 && bottom - top < 4;
      if (isClick && !dragRef.current.additive) {
        onRubberBand?.(new Set(), false);
      }
      dragRef.current = null;
      setDragRect(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    // Defensive: clear if the user Esc-cancels the drag (e.g. via
    // Cmd+Tab away mid-drag). Some platforms fire window blur in
    // those cases; also handle dragend for completeness.
    const onCancel = () => {
      dragRef.current = null;
      setDragRect(null);
    };
    window.addEventListener("blur", onCancel);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onCancel);
    };
    // dragRect is the trigger; the rest of the closure values are
    // referenced via refs / cell-box math, all reading the latest
    // values at event-time without needing dep tracking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragRect != null]);

  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        bgcolor: "background.paper",
      }}
    >
      <Box
        ref={containerRef}
        onContextMenu={(evt) => {
          if (!onContextEmpty) return;
          const target = evt.target as HTMLElement;
          if (target.closest('[data-testid="file-grid-cell"]')) return;
          evt.preventDefault();
          onContextEmpty(evt.clientX, evt.clientY);
        }}
        onMouseDown={(evt) => {
          // Rubber-band only starts on left button + clicks on the
          // container's whitespace (NOT on a cell, NOT on an input
          // / button / link inside the cell area). Cell clicks go
          // through the normal selection path.
          if (evt.button !== 0) return;
          const target = evt.target as HTMLElement;
          if (target.closest('[data-testid="file-grid-cell"]')) return;
          // The mousedown's clientY must be INSIDE the container's
          // bounding rect — defends against synthetic events bubbling
          // from elsewhere (toolbars / inputs / sidebar) that could
          // otherwise start a phantom drag whose mouseup we'd never
          // see if the user releases over a sibling element.
          const el = containerRef.current;
          if (!el) return;
          const r = el.getBoundingClientRect();
          if (
            evt.clientX < r.left ||
            evt.clientX > r.right ||
            evt.clientY < r.top ||
            evt.clientY > r.bottom
          ) {
            return;
          }
          const { x, y } = localCoords(evt.clientX, evt.clientY);
          dragRef.current = {
            startX: x,
            startY: y,
            additive: evt.metaKey || evt.ctrlKey || evt.shiftKey,
            // Snapshot the existing selection so additive drags can
            // union against it on every move (without the snapshot
            // we'd re-merge against a growing selection).
            baseSelection: new Set(selected),
          };
          setDragRect({ left: x, top: y, width: 0, height: 0 });
          // preventDefault stops native text-selection from kicking
          // in alongside the rubber-band rectangle.
          evt.preventDefault();
        }}
        sx={{
          flex: 1,
          // Always reserve scrollbar space so a layout-induced
          // overflow doesn't shrink usable width → re-fit → no
          // overflow → scrollbar disappears → repeat. That feedback
          // loop manifested as visible flicker in column view.
          overflowY: "scroll",
          overflowX: "hidden",
          scrollbarGutter: "stable",
          minHeight: 0,
          p: 1,
          position: "relative",
          // Disable text selection during drag so the rubber band
          // doesn't double-up with browser text-select.
          userSelect: dragRect ? "none" : undefined,
        }}
      >
        {sorted.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ p: 2, textAlign: "center" }}
          >
            Empty folder
          </Typography>
        ) : (
          <Box
            sx={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {/* Rubber-band selection rectangle. Lives inside the
             *  scroll-tracking inner Box so it scrolls with the grid
             *  contents — coords are already in container-local
             *  space. Subtract the outer p1=8px padding because the
             *  inner virtual-grid Box doesn't have it. */}
            {dragRect && (dragRect.width > 1 || dragRect.height > 1) && (
              <Box
                sx={{
                  position: "absolute",
                  left: dragRect.left - 8,
                  top: dragRect.top - 8,
                  width: dragRect.width,
                  height: dragRect.height,
                  bgcolor: (theme) =>
                    `${theme.palette.primary.main}1f` /* 12% alpha */,
                  border: 1,
                  borderColor: "primary.main",
                  borderStyle: "solid",
                  pointerEvents: "none",
                  zIndex: 2,
                  borderRadius: 0.5,
                }}
              />
            )}
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const startIdx = vi.index * cols;
              const endIdx = Math.min(startIdx + cols, sorted.length);
              return (
                <Box
                  key={vi.index}
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                    display: "grid",
                    gridTemplateColumns: `repeat(${cols}, 1fr)`,
                    gap: 1,
                  }}
                >
                  {sorted.slice(startIdx, endIdx).map((e, j) => {
                    const idx = startIdx + j;
                    const isSel = selected.has(e.path);
                    const isFocused = idx === focusedIdx;
                    return (
                      <Box
                        key={e.path}
                        data-testid="file-grid-cell"
                        draggable
                        onDragStart={(evt) => {
                          const paths =
                            selected.size > 0 && selected.has(e.path)
                              ? Array.from(selected)
                              : [e.path];
                          evt.dataTransfer.setData(
                            "application/x-skiff-paths",
                            paths.join("\n"),
                          );
                          evt.dataTransfer.effectAllowed = "copy";
                          onDraggingChange(new Set(paths));
                          const localPaths = paths.filter(
                            (p) => !p.startsWith("sftp://"),
                          );
                          if (localPaths.length > 0) {
                            void startNativeDrag(localPaths).catch(() => {});
                          }
                        }}
                        onDragEnd={() => onDraggingChange(new Set())}
                        onClick={(evt) => onRowClick(e, evt)}
                        onMouseDown={(evt) => onRowMouseDown(e, evt)}
                        onDoubleClick={() => onRowDouble(e)}
                        onContextMenu={(evt) => {
                          evt.preventDefault();
                          onPrimarySelect?.(e);
                          onContext?.(e, evt.clientX, evt.clientY);
                        }}
                        sx={{
                          display: "flex",
                          flexDirection: view === "column" ? "row" : "column",
                          alignItems: "center",
                          gap: view === "column" ? 1.5 : 0.5,
                          p: 1,
                          height: cellHeight,
                          borderRadius: view === "gallery" ? 2 : 1,
                          cursor: e.isDir ? "pointer" : "default",
                          // Gallery view: card affordance — translucent
                          // background + soft shadow so each cell reads
                          // as a "framed tile" even when the entry is a
                          // folder (no image thumbnail). Distinguishes
                          // gallery from tile when neither has an image.
                          ...(view === "gallery"
                            ? {
                                bgcolor: isSel
                                  ? "action.selected"
                                  : "background.default",
                                boxShadow: isSel
                                  ? "none"
                                  : (theme: import("@mui/material/styles").Theme) =>
                                      `0 1px 2px ${theme.palette.action.disabled}`,
                                border: 1,
                                borderColor: "divider",
                              }
                            : {
                                bgcolor: isSel
                                  ? "action.selected"
                                  : "transparent",
                              }),
                          // Focus / context-menu inset outline takes
                          // priority over the gallery card shadow.
                          ...(e.path === contextMenuPath
                            ? {
                                boxShadow: (theme) =>
                                  `inset 0 0 0 1px ${theme.palette.text.secondary}`,
                              }
                            : isFocused
                              ? {
                                  boxShadow: (theme) =>
                                    `inset 0 0 0 2px ${theme.palette.primary.main}`,
                                }
                              : {}),
                          // Drag-source dim: cells in flight render at
                          // 0.4 opacity so the user can see what's
                          // being moved. Hidden-entry dim (0.55) is
                          // separate; the lower of the two wins.
                          opacity: draggingPaths.has(e.path)
                            ? 0.4
                            : e.isHidden
                              ? 0.55
                              : 1,
                          "&:hover": {
                            bgcolor: isSel ? "action.selected" : "action.hover",
                          },
                          textAlign:
                            view === "column"
                              ? ("left" as const)
                              : ("center" as const),
                          overflow: "hidden",
                          // Disable native text selection on cells so
                          // dragging / clicking doesn't accidentally
                          // highlight the label text. Files are rows,
                          // not paragraphs.
                          userSelect: "none",
                        }}
                      >
                        <Box
                          onClick={(evt) => {
                            evt.stopPropagation();
                            onRowDouble(e);
                          }}
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            cursor: "pointer",
                          }}
                          title="Click to open"
                        >
                          {/* Gallery view loads inline image thumbnails;
                           *  tile + column views stick to the kind icon
                           *  to keep listing perceived perf high (gallery
                           *  is the only mode where a thumbnail wait is
                           *  user-expected). Remote (sftp://) entries
                           *  always use the icon since fs_read_base64 is
                           *  local-only. */}
                          {view === "gallery" ? (
                            <GalleryThumb
                              path={e.path}
                              kind={e.kind}
                              size={iconSize}
                              remote={e.path.startsWith("sftp://")}
                            />
                          ) : (
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: iconSize,
                                height: iconSize,
                                "& svg": { fontSize: iconSize - 4 },
                              }}
                            >
                              <IconForKind kind={resolveDisplayKind(e, customFileKinds) as typeof e.kind} />
                            </Box>
                          )}
                        </Box>
                        <Box
                          sx={{
                            flex: view === "column" ? 1 : "none",
                            minWidth: 0,
                            width: view === "column" ? "auto" : "100%",
                          }}
                        >
                          {renamingPath === e.path && onCommitRename && onCancelRename && onRenameDraftChange ? (
                            <RenameInput
                              entry={e}
                              draft={renameDraft}
                              onDraftChange={onRenameDraftChange}
                              onCommit={onCommitRename}
                              onCancel={onCancelRename}
                            />
                          ) : (
                            <Typography
                              variant="body2"
                              noWrap
                              sx={{
                                textAlign:
                                  view === "column"
                                    ? ("left" as const)
                                    : ("center" as const),
                              }}
                              title={e.name}
                            >
                              {renderHighlighted(
                                displayName(e, showExtensions),
                                highlightQuery,
                              )}
                              {e.isSymlink ? " ↪" : ""}
                            </Typography>
                          )}
                          {view === "column" && (
                            // Column view: bump the metadata line to
                            // body2 + medium weight so the layout reads
                            // clearly as "metadata-forward" — distinct
                            // from tile (metadata absent) and gallery
                            // (visual-forward).
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              noWrap
                              sx={{
                                display: "block",
                                fontSize: "0.75rem",
                                fontWeight: 500,
                                mt: 0.25,
                              }}
                            >
                              {e.isDir ? "Folder" : formatBytes(e.size)}
                              {e.mtime ? ` · ${formatMtimeAs(e.mtime, dateFormat)}` : ""}
                              {!e.isDir && e.kind ? ` · ${e.kind}` : ""}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default function FileList(props: Props) {
  const {
    entries,
    sortKey,
    sortDir,
    onSortChange,
    onOpenDir,
    onOpenFile,
    onOpenDirInNewTab,
    onPrimarySelect,
    onSelectionChange,
    onContext,
    density,
    showExtensions,
    isActive = true,
    groupFoldersFirst = true,
    highlightQuery = "",
    onDropOntoFolder,
    onContextEmpty,
    contextMenuPath = null,
    fileTags = {},
    customFileKinds = {},
    dateFormat = "locale",
    hideColumns = {},
    view = "list",
    path,
    onRename,
  } = props;

  /** Inline rename state. `renamingPath` is the entry currently being
   *  edited; `renameDraft` is the in-progress name. F2 starts the
   *  edit; Enter / blur commits; Esc cancels.  */
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");

  /** Folder-size hover state. Hovering a folder row for ≥ 800 ms kicks
   *  a `dirSummary` walk; the result fills in the size column. Cached
   *  via `folderSizeCache` so a second hover is instant. */
  const [folderSizes, setFolderSizes] = useState<Record<string, number>>({});
  const folderHoverTimer = useRef<number | null>(null);
  const armFolderHover = useCallback((path: string, isDir: boolean) => {
    if (!isDir) return;
    if (folderHoverTimer.current != null) {
      clearTimeout(folderHoverTimer.current);
    }
    const cached = getCachedFolderSize(path);
    if (cached) {
      setFolderSizes((m) => ({ ...m, [path]: cached.totalSize }));
      return;
    }
    folderHoverTimer.current = window.setTimeout(() => {
      void fetchFolderSize(path)
        .then((s) => {
          setFolderSizes((m) => ({ ...m, [path]: s.totalSize }));
        })
        .catch(() => {
          /* permissions / disconnected sftp / etc. — silently skip */
        });
    }, 800);
  }, []);
  const cancelFolderHover = useCallback(() => {
    if (folderHoverTimer.current != null) {
      clearTimeout(folderHoverTimer.current);
      folderHoverTimer.current = null;
    }
  }, []);
  // Cancel any in-flight hover timer when the folder changes / list
  // unmounts so a freshly-arrived listing isn't haunted by a fetch
  // queued for a previous path.
  useEffect(() => {
    setFolderSizes({});
    return () => {
      if (folderHoverTimer.current != null) {
        clearTimeout(folderHoverTimer.current);
      }
    };
  }, [path]);

  const startInlineRename = (e: Entry) => {
    setRenamingPath(e.path);
    setRenameDraft(e.name);
  };
  const commitInlineRename = () => {
    if (!renamingPath || !onRename) {
      setRenamingPath(null);
      return;
    }
    const targetEntry = entries.find((x) => x.path === renamingPath);
    if (!targetEntry) {
      setRenamingPath(null);
      return;
    }
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === targetEntry.name) {
      setRenamingPath(null);
      return;
    }
    // Refuse path separators in the new name — that would be a move,
    // not a rename, and surprises users.
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      setRenamingPath(null);
      return;
    }
    void onRename(targetEntry, trimmed)
      .catch(() => {
        /* parent surfaces the error via setError */
      })
      .finally(() => setRenamingPath(null));
  };
  const cancelInlineRename = () => {
    setRenamingPath(null);
  };

  // Memoized so a re-render that doesn't change entries/sort doesn't re-sort.
  const sorted = useMemo(
    () => sortEntries(entries, sortKey, sortDir, groupFoldersFirst, fileTags),
    [entries, sortKey, sortDir, groupFoldersFirst, fileTags],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Keyboard-focused row index. Drives the highlighted row visual
   *  + the scroll-into-view + the Enter/Backspace targets. -1 = no
   *  row focused (e.g. an empty folder). */
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  /** Paths currently being dragged (the source rows). Set during
   *  onDragStart, cleared on dragend / drop. Drives a "ghost"
   *  opacity on the source rows so the user can see what's in
   *  flight — standard file manager behavior. */
  const [draggingPaths, setDraggingPaths] = useState<Set<string>>(new Set());
  /** Type-ahead navigation buffer + last keystroke timestamp. Refs
   *  rather than state — we don't want the typing to trigger a
   *  re-render on every keystroke. */
  const typeAheadBuffer = useRef<string>("");
  const typeAheadLastKey = useRef<number>(0);
  /** Columns-per-row reported by FileGridView (for grid views). 1
   *  in list view since arrows there are inherently 1D. The grid
   *  pushes updates via onColsChange whenever ResizeObserver
   *  retriggers. Drives the 2D arrow-key nav below. */
  const [gridCols, setGridCols] = useState<number>(1);
  /** Idle window after which the type-ahead buffer resets. 800ms
   *  matches Finder's perceived behavior — slow enough to type a
   *  3-letter prefix, fast enough that a fresh search starts clean. */
  const TYPEAHEAD_RESET_MS = 800;
  /** Advance focus to the next entry whose name starts with the
   *  accumulated type-ahead buffer (case-insensitive). Cycling
   *  behavior: pressing the same letter repeatedly walks past
   *  successive matches. Falls through silently when nothing
   *  matches. */
  const typeAheadAdvance = (key: string) => {
    const now = Date.now();
    // Reset buffer when idle window elapsed since the last keystroke.
    if (now - typeAheadLastKey.current > TYPEAHEAD_RESET_MS) {
      typeAheadBuffer.current = "";
    }
    typeAheadLastKey.current = now;
    typeAheadBuffer.current = (typeAheadBuffer.current + key).toLowerCase();
    const buf = typeAheadBuffer.current;
    // Search starts at focusedIdx + 1 so repeated keys cycle through
    // matches. Wraps to the start so the user always finds the
    // alphabetically-first match.
    const start = Math.max(0, focusedIdx + (buf.length === 1 ? 1 : 0));
    for (let i = 0; i < sorted.length; i++) {
      const idx = (start + i) % sorted.length;
      if (sorted[idx].name.toLowerCase().startsWith(buf)) {
        setFocusedIdx(idx);
        return;
      }
    }
    // No match — ignore the keystroke. Buffer keeps growing so a
    // mistyped letter at the end can be backspaced (we don't yet
    // wire backspace; this is a future polish).
  };
  /** Index of the row currently being hovered with a drag payload.
   *  Drives the inset primary border so the user sees where the drop
   *  will land. */
  const [dragOverIdx, setDragOverIdx] = useState<number>(-1);
  const parentRef = useRef<HTMLDivElement>(null);

  // Path-change detector. Lets us distinguish navigation (reset
  // selection — stale paths from a previous folder are nonsense) from
  // a refresh-in-place (preserve the user's selection wherever the
  // entries still exist in the new listing — fixes a fs-watcher
  // refresh from blowing away an active multi-select). The initial
  // sentinel `null` is distinct from any real path so the first
  // mount counts as a path change, mirroring the previous reset
  // behavior.
  const lastPathRef = useRef<string | null | undefined>(null);
  useEffect(() => {
    const pathChanged = lastPathRef.current !== path;
    lastPathRef.current = path;
    if (pathChanged) {
      setSelected(new Set());
      setFocusedIdx(entries.length > 0 ? 0 : -1);
      return;
    }
    // Refresh in place — keep selection rows that still exist.
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      const stillThere = new Set(entries.map((e) => e.path));
      for (const p of prev) if (stillThere.has(p)) next.add(p);
      // Reference-stable when nothing was dropped — avoids a no-op
      // re-render that'd cascade through the selection effect chain.
      return next.size === prev.size ? prev : next;
    });
    if (entries.length === 0) setFocusedIdx(-1);
  }, [entries, path]);

  // Per-folder scroll memory for the list view. Mirrors the same
  // logic FileGridView uses — save on scroll (rAF-debounced), restore
  // after entries change. The grid view has its own copy because the
  // scroll container lives there; list view's scroll container is
  // parentRef here.
  useEffect(() => {
    if (!path || view !== "list") return;
    const el = parentRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        scrollMemory.set(path, el.scrollTop);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      scrollMemory.set(path, el.scrollTop);
    };
  }, [path, view]);

  useEffect(() => {
    if (!path || view !== "list") return;
    const el = parentRef.current;
    if (!el) return;
    const saved = scrollMemory.get(path) ?? 0;
    if (saved === 0) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = saved;
    });
    return () => cancelAnimationFrame(raf);
  }, [path, sorted, view]);

  // Notify the parent on every selection change. Memoized via an effect
  // rather than calling inside the click handler so we don't fire twice
  // on the synthetic-event + state-update boundary.
  useEffect(() => {
    onSelectionChange?.(Array.from(selected));
  }, [selected, onSelectionChange]);

  // Keyboard navigation. Active only on the foreground tab and only
  // when no input is focused (so typing in the path bar / search box
  // doesn't jump rows). The handler operates on `sorted` so arrow
  // movement matches what the user actually sees, even when the
  // sort flips.
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
      if (sorted.length === 0) return;

      const cmd = e.metaKey || e.ctrlKey;
      // Grid views (tile / gallery / column) navigate in 2D: ↑↓
      // jumps by `cols` rows, ←→ is ±1. List view is 1D so step
      // = 1 for ↑↓ and ←→ are no-ops there. Cmd+← / Cmd+→ stay
      // reserved for back/forward (Browser-level handler).
      const stepDown = view !== "list" ? Math.max(1, gridCols) : 1;
      /** Move focus by `delta` and, if Shift was held, extend the
       *  multi-selection from the previously-focused row to the new
       *  one. Standard Finder / Explorer keyboard range-select. */
      const moveFocus = (delta: number, shiftKey: boolean) => {
        setFocusedIdx((prev) => {
          const start = prev < 0 ? 0 : prev;
          const next = Math.max(
            0,
            Math.min(sorted.length - 1, start + delta),
          );
          if (shiftKey && next !== prev) {
            const lo = Math.min(start, next);
            const hi = Math.max(start, next);
            const range = sorted.slice(lo, hi + 1).map((s) => s.path);
            setSelected((s) => {
              const out = new Set(s);
              for (const p of range) out.add(p);
              return out;
            });
          }
          return next;
        });
      };
      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          moveFocus(stepDown, e.shiftKey);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          moveFocus(-stepDown, e.shiftKey);
          break;
        }
        case "ArrowRight": {
          if (view === "list") return;
          if (cmd) return; // Browser owns Cmd+→ for forward nav.
          e.preventDefault();
          moveFocus(1, e.shiftKey);
          break;
        }
        case "ArrowLeft": {
          if (view === "list") return;
          if (cmd) return; // Browser owns Cmd+← for back nav.
          e.preventDefault();
          moveFocus(-1, e.shiftKey);
          break;
        }
        case "Home": {
          e.preventDefault();
          setFocusedIdx(0);
          break;
        }
        case "End": {
          e.preventDefault();
          setFocusedIdx(sorted.length - 1);
          break;
        }
        case "PageDown": {
          // Jump roughly one viewport. We don't know the exact pixel
          // height of the visible window in this handler, so pick a
          // sensible page size — 12 rows comfortable, 16 compact for
          // list view; for grid views multiply by cols so the user
          // jumps ROWS-of-cells rather than cells.
          e.preventDefault();
          const rowsPerPage = density === "compact" ? 16 : 12;
          const page = view === "list" ? rowsPerPage : rowsPerPage * stepDown;
          setFocusedIdx((i) =>
            Math.min(sorted.length - 1, Math.max(0, i) + page),
          );
          break;
        }
        case "PageUp": {
          e.preventDefault();
          const rowsPerPage = density === "compact" ? 16 : 12;
          const page = view === "list" ? rowsPerPage : rowsPerPage * stepDown;
          setFocusedIdx((i) => Math.max(0, (i < 0 ? 0 : i) - page));
          break;
        }
        case "Enter": {
          // Only fire when a row is focused. Skips when the focus is
          // on a checkbox / button (those would have tag === "input"
          // already and bailed out above, but be defensive).
          if (focusedIdx < 0 || focusedIdx >= sorted.length) return;
          e.preventDefault();
          const row = sorted[focusedIdx];
          if (row.isDir) onOpenDir(row);
          break;
        }
        case "F2": {
          // Inline rename — replaces the dialog flow when onRename
          // is wired. Single-select only; multi-select rename uses
          // the bulk dialog (Browser handles that).
          if (focusedIdx < 0 || focusedIdx >= sorted.length) return;
          if (!onRename) return; // fall through to parent
          if (selected.size > 1) return; // bulk path stays in Browser
          e.preventDefault();
          startInlineRename(sorted[focusedIdx]);
          break;
        }
        case "Escape": {
          if (selected.size === 0) return;
          e.preventDefault();
          setSelected(new Set());
          break;
        }
        case "a":
        case "A": {
          if (!cmd) return;
          e.preventDefault();
          setSelected(new Set(sorted.map((s) => s.path)));
          break;
        }
        case "c":
        case "C":
        case "x":
        case "X": {
          // Cmd/Ctrl+C → file clipboard (operation: copy). Cmd/Ctrl+X
          // → file clipboard (operation: cut). The actual file move
          // happens on Cmd/Ctrl+V in the destination folder. We also
          // mirror the paths to the OS text clipboard so users can
          // paste into a terminal — preserves the behavior shipped
          // in 0.2.55.
          if (!cmd) return;
          const targets =
            selected.size > 0
              ? Array.from(selected)
              : focusedIdx >= 0 && focusedIdx < sorted.length
                ? [sorted[focusedIdx].path]
                : [];
          if (targets.length === 0) return;
          e.preventDefault();
          const op = e.key.toLowerCase() === "x" ? "cut" : "copy";
          setFileClipboard(targets, op);
          if (typeof navigator !== "undefined" && navigator.clipboard) {
            void navigator.clipboard.writeText(targets.join("\n"));
          }
          break;
        }
        case " ": {
          // Space toggles the focused row's selection — matches Finder's
          // muscle memory.
          if (focusedIdx < 0) return;
          e.preventDefault();
          toggleSel(sorted[focusedIdx].path, true);
          break;
        }
        default: {
          // Type-ahead navigation: typing a letter (without modifiers)
          // jumps to the next entry whose name starts with the
          // accumulated buffer. Standard Finder / Explorer / Files
          // behavior. Buffer auto-resets after TYPEAHEAD_RESET_MS of
          // no typing so a fresh "f" doesn't continue a stale match.
          //
          // Skipped when:
          //   - Modifiers are held (preserves Cmd+1/2/9 etc.)
          //   - The key is a multi-char or non-printable name (Tab,
          //     ArrowLeft, F1, etc. — `length === 1` filters them out)
          if (cmd || e.altKey) return;
          if (e.key.length !== 1) return;
          // Only printable characters. Excludes raw whitespace
          // beyond Space (already handled above) and pure control.
          const code = e.key.charCodeAt(0);
          if (code < 0x20) return;
          e.preventDefault();
          typeAheadAdvance(e.key);
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `toggleSel` and `onOpenDir` are stable identifiers from the
    // parent in practice; the dep list intentionally captures only
    // the values we read inside the handler that change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, sorted, focusedIdx, selected, onOpenDir, view, gridCols, density]);

  // When the focused row moves, update the primary selection + scroll
  // it into view. We don't toggle the multi-selection set here — that
  // happens via Space.
  useEffect(() => {
    if (focusedIdx < 0 || focusedIdx >= sorted.length) return;
    onPrimarySelect?.(sorted[focusedIdx]);
    rowVirtualizer.scrollToIndex(focusedIdx, { align: "auto" });
    // We deliberately don't depend on `onPrimarySelect` to avoid
    // re-running on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedIdx, sorted]);

  // Row height is the dominant perf knob — keep both densities in sync with
  // the inner row Box height below.
  const rowH = density === "compact" ? 24 : 32;

  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 12,
  });

  const toggleSel = (path: string, additive: boolean) => {
    setSelected((prev) => {
      const next = new Set(additive ? prev : []);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const onRowClick = (e: Entry, evt: React.MouseEvent) => {
    const idx = sorted.findIndex((s) => s.path === e.path);
    // Shift+click → range-select from the previously focused row to
    // this one. Finder / Explorer / VS Code muscle memory. Falls
    // back to single-select when there's no focused anchor yet.
    if (evt.shiftKey && focusedIdx >= 0 && idx >= 0) {
      const lo = Math.min(focusedIdx, idx);
      const hi = Math.max(focusedIdx, idx);
      const range = sorted.slice(lo, hi + 1).map((s) => s.path);
      setSelected((prev) => {
        // Merge: shift+click extends the existing selection rather
        // than replacing — matches Finder. Cmd+Shift+click would
        // extend strictly, but the simpler "union with range"
        // semantics is rarely surprising.
        const next = new Set(prev);
        for (const p of range) next.add(p);
        return next;
      });
      onPrimarySelect?.(e);
      setFocusedIdx(idx);
      return;
    }
    toggleSel(e.path, evt.metaKey || evt.ctrlKey);
    onPrimarySelect?.(e);
    if (idx >= 0) setFocusedIdx(idx);
  };
  /** Middle-click on a folder → open in a new tab (browser muscle
   *  memory). We hook `onMouseDown` rather than `onAuxClick` because
   *  the click event with button 1 doesn't bubble through React's
   *  primary-click pipeline in some webview / jsdom setups; mousedown
   *  fires unconditionally and gives us the button index. */
  const onRowMouseDown = (e: Entry, evt: React.MouseEvent) => {
    if (evt.button !== 1) return;
    if (!e.isDir || !onOpenDirInNewTab) return;
    // preventDefault stops the OS's auto-scroll cursor that middle-click
    // would otherwise summon.
    evt.preventDefault();
    onOpenDirInNewTab(e);
  };
  const onRowDouble = (e: Entry) => {
    if (e.isDir) onOpenDir(e);
    else if (onOpenFile) onOpenFile(e);
  };

  // Non-list views — virtualized row-based grid. Computes columns
  // per row from the container width, then virtualizes the resulting
  // row count. Each row renders columnsPerRow cells inline. Same
  // selection / dblclick / right-click flows as the list view.
  if (view !== "list") {
    return (
      <FileGridView
        sorted={sorted}
        view={view}
        selected={selected}
        focusedIdx={focusedIdx}
        contextMenuPath={contextMenuPath}
        showExtensions={showExtensions}
        highlightQuery={highlightQuery}
        dateFormat={dateFormat}
        customFileKinds={customFileKinds}
        path={path}
        onRowClick={onRowClick}
        onRowMouseDown={onRowMouseDown}
        onRowDouble={onRowDouble}
        onContext={onContext}
        onPrimarySelect={onPrimarySelect}
        onContextEmpty={onContextEmpty}
        onColsChange={setGridCols}
        draggingPaths={draggingPaths}
        onDraggingChange={setDraggingPaths}
        renamingPath={renamingPath}
        renameDraft={renameDraft}
        onRenameDraftChange={setRenameDraft}
        onCommitRename={commitInlineRename}
        onCancelRename={cancelInlineRename}
        onRubberBand={(paths, additive) => {
          setSelected((prev) => {
            // additive (Cmd/Shift held during drag) merges with the
            // existing selection. Plain drag replaces it. An empty
            // result with !additive clears (the "click on empty
            // space" behavior the rubber-band path emulates for
            // sub-4px drags).
            if (!additive) return new Set(paths);
            const next = new Set(prev);
            for (const p of paths) next.add(p);
            return next;
          });
        }}
      />
    );
  }

  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        bgcolor: "background.paper",
      }}
    >
      <Box
        role="row"
        sx={{
          display: "flex",
          alignItems: "center",
          py: 0.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Box sx={{ width: 36 }} />
        <HeaderCell
          label="Name"
          active={sortKey === "name"}
          dir={sortDir}
          onClick={() => onSortChange("name")}
          width={undefined}
        />
        {!hideColumns.size && (
          <HeaderCell
            label="Size"
            active={sortKey === "size"}
            dir={sortDir}
            onClick={() => onSortChange("size")}
            width={96}
          />
        )}
        {!hideColumns.modified && (
          <HeaderCell
            label="Modified"
            active={sortKey === "mtime"}
            dir={sortDir}
            onClick={() => onSortChange("mtime")}
            width={180}
          />
        )}
        {!hideColumns.kind && (
          <HeaderCell
            label="Kind"
            active={sortKey === "kind"}
            dir={sortDir}
            onClick={() => onSortChange("kind")}
            width={120}
          />
        )}
      </Box>

      <Box
        ref={parentRef}
        role="grid"
        aria-rowcount={sorted.length}
        onContextMenu={(evt) => {
          // Only fire for whitespace clicks — row contextmenu has
          // already stopped propagation via its own handler.
          if (!onContextEmpty) return;
          // The row handler calls preventDefault. If we got here,
          // the click was on the scroll container itself, not a
          // row's nested element.
          const target = evt.target as HTMLElement;
          if (target.closest('[data-testid="file-row"]')) return;
          evt.preventDefault();
          onContextEmpty(evt.clientX, evt.clientY);
        }}
        sx={{ flex: 1, overflow: "auto", minHeight: 0 }}
      >
        {sorted.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ p: 2, textAlign: "center" }}
          >
            Empty folder
          </Typography>
        ) : (
          <Box
            sx={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const e = sorted[vi.index];
              const isSel = selected.has(e.path);
              const isFocused = vi.index === focusedIdx;
              return (
                <Box
                  key={e.path}
                  role="row"
                  aria-selected={isSel}
                  // Keyboard focus target. Roving tabindex pattern:
                  // only the focused row is in the tab order; arrow
                  // keys move `focusedIdx` and the next render
                  // promotes the new row. Prevents Tab from cycling
                  // through every row in a 10k-entry list.
                  tabIndex={isFocused ? 0 : -1}
                  data-testid="file-row"
                  draggable
                  onDragStart={(evt) => {
                    // Drag payload: newline-joined paths from the
                    // multi-selection (or just this row when nothing
                    // is multi-selected). Sidebar host items consume
                    // this to start a Skiffsync.
                    const paths =
                      selected.size > 0 && selected.has(e.path)
                        ? Array.from(selected)
                        : [e.path];
                    evt.dataTransfer.setData(
                      "application/x-skiff-paths",
                      paths.join("\n"),
                    );
                    evt.dataTransfer.effectAllowed = "copy";
                    setDraggingPaths(new Set(paths));
                    // Also kick the OS-native drag so dropping into
                    // Finder / Explorer / Desktop works. Local paths
                    // only — sftp:// URLs aren't real OS file paths.
                    const localPaths = paths.filter(
                      (p) => !p.startsWith("sftp://"),
                    );
                    if (localPaths.length > 0) {
                      void startNativeDrag(localPaths).catch(() => {
                        /* plugin not available — in-app drag still works */
                      });
                    }
                  }}
                  onDragEnd={() => setDraggingPaths(new Set())}
                  onDragOver={(evt) => {
                    if (
                      e.isDir &&
                      onDropOntoFolder &&
                      evt.dataTransfer.types.includes(
                        "application/x-skiff-paths",
                      )
                    ) {
                      evt.preventDefault();
                      evt.dataTransfer.dropEffect = "copy";
                      if (dragOverIdx !== vi.index) setDragOverIdx(vi.index);
                    }
                  }}
                  onDragLeave={() => {
                    if (dragOverIdx === vi.index) setDragOverIdx(-1);
                  }}
                  onDrop={(evt) => {
                    if (!e.isDir || !onDropOntoFolder) return;
                    const raw = evt.dataTransfer.getData(
                      "application/x-skiff-paths",
                    );
                    if (!raw) return;
                    evt.preventDefault();
                    setDragOverIdx(-1);
                    const paths = raw.split("\n").filter(Boolean);
                    // Don't drop a folder onto itself — that would
                    // try to nest the folder under itself which is
                    // never what the user wants.
                    const filtered = paths.filter((p) => p !== e.path);
                    if (filtered.length > 0) onDropOntoFolder(filtered, e);
                  }}
                  onClick={(evt) => onRowClick(e, evt)}
                  onMouseDown={(evt) => onRowMouseDown(e, evt)}
                  onMouseEnter={() => armFolderHover(e.path, e.isDir)}
                  onMouseLeave={cancelFolderHover}
                  onDoubleClick={() => onRowDouble(e)}
                  onContextMenu={(evt) => {
                    evt.preventDefault();
                    // Promote the right-clicked row to primary so the
                    // preview pane and context-menu actions agree on
                    // which entry is "current".
                    onPrimarySelect?.(e);
                    onContext?.(e, evt.clientX, evt.clientY);
                  }}
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: rowH,
                    transform: `translateY(${vi.start}px)`,
                    display: "flex",
                    alignItems: "center",
                    cursor: e.isDir ? "pointer" : "default",
                    bgcolor: isSel ? "action.selected" : "transparent",
                    // Hidden entries are rendered at half opacity when
                    // visible (`showHidden` is on) so the user can tell
                    // them apart from regular content at a glance.
                    // Drag-source dim wins over hidden-entry dim — 0.4
                    // is enough darker that "in flight" reads at a
                    // glance distinct from "hidden but visible".
                    opacity: draggingPaths.has(e.path)
                      ? 0.4
                      : e.isHidden
                        ? 0.55
                        : 1,
                    // Focus ring for keyboard users + drop-target
                    // ring while a drag is hovering. Inset so the row
                    // doesn't shift when either fires.
                    boxShadow:
                      vi.index === dragOverIdx
                        ? (theme) =>
                            `inset 0 0 0 2px ${theme.palette.success.main}`
                        : e.path === contextMenuPath
                          ? (theme) =>
                              // Cosmetic dashed outline showing which row
                              // the open context menu is acting on. Not
                              // tied to selection / focus — purely a hint.
                              `inset 0 0 0 1px ${theme.palette.text.secondary}`
                          : isFocused
                            ? (theme) =>
                                `inset 0 0 0 2px ${theme.palette.primary.main}`
                            : "none",
                    "&:hover": { bgcolor: isSel ? "action.selected" : "action.hover" },
                    // Disable native text selection on rows so the
                    // file name doesn't get highlighted while clicking
                    // / dragging. Files are list items, not paragraphs.
                    userSelect: "none",
                  }}
                >
                  <Box
                    sx={{
                      width: 36,
                      display: "flex",
                      justifyContent: "center",
                    }}
                  >
                    <Checkbox
                      size="small"
                      checked={isSel}
                      onChange={(evt) => {
                        evt.stopPropagation();
                        toggleSel(e.path, true);
                      }}
                      onClick={(evt) => evt.stopPropagation()}
                      slotProps={{
                        input: { "aria-label": `Select ${e.name}` },
                      }}
                      sx={{ p: 0.25 }}
                    />
                  </Box>
                  <Box
                    sx={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      minWidth: 0,
                      px: 1,
                    }}
                  >
                    <Box
                      onClick={(evt) => {
                        // Single-click on the icon opens the entry —
                        // saves a double-click for folder traversal.
                        // stopPropagation so the row's onClick (which
                        // toggles selection) doesn't also fire.
                        evt.stopPropagation();
                        onRowDouble(e);
                      }}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        cursor: "pointer",
                      }}
                      title="Click to open"
                    >
                      <IconForKind kind={resolveDisplayKind(e, customFileKinds) as typeof e.kind} />
                    </Box>
                    {renamingPath === e.path ? (
                      <Box sx={{ flex: 1 }}>
                        <RenameInput
                          entry={e}
                          draft={renameDraft}
                          onDraftChange={setRenameDraft}
                          onCommit={commitInlineRename}
                          onCancel={cancelInlineRename}
                        />
                      </Box>
                    ) : (
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{ flex: 1 }}
                        title={e.name}
                      >
                        {renderHighlighted(
                          displayName(e, showExtensions),
                          highlightQuery,
                        )}
                        {e.isSymlink ? " ↪" : ""}
                      </Typography>
                    )}
                    {fileTags[e.path] && (
                      <Box
                        component="span"
                        title={`Tag: ${fileTags[e.path]}`}
                        sx={{
                          display: "inline-block",
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          flexShrink: 0,
                          backgroundColor: tagColorHex(
                            fileTags[e.path] as TagColor,
                          ),
                        }}
                      />
                    )}
                  </Box>
                  {!hideColumns.size && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ width: 96, px: 1 }}
                      title={
                        e.isDir && folderSizes[e.path] != null
                          ? `Recursive size: ${formatBytes(folderSizes[e.path])}`
                          : undefined
                      }
                    >
                      {e.isDir
                        ? folderSizes[e.path] != null
                          ? formatBytes(folderSizes[e.path])
                          : "—"
                        : formatBytes(e.size)}
                    </Typography>
                  )}
                  {!hideColumns.modified && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ width: 180, px: 1 }}
                      noWrap
                      title={formatMtimeRelative(e.mtime)}
                    >
                      {formatMtimeAs(e.mtime, dateFormat)}
                    </Typography>
                  )}
                  {!hideColumns.kind && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ width: 120, px: 1 }}
                      noWrap
                    >
                      {e.kind}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}
