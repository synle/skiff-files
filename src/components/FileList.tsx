// Virtualized file list. Renders only the visible rows via @tanstack/react-virtual,
// which keeps the DOM small (and scrolling smooth) at 100k entries — see the
// speed targets in TODO.md.
//
// Sort and selection are owned here because they're list-local concerns; the
// parent Browser owns navigation, refresh, and the underlying entries array.
import {
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
import { formatBytes, formatMtime, formatMtimeRelative } from "../util/format";
import { setFileClipboard } from "../util/fileClipboard";
import type { Density, ShowExtensions, ViewMode } from "../state/settings";

export type SortKey = "name" | "size" | "mtime" | "ctime" | "kind";
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
  /** Visual layout. `list` is the virtualized list (default); other
   *  modes render a non-virtualized grid of cards (tile = small
   *  icons, gallery = larger icons / thumbs, column = wide rows).
   *  Performance budget for non-list views: ~5k entries before
   *  scroll feel degrades — large folders should stay on list. */
  view?: ViewMode;
}

/** Sort entries either with folders-first (Finder default) or fully
 *  intermixed depending on `groupFoldersFirst`. */
function sortEntries(
  entries: Entry[],
  key: SortKey,
  dir: SortDir,
  groupFoldersFirst: boolean,
): Entry[] {
  const mul = dir === "asc" ? 1 : -1;
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
          // container's whitespace (NOT on a cell). Cell clicks go
          // through the normal selection path.
          if (evt.button !== 0) return;
          const target = evt.target as HTMLElement;
          if (target.closest('[data-testid="file-grid-cell"]')) return;
          const { x, y } = localCoords(evt.clientX, evt.clientY);
          dragRef.current = {
            startX: x,
            startY: y,
            additive: evt.metaKey || evt.ctrlKey || evt.shiftKey,
          };
          setDragRect({ left: x, top: y, width: 0, height: 0 });
        }}
        onMouseMove={(evt) => {
          if (!dragRef.current) return;
          const { x, y } = localCoords(evt.clientX, evt.clientY);
          const left = Math.min(dragRef.current.startX, x);
          const top = Math.min(dragRef.current.startY, y);
          const width = Math.abs(x - dragRef.current.startX);
          const height = Math.abs(y - dragRef.current.startY);
          setDragRect({ left, top, width, height });
        }}
        onMouseUp={(evt) => {
          if (!dragRef.current) return;
          const { x, y } = localCoords(evt.clientX, evt.clientY);
          const left = Math.min(dragRef.current.startX, x);
          const top = Math.min(dragRef.current.startY, y);
          const right = Math.max(dragRef.current.startX, x);
          const bottom = Math.max(dragRef.current.startY, y);
          // Tiny drags (< 4px in either dimension) are clicks; treat
          // as "clear selection" rather than a select-nothing rubber-
          // band. Matches Finder's "click on empty space" behavior.
          const isClick = right - left < 4 && bottom - top < 4;
          if (isClick) {
            if (!dragRef.current.additive) {
              onRubberBand?.(new Set(), false);
            }
          } else {
            // Hit-test every cell against the drag rect.
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
            onRubberBand?.(hit, dragRef.current.additive);
          }
          dragRef.current = null;
          setDragRect(null);
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
                          const payload =
                            selected.size > 0 && selected.has(e.path)
                              ? Array.from(selected).join("\n")
                              : e.path;
                          evt.dataTransfer.setData(
                            "application/x-skiff-paths",
                            payload,
                          );
                          evt.dataTransfer.effectAllowed = "copy";
                        }}
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
                          opacity: e.isHidden ? 0.55 : 1,
                          "&:hover": {
                            bgcolor: isSel ? "action.selected" : "action.hover",
                          },
                          textAlign:
                            view === "column"
                              ? ("left" as const)
                              : ("center" as const),
                          overflow: "hidden",
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
                              <IconForKind kind={e.kind} />
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
                              {e.mtime ? ` · ${formatMtime(e.mtime)}` : ""}
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
    view = "list",
  } = props;

  // Memoized so a re-render that doesn't change entries/sort doesn't re-sort.
  const sorted = useMemo(
    () => sortEntries(entries, sortKey, sortDir, groupFoldersFirst),
    [entries, sortKey, sortDir, groupFoldersFirst],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Keyboard-focused row index. Drives the highlighted row visual
   *  + the scroll-into-view + the Enter/Backspace targets. -1 = no
   *  row focused (e.g. an empty folder). */
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
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

  // Reset selection + focus when the entries array identity changes —
  // typically after a navigation. Sticking to a stale path in the
  // previous folder would surface a wrong size in the StatusBar.
  useEffect(() => {
    setSelected(new Set());
    setFocusedIdx(entries.length > 0 ? 0 : -1);
  }, [entries]);

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
      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          setFocusedIdx((i) =>
            Math.min(sorted.length - 1, Math.max(0, i) + stepDown),
          );
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          setFocusedIdx((i) => Math.max(0, (i < 0 ? 0 : i) - stepDown));
          break;
        }
        case "ArrowRight": {
          if (view === "list") return;
          if (cmd) return; // Browser owns Cmd+→ for forward nav.
          e.preventDefault();
          setFocusedIdx((i) =>
            Math.min(sorted.length - 1, Math.max(0, i) + 1),
          );
          break;
        }
        case "ArrowLeft": {
          if (view === "list") return;
          if (cmd) return; // Browser owns Cmd+← for back nav.
          e.preventDefault();
          setFocusedIdx((i) => Math.max(0, (i < 0 ? 0 : i) - 1));
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
        onRowClick={onRowClick}
        onRowMouseDown={onRowMouseDown}
        onRowDouble={onRowDouble}
        onContext={onContext}
        onPrimarySelect={onPrimarySelect}
        onContextEmpty={onContextEmpty}
        onColsChange={setGridCols}
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
        <HeaderCell
          label="Size"
          active={sortKey === "size"}
          dir={sortDir}
          onClick={() => onSortChange("size")}
          width={96}
        />
        <HeaderCell
          label="Modified"
          active={sortKey === "mtime"}
          dir={sortDir}
          onClick={() => onSortChange("mtime")}
          width={180}
        />
        <HeaderCell
          label="Kind"
          active={sortKey === "kind"}
          dir={sortDir}
          onClick={() => onSortChange("kind")}
          width={120}
        />
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
                  data-testid="file-row"
                  draggable
                  onDragStart={(evt) => {
                    // Drag payload: newline-joined paths from the
                    // multi-selection (or just this row when nothing
                    // is multi-selected). Sidebar host items consume
                    // this to start a Skiffsync.
                    const payload =
                      selected.size > 0 && selected.has(e.path)
                        ? Array.from(selected).join("\n")
                        : e.path;
                    evt.dataTransfer.setData(
                      "application/x-skiff-paths",
                      payload,
                    );
                    evt.dataTransfer.effectAllowed = "copy";
                  }}
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
                    opacity: e.isHidden ? 0.55 : 1,
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
                      <IconForKind kind={e.kind} />
                    </Box>
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
                  </Box>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ width: 96, px: 1 }}
                  >
                    {e.isDir ? "—" : formatBytes(e.size)}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ width: 180, px: 1 }}
                    noWrap
                    title={formatMtimeRelative(e.mtime)}
                  >
                    {formatMtime(e.mtime)}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ width: 120, px: 1 }}
                    noWrap
                  >
                    {e.kind}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}
