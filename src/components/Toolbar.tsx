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
import ViewListIcon from "@mui/icons-material/ViewList";
import ViewModuleIcon from "@mui/icons-material/ViewModule";
import ViewCarouselIcon from "@mui/icons-material/ViewCarousel";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import type { ViewMode } from "../state/settings";

interface Props {
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
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
}

/** Icon-only buttons with tooltips — keeps the toolbar dense. */
export default function Toolbar(props: Props) {
  const {
    canGoBack,
    canGoForward,
    canGoUp,
    onBack,
    onForward,
    onUp,
    onRefresh,
    onNewFolder,
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
  } = props;

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
      <Tooltip title="Up">
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
          }
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
          htmlInput: { "aria-label": "Search current folder" },
        }}
      />

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
