// Virtualized file list. Renders only the visible rows via @tanstack/react-virtual,
// which keeps the DOM small (and scrolling smooth) at 100k entries — see the
// speed targets in TODO.md.
//
// Sort and selection are owned here because they're list-local concerns; the
// parent Browser owns navigation, refresh, and the underlying entries array.
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Box, Typography, Checkbox } from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Entry } from "../api/fs";
import IconForKind from "./IconForKind";
import { formatBytes, formatMtime } from "../util/format";
import type { Density } from "../state/settings";

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
  /** Fires whenever a row is clicked. The "primary" selection drives the
   *  preview pane; the FileList still tracks its own multi-select internally. */
  onPrimarySelect?: (entry: Entry | null) => void;
  density: Density;
  showExtensions: boolean;
}

/** Folders-on-top, then the requested sort within each group. */
function sortEntries(entries: Entry[], key: SortKey, dir: SortDir): Entry[] {
  const mul = dir === "asc" ? 1 : -1;
  const groups = { dirs: [] as Entry[], files: [] as Entry[] };
  for (const e of entries) {
    (e.isDir ? groups.dirs : groups.files).push(e);
  }
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
  groups.dirs.sort(cmp);
  groups.files.sort(cmp);
  return [...groups.dirs, ...groups.files];
}

/** Strip the extension if Settings says to hide them. Folders are unchanged. */
function displayName(e: Entry, showExtensions: boolean): string {
  if (e.isDir || showExtensions) return e.name;
  const dot = e.name.lastIndexOf(".");
  return dot > 0 ? e.name.slice(0, dot) : e.name;
}

/** Header cell with click-to-sort + indicator arrow. */
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
        fontWeight: 600,
        fontSize: "0.8125rem",
        color: "text.secondary",
        px: 1,
      }}
    >
      {label}
      {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
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
    onPrimarySelect,
    density,
    showExtensions,
  } = props;

  // Memoized so a re-render that doesn't change entries/sort doesn't re-sort.
  const sorted = useMemo(
    () => sortEntries(entries, sortKey, sortDir),
    [entries, sortKey, sortDir],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const parentRef = useRef<HTMLDivElement>(null);

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
    toggleSel(e.path, evt.metaKey || evt.ctrlKey);
    onPrimarySelect?.(e);
  };
  const onRowDouble = (e: Entry) => {
    if (e.isDir) onOpenDir(e);
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
              return (
                <Box
                  key={e.path}
                  role="row"
                  aria-selected={isSel}
                  data-testid="file-row"
                  onClick={(evt) => onRowClick(e, evt)}
                  onDoubleClick={() => onRowDouble(e)}
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
                      {displayName(e, showExtensions)}
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
