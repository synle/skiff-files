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
  onClose?: () => void;
}

export default function KindFilterBar({ active, onChange, onClose }: Props) {
  const toggle = (id: KindGroup) => {
    onChange(
      active.includes(id) ? active.filter((x) => x !== id) : [...active, id],
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
