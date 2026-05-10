// Filter chip row that narrows the visible FileList by FileKind.
// Multiple chips = OR (matches any of the selected kinds). Empty
// selection = show all (no filter applied).
//
// Per-folder persistence isn't wired yet — Browser holds the active
// filter in component state. Future work: persist to Settings as
// folderKindFilter: Record<path, FileKindGroup[]> with LRU bound.
import { Box, Chip, IconButton, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { FileKind } from "../api/fs";
import type { TagColor } from "../state/settings";
import { TAG_COLORS, tagColorHex, tagColorLabel } from "../util/tagColors";

/** Display group → underlying FileKind set. Tighter than the raw
 *  FileKind because users think in everyday terms (Documents bundles
 *  text + markdown + pdf + …) not in the type-system enum. */
export const KIND_GROUPS: { id: KindGroup; label: string; kinds: FileKind[] }[] = [
  { id: "folder", label: "Folders", kinds: ["folder"] },
  { id: "image", label: "Images", kinds: ["image"] },
  { id: "code", label: "Code", kinds: ["code"] },
  {
    id: "document",
    label: "Documents",
    kinds: ["text", "markdown", "document", "pdf", "spreadsheet"],
  },
  { id: "archive", label: "Archives", kinds: ["archive"] },
  { id: "audio", label: "Audio", kinds: ["audio"] },
  { id: "video", label: "Video", kinds: ["video"] },
  { id: "other", label: "Other", kinds: ["binary", "unknown", "symlink"] },
];

export type KindGroup =
  | "folder"
  | "image"
  | "code"
  | "document"
  | "archive"
  | "audio"
  | "video"
  | "other";

interface Props {
  active: KindGroup[];
  onChange: (next: KindGroup[]) => void;
  /** Active tag colors. Empty array = no tag filter. */
  activeTags?: TagColor[];
  /** Setter for the tag filter. When omitted, the tag chip strip
   *  doesn't render. */
  onTagsChange?: (next: TagColor[]) => void;
  /** Temporal filter — restricts the listing to entries with mtime
   *  within the chosen recency window. `null` = no filter. */
  activeRecency?: RecencyGroup | null;
  onRecencyChange?: (next: RecencyGroup | null) => void;
  onClose?: () => void;
}

export type RecencyGroup = "today" | "week" | "month";

export const RECENCY_LABELS: Record<RecencyGroup, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
};

export default function KindFilterBar({
  active,
  onChange,
  activeTags = [],
  onTagsChange,
  activeRecency = null,
  onRecencyChange,
  onClose,
}: Props) {
  const toggle = (id: KindGroup) => {
    onChange(
      active.includes(id) ? active.filter((x) => x !== id) : [...active, id],
    );
  };
  const toggleTag = (c: TagColor) => {
    if (!onTagsChange) return;
    onTagsChange(
      activeTags.includes(c)
        ? activeTags.filter((x) => x !== c)
        : [...activeTags, c],
    );
  };
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        px: 2,
        py: 0.5,
        borderBottom: 1,
        borderColor: "divider",
        flexWrap: "wrap",
      }}
    >
      <Typography variant="caption" sx={{ color: "text.secondary", mr: 1 }}>
        Filter:
      </Typography>
      {KIND_GROUPS.map((g) => {
        const isActive = active.includes(g.id);
        return (
          <Chip
            key={g.id}
            label={g.label}
            size="small"
            color={isActive ? "primary" : "default"}
            variant={isActive ? "filled" : "outlined"}
            onClick={() => toggle(g.id)}
            sx={{ cursor: "pointer" }}
          />
        );
      })}
      {active.length > 0 && (
        <Chip
          label="Clear"
          size="small"
          variant="outlined"
          onClick={() => onChange([])}
          sx={{ ml: 1 }}
        />
      )}
      {onTagsChange && (
        <>
          <Box sx={{ width: 12 }} />
          <Typography variant="caption" sx={{ color: "text.secondary", mr: 0.5 }}>
            Tags:
          </Typography>
          {TAG_COLORS.map((c) => {
            const isActive = activeTags.includes(c);
            return (
              <Tooltip key={c} title={tagColorLabel(c)}>
                <Chip
                  size="small"
                  variant={isActive ? "filled" : "outlined"}
                  onClick={() => toggleTag(c)}
                  label=""
                  sx={{
                    cursor: "pointer",
                    width: 24,
                    "& .MuiChip-label": { display: "none" },
                    backgroundColor: isActive
                      ? tagColorHex(c)
                      : "transparent",
                    borderColor: tagColorHex(c),
                    "&::before": {
                      content: '""',
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      backgroundColor: tagColorHex(c),
                      ml: 0.75,
                    },
                  }}
                />
              </Tooltip>
            );
          })}
          {activeTags.length > 0 && (
            <Chip
              label="Clear tags"
              size="small"
              variant="outlined"
              onClick={() => onTagsChange([])}
              sx={{ ml: 0.5 }}
            />
          )}
        </>
      )}
      {onRecencyChange && (
        <>
          <Box sx={{ width: 12 }} />
          <Typography variant="caption" sx={{ color: "text.secondary", mr: 0.5 }}>
            Recency:
          </Typography>
          {(Object.keys(RECENCY_LABELS) as RecencyGroup[]).map((r) => {
            const isActive = activeRecency === r;
            return (
              <Chip
                key={r}
                label={RECENCY_LABELS[r]}
                size="small"
                color={isActive ? "primary" : "default"}
                variant={isActive ? "filled" : "outlined"}
                onClick={() => onRecencyChange(isActive ? null : r)}
                sx={{ cursor: "pointer" }}
              />
            );
          })}
        </>
      )}
      <Box sx={{ flex: 1 }} />
      {onClose && (
        <Tooltip title="Hide filter row">
          <IconButton size="small" onClick={onClose} aria-label="Hide filter row">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

/** Returns true when an entry's mtime is inside the recency window.
 *  `null` recency or missing mtime always returns true (no filter
 *  applied). Uses calendar boundaries (start-of-day / start-of-week
 *  / start-of-month) rather than rolling 24h/7d/30d so "today" means
 *  "since midnight" — matches user mental model. */
export function entryMatchesRecency(
  mtimeUnixSec: number | null | undefined,
  recency: RecencyGroup | null | undefined,
): boolean {
  if (!recency) return true;
  if (mtimeUnixSec == null) return false;
  const now = new Date();
  let cutoff: Date;
  if (recency === "today") {
    cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (recency === "week") {
    // Start-of-week = current day minus weekday offset (Sunday = 0).
    // Locale-week-start aware would be nicer; this keeps the helper
    // pure + dependency-free.
    const dow = now.getDay();
    cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  } else {
    cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return mtimeUnixSec * 1000 >= cutoff.getTime();
}

/** Returns true when an entry kind matches at least one active group.
 *  Empty `active` returns true for everything (no filter applied). */
export function entryMatchesFilter(
  kind: FileKind,
  active: KindGroup[],
): boolean {
  if (active.length === 0) return true;
  return active.some((id) => {
    const group = KIND_GROUPS.find((g) => g.id === id);
    return group ? group.kinds.includes(kind) : false;
  });
}
