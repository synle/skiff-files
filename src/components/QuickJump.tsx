// Cmd/Ctrl+K quick-jump palette. Lists bookmarks + recent paths +
// favorites, filterable by substring. Enter navigates to the
// highlighted entry; Esc closes; arrows move the highlight.
//
// Keeps to a fixed source of paths (no fs walk) so opening + filtering
// is instant even on slow disks. The recursive-find affordance in the
// toolbar covers the broader "find a folder I've never visited" need.
import {
  Box,
  Dialog,
  DialogContent,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "../state/settings";

interface Props {
  open: boolean;
  onClose: () => void;
  onJump: (path: string) => void;
  /** Resolved home directory — supplies the same favorite shortcuts the
   *  Sidebar shows so the palette is a self-contained launcher. */
  home: string;
}

interface Item {
  path: string;
  label: string;
  category: "Bookmark" | "Recent" | "Favorite";
}

/** Compose the source list. Bookmarks first (deliberate user picks),
 *  then recent (auto-tracked), then favorites (home / Desktop /
 *  Documents / Downloads). Dedup by path so a bookmark that's also in
 *  recent doesn't appear twice. */
function buildItems(
  bookmarks: { label: string; path: string }[],
  recent: string[],
  home: string,
): Item[] {
  const out: Item[] = [];
  const seen = new Set<string>();
  const push = (item: Item) => {
    if (!seen.has(item.path)) {
      seen.add(item.path);
      out.push(item);
    }
  };
  for (const b of bookmarks) push({ ...b, category: "Bookmark" });
  for (const p of recent) {
    const segs = p.split(/[\\/]/).filter(Boolean);
    push({
      path: p,
      label: segs.at(-1) ?? p,
      category: "Recent",
    });
  }
  if (home) {
    for (const f of [
      { label: "Home", rel: "" },
      { label: "Desktop", rel: "Desktop" },
      { label: "Documents", rel: "Documents" },
      { label: "Downloads", rel: "Downloads" },
    ]) {
      push({
        path: f.rel ? `${home}/${f.rel}` : home,
        label: f.label,
        category: "Favorite",
      });
    }
  }
  return out;
}

export default function QuickJump({ open, onClose, onJump, home }: Props) {
  const { settings } = useSettings();
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Reset query + highlight every time the palette re-opens. A stale
  // query would leak between sessions.
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightIdx(0);
    }
  }, [open]);

  const items = useMemo(
    () => buildItems(settings.bookmarks, settings.recentPaths, home),
    [settings.bookmarks, settings.recentPaths, home],
  );

  /** Substring match on label OR path, case-insensitive. */
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) || i.path.toLowerCase().includes(q),
    );
  }, [items, query]);

  // Keep the highlight in bounds as the filter shrinks the list.
  useEffect(() => {
    if (highlightIdx >= filtered.length) setHighlightIdx(0);
  }, [filtered.length, highlightIdx]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      // Anchor the dialog higher than the default centered position so
      // the palette feels more like a command bar (Spotlight / Raycast)
      // than a confirm dialog.
      sx={{ "& .MuiDialog-container": { alignItems: "flex-start", pt: "20vh" } }}
      aria-label="Quick jump"
    >
      <DialogContent sx={{ p: 1.5 }}>
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder="Jump to bookmark or recent path…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          inputRef={inputRef}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightIdx((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const target = filtered[highlightIdx];
              if (target) {
                onJump(target.path);
                onClose();
              }
            }
          }}
          slotProps={{ htmlInput: { "aria-label": "Quick jump query" } }}
        />
        <Box sx={{ mt: 1, maxHeight: "50vh", overflow: "auto" }} ref={listRef}>
          {filtered.length === 0 ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", textAlign: "center", py: 2 }}
            >
              No matches.
            </Typography>
          ) : (
            <List dense disablePadding>
              {filtered.map((item, idx) => (
                <ListItemButton
                  key={item.path + "::" + item.category}
                  selected={idx === highlightIdx}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  onClick={() => {
                    onJump(item.path);
                    onClose();
                  }}
                >
                  <ListItemText
                    primary={item.label}
                    secondary={item.path}
                    slotProps={{
                      primary: { variant: "body2", noWrap: true },
                      secondary: { variant: "caption", noWrap: true },
                    }}
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ ml: 1, flexShrink: 0 }}
                  >
                    {item.category}
                  </Typography>
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
