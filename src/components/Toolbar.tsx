// Browser toolbar: navigation history (back/forward/up), refresh, new folder,
// view-mode toggle. Phase 1 keeps the action set minimal — drag-to-host etc.
// land in later phases once Hosts exist.
import {
  Box,
  IconButton,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Divider,
  TextField,
  InputAdornment,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import { type Ref } from "react";
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
    searchInputRef,
  } = props;

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
      <Tooltip title="Back">
        <span>
          <IconButton
            size="small"
            disabled={!canGoBack}
            onClick={onBack}
            aria-label="Back"
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Forward">
        <span>
          <IconButton
            size="small"
            disabled={!canGoForward}
            onClick={onForward}
            aria-label="Forward"
          >
            <ArrowForwardIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
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
          <RefreshIcon fontSize="small" />
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

      <TextField
        size="small"
        placeholder="Search…"
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
