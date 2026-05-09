// Browser toolbar: navigation history (back/forward/up), refresh, new folder,
// view-mode toggle. Phase 1 keeps the action set minimal — drag-to-host etc.
// land in later phases once Hosts exist.
import {
  Box,
  CircularProgress,
  IconButton,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Divider,
  TextField,
  InputAdornment,
  Menu,
  MenuItem,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import { useState, type Ref, type MouseEvent as ReactMouseEvent } from "react";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import RefreshIcon from "@mui/icons-material/Refresh";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import ViewListIcon from "@mui/icons-material/ViewList";
import ViewModuleIcon from "@mui/icons-material/ViewModule";
import ViewCarouselIcon from "@mui/icons-material/ViewCarousel";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import SortIcon from "@mui/icons-material/Sort";
import type { ViewMode } from "../state/settings";
import type { SortDir, SortKey } from "./FileList";

interface Props {
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  /** Tooltip hint for the Up button — the path it would navigate to.
   *  Optional; when omitted the tooltip just says "Up". */
  upTarget?: string;
  /** True while a list_dir is in flight. Swaps the refresh icon for a
   *  small spinner so the user has visible feedback that the click
   *  registered (relevant on slow remotes). */
  isRefreshing?: boolean;
  /** Back-history entries (most recent last). Right-clicking the back
   *  arrow opens a menu of these so users can jump multiple steps. */
  backHistory?: string[];
  /** Forward-history entries (next-most-recent first). */
  forwardHistory?: string[];
  /** Jump multiple steps in the indicated direction. The toolbar
   *  invokes this when the user picks an item from a history menu. */
  onHistoryJump?: (direction: "back" | "forward", steps: number) => void;
  onRefresh: () => void;
  onNewFolder: () => void;
  /** Optional — when set, the toolbar shows a "New file" button next
   *  to "New folder". Browser wires this to write an empty file
   *  via the existing fs / conn abstractions. */
  onNewFile?: () => void;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  /** Whether the right-side preview pane is currently visible. */
  previewOpen: boolean;
  onTogglePreview: () => void;
  /** Live search query — filters the current folder client-side. */
  search: string;
  onSearchChange: (v: string) => void;
  /** When true, the search runs recursively via `fs_find` instead of
   *  filtering the in-pane entries. The Browser owns the actual fetch;
   *  the toolbar just exposes the toggle. */
  searchRecursive: boolean;
  onSearchRecursiveChange: (v: boolean) => void;
  /** Ref for Cmd/Ctrl+F focus. The Browser owns the keybind so the
   *  toolbar doesn't need to know about route-level shortcuts. */
  searchInputRef?: Ref<HTMLInputElement>;
  /** Active sort key — drives the dropdown's selected state. */
  sortKey: SortKey;
  /** Active sort direction. Toggling the same key in the dropdown
   *  flips the direction; picking a new key resets to asc. */
  sortDir: SortDir;
  /** Apply a new sort. Browser persists per-folder + global default. */
  onSortChange: (key: SortKey) => void;
  /** Flip the current direction without changing the key — used by
   *  the standalone direction-toggle button next to the sort menu. */
  onSortDirToggle: () => void;
  /** Recently-used search queries — surfaces in the search input's
   *  HTML5 datalist so the user can recall a query without retyping.
   *  Most-recent first. Empty array hides the dropdown. */
  searchHistory?: string[];
  /** Called when the user "commits" a search (Enter or blur with a
   *  non-empty value). Browser uses this to push the query into
   *  Settings.searchHistory. Optional — when omitted, history is
   *  read-only. */
  onSearchCommit?: (query: string) => void;
}

/** Icon-only buttons with tooltips — keeps the toolbar dense. */
export default function Toolbar(props: Props) {
  const {
    canGoBack,
    canGoForward,
    canGoUp,
    upTarget,
    onBack,
    onForward,
    onUp,
    onRefresh,
    onNewFolder,
    onNewFile,
    view,
    onViewChange,
    previewOpen,
    onTogglePreview,
    search,
    onSearchChange,
    searchRecursive,
    onSearchRecursiveChange,
    searchInputRef,
    backHistory = [],
    forwardHistory = [],
    onHistoryJump,
    isRefreshing = false,
    sortKey,
    sortDir,
    onSortChange,
    onSortDirToggle,
    searchHistory = [],
    onSearchCommit,
  } = props;

  const [sortMenuAnchor, setSortMenuAnchor] = useState<HTMLElement | null>(
    null,
  );

  /** Display label for the active sort. Surfaces in the dropdown's
   *  tooltip so the current state is glanceable. */
  const sortLabel = (k: SortKey): string =>
    k === "name"
      ? "Name"
      : k === "size"
        ? "Size"
        : k === "mtime"
          ? "Modified"
          : k === "ctime"
            ? "Created"
            : "Kind";

  // Anchor for the history dropdowns. We share one state slot for both
  // arrows since only one menu is ever open at a time.
  const [historyMenu, setHistoryMenu] = useState<{
    el: HTMLElement;
    direction: "back" | "forward";
  } | null>(null);

  /** Last segment of a path — used as the menu label so the user
   *  doesn't see the full absolute path on every line. */
  const labelFor = (p: string): string => {
    const segs = p.split(/[\\/]/).filter(Boolean);
    return segs.at(-1) ?? p;
  };

  const openBackMenu = (e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault();
    if (backHistory.length > 0) {
      setHistoryMenu({ el: e.currentTarget, direction: "back" });
    }
  };
  const openForwardMenu = (e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault();
    if (forwardHistory.length > 0) {
      setHistoryMenu({ el: e.currentTarget, direction: "forward" });
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        px: 1,
        py: 0.5,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Tooltip title="Back (right-click for history)">
        <span>
          <IconButton
            size="small"
            disabled={!canGoBack}
            onClick={onBack}
            onContextMenu={openBackMenu}
            aria-label="Back"
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Forward (right-click for history)">
        <span>
          <IconButton
            size="small"
            disabled={!canGoForward}
            onClick={onForward}
            onContextMenu={openForwardMenu}
            aria-label="Forward"
          >
            <ArrowForwardIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={historyMenu?.el ?? null}
        open={historyMenu != null}
        onClose={() => setHistoryMenu(null)}
        slotProps={{ list: { dense: true } }}
      >
        {(historyMenu?.direction === "back"
          ? // Most recent first → reverse so the closest entry is at
            //the top of the menu (clicking it = one step back).
            [...backHistory].reverse()
          : forwardHistory
        ).map((p, idx) => (
          <MenuItem
            key={`${p}-${idx}`}
            onClick={() => {
              onHistoryJump?.(historyMenu!.direction, idx + 1);
              setHistoryMenu(null);
            }}
          >
            {labelFor(p)}
          </MenuItem>
        ))}
      </Menu>
      <Tooltip title={upTarget ? `Up to ${upTarget}` : "Up"}>
        <span>
          <IconButton
            size="small"
            disabled={!canGoUp}
            onClick={onUp}
            aria-label="Up"
          >
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

      <Tooltip title="Refresh">
        <IconButton size="small" onClick={onRefresh} aria-label="Refresh">
          {isRefreshing ? (
            // Match the static icon size so the layout doesn't shift
            // between states. The 16px spinner is roughly the same
            // visual weight as RefreshIcon at fontSize="small".
            <CircularProgress size={16} thickness={5} />
          ) : (
            <RefreshIcon fontSize="small" />
          )}
        </IconButton>
      </Tooltip>
      <Tooltip title="New folder">
        <IconButton
          size="small"
          onClick={onNewFolder}
          aria-label="New folder"
        >
          <CreateNewFolderIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {onNewFile && (
        <Tooltip title="New file">
          <IconButton size="small" onClick={onNewFile} aria-label="New file">
            <NoteAddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}

      <Box sx={{ flexGrow: 1 }} />

      <Tooltip
        title={
          searchRecursive
            ? "Searching subfolders (click to limit to current folder)"
            : "Click to search subfolders"
        }
      >
        <ToggleButton
          size="small"
          value="recursive"
          selected={searchRecursive}
          onChange={() => onSearchRecursiveChange(!searchRecursive)}
          aria-label="Toggle recursive search"
          aria-pressed={searchRecursive}
          sx={{ p: 0.5, mr: 0.5 }}
        >
          <SearchIcon fontSize="small" />
        </ToggleButton>
      </Tooltip>

      <TextField
        size="small"
        placeholder={searchRecursive ? "Find in subfolders…" : "Search…"}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            // Esc clears + blurs so the user can resume keyboard nav.
            onSearchChange("");
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Enter" && search.trim()) {
            // Push the committed query into history. Esc / clear are
            // intentionally NOT history events — only "I'm running
            // this search" qualifies.
            onSearchCommit?.(search.trim());
          }
        }}
        onBlur={() => {
          if (search.trim()) onSearchCommit?.(search.trim());
        }}
        inputRef={searchInputRef}
        sx={{ width: 200 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => onSearchChange("")}
                  aria-label="Clear search"
                  sx={{ p: 0.25 }}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : null,
          },
          htmlInput: {
            "aria-label": "Search current folder",
            // HTML5 datalist gives us a native suggestion dropdown for
            // free — no extra Menu wiring needed. Browser-native
            // appearance, OS-themed.
            list: searchHistory.length > 0 ? "skiff-search-history" : undefined,
          },
        }}
      />
      {searchHistory.length > 0 && (
        <datalist id="skiff-search-history">
          {searchHistory.map((q) => (
            <option key={q} value={q} />
          ))}
        </datalist>
      )}

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

      <Tooltip title={previewOpen ? "Hide preview" : "Show preview"}>
        <IconButton
          size="small"
          onClick={onTogglePreview}
          aria-label={previewOpen ? "Hide preview" : "Show preview"}
          aria-pressed={previewOpen}
        >
          {previewOpen ? (
            <VisibilityIcon fontSize="small" />
          ) : (
            <VisibilityOffIcon fontSize="small" />
          )}
        </IconButton>
      </Tooltip>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

      {/* Sort dropdown — primary affordance for changing sort in the
       *  grid views (tile / gallery / column), which have no column
       *  headers to click. List view keeps the column-header path so
       *  this is a redundant-but-discoverable alternative there. */}
      <Tooltip
        title={`Sort by ${sortLabel(sortKey)} (${sortDir === "asc" ? "↑" : "↓"})`}
      >
        <IconButton
          size="small"
          onClick={(e) => setSortMenuAnchor(e.currentTarget)}
          aria-label="Sort"
        >
          <SortIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        open={sortMenuAnchor != null}
        anchorEl={sortMenuAnchor}
        onClose={() => setSortMenuAnchor(null)}
        slotProps={{ list: { dense: true } }}
      >
        {(["name", "size", "mtime", "ctime", "kind"] as const).map((k) => {
          const active = k === sortKey;
          return (
            <MenuItem
              key={k}
              selected={active}
              onClick={() => {
                onSortChange(k);
                setSortMenuAnchor(null);
              }}
            >
              {sortLabel(k)}
              {active ? (sortDir === "asc" ? "  ↑" : "  ↓") : ""}
            </MenuItem>
          );
        })}
        <Divider />
        <MenuItem
          onClick={() => {
            onSortDirToggle();
            setSortMenuAnchor(null);
          }}
        >
          Reverse direction (currently {sortDir === "asc" ? "asc" : "desc"})
        </MenuItem>
      </Menu>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

      <ToggleButtonGroup
        size="small"
        exclusive
        value={view}
        onChange={(_, v: ViewMode | null) => v && onViewChange(v)}
        aria-label="View mode"
      >
        <ToggleButton value="list" aria-label="List view">
          <ViewListIcon fontSize="small" />
        </ToggleButton>
        <ToggleButton value="tile" aria-label="Tile view">
          <ViewModuleIcon fontSize="small" />
        </ToggleButton>
        <ToggleButton value="gallery" aria-label="Gallery view">
          <ViewCarouselIcon fontSize="small" />
        </ToggleButton>
        <ToggleButton value="column" aria-label="Column view">
          <ViewColumnIcon fontSize="small" />
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
}
