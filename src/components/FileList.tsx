// Virtualized file list. Renders only the visible rows via @tanstack/react-virtual,
// which keeps the DOM small (and scrolling smooth) at 100k entries — see the
// speed targets in TODO.md.
//
// Sort and selection are owned here because they're list-local concerns; the
// parent Browser owns navigation, refresh, and the underlying entries array.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Box, Typography, Checkbox } from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Entry } from "../api/fs";
import IconForKind from "./IconForKind";
import { formatBytes, formatMtime, formatMtimeRelative } from "../util/format";
import { setFileClipboard } from "../util/fileClipboard";
import type { Density, ShowExtensions } from "../state/settings";

export type SortKey = "name" | "size" | "mtime" | "kind";
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
      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          setFocusedIdx((i) => Math.min(sorted.length - 1, Math.max(0, i) + 1));
          break;
        }
        case "ArrowUp": {
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
          // sensible page size — 12 rows comfortable, 16 compact —
          // matches what the user perceives as "one page".
          e.preventDefault();
          const page = density === "compact" ? 16 : 12;
          setFocusedIdx((i) =>
            Math.min(sorted.length - 1, Math.max(0, i) + page),
          );
          break;
        }
        case "PageUp": {
          e.preventDefault();
          const page = density === "compact" ? 16 : 12;
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
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `toggleSel` and `onOpenDir` are stable identifiers from the
    // parent in practice; the dep list intentionally captures only
    // the values we read inside the handler that change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, sorted, focusedIdx, selected, onOpenDir]);

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
                    // Focus ring for keyboard users. Inset so the row
                    // doesn't shift when the focus moves.
                    boxShadow: isFocused
                      ? (theme) => `inset 0 0 0 2px ${theme.palette.primary.main}`
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
                    <IconForKind kind={e.kind} />
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
