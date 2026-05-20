// Unified text/code/markdown preview body.
//
// One component handles every "this file is essentially text" case
// the preview surfaces touch: plain text, source code (Prism-
// highlighted), markdown (raw or rendered HTML), the unknown /
// binary fallback (read as lossy UTF-8 — better than hex for the
// 90% case where the file IS text but the kind classifier missed).
//
// Capabilities:
//   - Font-size zoom (toolbar buttons; persists for the lifetime of
//     the body).
//   - Copy-to-clipboard.
//   - Search bar (icon-toggled) with case sensitivity, exact-word,
//     contains, regex modes. Highlights matches in the source +
//     surfaces a "n of m" counter with prev / next navigation.
//   - Markdown render toggle (only present when the file kind is
//     markdown). Two icons next to Copy.
//   - Syntax highlighting via Prism for kinds we recognize. Auto-
//     disabled for files above HIGHLIGHT_BYTES so the parse + DOM
//     cost stays bounded.
//   - Virtualized line rendering when the file exceeds VIRTUAL_BYTES.
//     The earlier `<pre>{text}</pre>` approach renders fine up to a
//     few thousand lines; past that a tanstack-virtual list keeps
//     scroll smooth.
import {
  Box,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  type SelectChangeEvent,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import SearchIcon from "@mui/icons-material/Search";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import CloseIcon from "@mui/icons-material/Close";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import NotesIcon from "@mui/icons-material/Notes";
import ArticleIcon from "@mui/icons-material/Article";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { readText } from "../../api/client";
import type { Entry } from "../../api/fs";
import {
  escapeHtml,
  highlightSource,
  pickLanguage,
} from "../../util/syntaxHighlight";
import { renderMarkdown } from "../../util/markdown";

/** Threshold above which syntax highlighting is skipped — the Prism
 *  parse + DOM cost grows roughly linearly with byte count and
 *  starts to feel sluggish past ~128 KB on mid-range hardware. The
 *  backend already caps text reads at 256 KB so this is effectively
 *  a "highlight short files, plain-text long files" gate. */
const HIGHLIGHT_BYTES = 128 * 1024;

/** Threshold above which we switch from `<pre>{text}</pre>` rendering
 *  to a virtualized line list. Browsers handle a few thousand lines
 *  in a single `<pre>` block fine; past that, scroll jank shows up
 *  on the dark / light theme transition + on initial paint. 64 KB
 *  comfortably stays under that threshold for most files. */
const VIRTUAL_BYTES = 64 * 1024;

/** Match mode for the in-body search field. */
type MatchMode = "contains" | "exact" | "regex";

interface Props {
  entry: Entry;
  /** "inline" sizes for the right-hand pane (360 px max); "modal"
   *  sizes for the full PreviewModal (~75vh). */
  mode?: "inline" | "modal";
}

export default function TextBody({ entry, mode = "inline" }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Font-size zoom — discrete steps matching the legacy 0.2.315
  // toolbar. 12 px is the 100% anchor.
  const BASE_FONT_PX = 12;
  const FONT_MIN = 8;
  const FONT_MAX = 32;
  const FONT_STEP = 2;
  const [fontPx, setFontPx] = useState<number>(BASE_FONT_PX);

  // Copy-to-clipboard feedback.
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );

  // Markdown render toggle. Only meaningful when the file kind is
  // markdown; default to RENDERED so the user sees the formatted
  // output first, since that's the typical "open a .md to read it"
  // intent. The toggle switches to RAW source.
  const [renderMd, setRenderMd] = useState<boolean>(true);
  const isMarkdown = entry.kind === "markdown";

  // Search state. The search bar is hidden until the user clicks the
  // search icon; reveal flips `searchOpen`. Match mode + case sensitivity
  // live in their own state slots so changing one doesn't reset the
  // other.
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [matchMode, setMatchMode] = useState<MatchMode>("contains");
  const [caseSensitive, setCaseSensitive] = useState<boolean>(false);
  const [activeHit, setActiveHit] = useState<number>(0);

  // Refs used by the search-navigate buttons to scroll the highlighted
  // match into view. The non-virtualized branch uses contentRef directly;
  // the virtualized branch records per-line element refs lazily.
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    setCopyState("idle");
    // Reset search state on selection change so a stale query from
    // the previous file doesn't surface fake "0 matches" copy.
    setQuery("");
    setSearchOpen(false);
    setActiveHit(0);
    // Markdown toggle persists across files — most users want one
    // mode across the session. Only reset font zoom on first mount.
    readText(entry.path)
      .then((t) => !cancelled && setText(t))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [entry.path]);

  // ALL hooks must run on every render to satisfy React's rules of
  // hooks — keep them above the loading / error early returns. The
  // memo body short-circuits cheaply when text is still null.
  // Match positions — recomputed when query / mode / case toggle change.
  // Each hit is [start, end) in the raw text. Empty array means no
  // matches (also reflected in the counter label).
  const matches = useMemo(
    () => (text == null ? [] : computeMatches(text, query, matchMode, caseSensitive)),
    [text, query, matchMode, caseSensitive],
  );

  // Clamp active hit when the matches list shrinks (user typed past
  // the end of a query — `n of 0` is the right read but `activeHit`
  // would otherwise dangle).
  useEffect(() => {
    if (matches.length === 0) {
      if (activeHit !== 0) setActiveHit(0);
    } else if (activeHit >= matches.length) {
      setActiveHit(0);
    }
  }, [matches.length, activeHit]);

  if (error) {
    return (
      <Typography variant="caption" color="error">
        {error}
      </Typography>
    );
  }
  if (text == null) {
    return (
      <Typography variant="caption" color="text.secondary">
        Loading…
      </Typography>
    );
  }

  const byteSize = text.length; // chars ≈ bytes for ASCII; close enough for the gate.
  const language = isMarkdown && renderMd ? null : pickLanguage(entry.name);
  const tooLargeForHighlight = byteSize > HIGHLIGHT_BYTES;
  const tooLargeForInlinePre = byteSize > VIRTUAL_BYTES;

  const maxHeight = mode === "modal" ? "75vh" : 360;

  // Copy-to-clipboard. Centralized so both top-toolbar Copy and any
  // future right-click variant route through the same path.
  const onCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        setCopyState("error");
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1200);
    } catch {
      setCopyState("error");
    }
  };

  const goPrev = () => {
    if (matches.length === 0) return;
    setActiveHit((i) => (i - 1 + matches.length) % matches.length);
  };
  const goNext = () => {
    if (matches.length === 0) return;
    setActiveHit((i) => (i + 1) % matches.length);
  };

  return (
    <Box>
      {searchOpen && (
        <SearchBar
          query={query}
          setQuery={setQuery}
          matchMode={matchMode}
          setMatchMode={setMatchMode}
          caseSensitive={caseSensitive}
          setCaseSensitive={setCaseSensitive}
          matchCount={matches.length}
          activeHit={activeHit}
          onPrev={goPrev}
          onNext={goNext}
          onClose={() => {
            setSearchOpen(false);
            setQuery("");
          }}
        />
      )}
      <Box
        ref={contentRef}
        className="skiff-selectable"
        sx={{
          maxHeight,
          overflow: "auto",
          bgcolor: "action.hover",
          borderRadius: 1,
          fontSize: `${fontPx}px`,
        }}
      >
        {/* Markdown rendered HTML — short-circuit; the rendered body
            never benefits from highlighting (the renderer's <pre><code>
            blocks would need separate Prism passes which we leave for
            a future polish). */}
        {isMarkdown && renderMd ? (
          <Box
            className="skiff-markdown"
            sx={{ p: 1 }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
          />
        ) : tooLargeForInlinePre ? (
          <VirtualizedTextView
            text={text}
            fontPx={fontPx}
            maxHeight={maxHeight}
            matches={matches}
            activeHit={activeHit}
          />
        ) : (
          <InlineTextView
            text={text}
            language={tooLargeForHighlight ? null : language}
            matches={matches}
            activeHit={activeHit}
            fontPx={fontPx}
          />
        )}
      </Box>
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ mt: 0.5, flexWrap: "wrap", alignItems: "center" }}
      >
        <Tooltip
          title={
            copyState === "copied"
              ? "Copied to clipboard"
              : copyState === "error"
                ? "Clipboard unavailable — select text and copy manually"
                : "Copy file contents to clipboard"
          }
        >
          <span>
            <IconButton
              size="small"
              onClick={onCopy}
              aria-label="Copy file contents"
            >
              <ContentCopyIcon
                fontSize="small"
                color={
                  copyState === "copied"
                    ? "success"
                    : copyState === "error"
                      ? "error"
                      : undefined
                }
              />
            </IconButton>
          </span>
        </Tooltip>
        {isMarkdown && (
          <>
            <Tooltip title="View raw markdown source">
              <span>
                <IconButton
                  size="small"
                  onClick={() => setRenderMd(false)}
                  disabled={!renderMd}
                  aria-label="View raw markdown source"
                  aria-pressed={!renderMd}
                >
                  <NotesIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="View rendered markdown">
              <span>
                <IconButton
                  size="small"
                  onClick={() => setRenderMd(true)}
                  disabled={renderMd}
                  aria-label="View rendered markdown"
                  aria-pressed={renderMd}
                >
                  <ArticleIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
        <Tooltip
          title={searchOpen ? "Close search" : "Search in file"}
        >
          <span>
            <IconButton
              size="small"
              onClick={() => setSearchOpen((o) => !o)}
              aria-label={searchOpen ? "Close search" : "Search in file"}
              aria-pressed={searchOpen}
              color={searchOpen ? "primary" : "default"}
            >
              <SearchIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Zoom out (smaller text)">
          <span>
            <IconButton
              size="small"
              onClick={() => setFontPx((p) => Math.max(FONT_MIN, p - FONT_STEP))}
              disabled={fontPx <= FONT_MIN}
              aria-label="Zoom text out"
            >
              <ZoomOutIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Reset to default size (100%)">
          <span>
            <IconButton
              size="small"
              onClick={() => setFontPx(BASE_FONT_PX)}
              disabled={fontPx === BASE_FONT_PX}
              aria-label="Reset text zoom"
            >
              <RestartAltIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Zoom in (larger text)">
          <span>
            <IconButton
              size="small"
              onClick={() => setFontPx((p) => Math.min(FONT_MAX, p + FONT_STEP))}
              disabled={fontPx >= FONT_MAX}
              aria-label="Zoom text in"
            >
              <ZoomInIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Typography
          variant="caption"
          sx={{ minWidth: 36, textAlign: "right", color: "text.secondary" }}
          aria-live="polite"
        >
          {Math.round((fontPx / BASE_FONT_PX) * 100)}%
        </Typography>
      </Stack>
    </Box>
  );
}

/** Compute all [start, end) match positions for a given query.
 *  Returned positions are guaranteed non-overlapping and sorted
 *  ascending. Empty query / zero-length matches short-circuit so the
 *  caller can rely on `matches.length === 0` meaning "no UI work
 *  to do". */
export function computeMatches(
  text: string,
  query: string,
  mode: MatchMode,
  caseSensitive: boolean,
): Array<[number, number]> {
  if (query.length === 0) return [];
  if (mode === "regex") {
    let re: RegExp;
    try {
      re = new RegExp(query, caseSensitive ? "g" : "gi");
    } catch {
      return [];
    }
    // Defensive against zero-width matches (e.g. `^`, `(?=…)`) — a
    // global regex that doesn't consume input loops forever. Bump
    // lastIndex by 1 when the match is zero-width.
    const out: Array<[number, number]> = [];
    let guard = 0;
    while (guard < 100_000) {
      const m = re.exec(text);
      if (!m) break;
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      out.push([m.index, m.index + m[0].length]);
      guard += 1;
    }
    return out;
  }
  if (mode === "exact") {
    // Whole-word match — convert to a regex with word boundaries.
    const escaped = escapeRegex(query);
    const re = new RegExp(`\\b${escaped}\\b`, caseSensitive ? "g" : "gi");
    const out: Array<[number, number]> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) != null) {
      out.push([m.index, m.index + m[0].length]);
    }
    return out;
  }
  // contains — plain substring search.
  const needle = caseSensitive ? query : query.toLowerCase();
  const hay = caseSensitive ? text : text.toLowerCase();
  const out: Array<[number, number]> = [];
  let from = 0;
  while (from < hay.length) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    out.push([idx, idx + needle.length]);
    from = idx + needle.length;
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface SearchBarProps {
  query: string;
  setQuery: (q: string) => void;
  matchMode: MatchMode;
  setMatchMode: (m: MatchMode) => void;
  caseSensitive: boolean;
  setCaseSensitive: (c: boolean) => void;
  matchCount: number;
  activeHit: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

function SearchBar({
  query,
  setQuery,
  matchMode,
  setMatchMode,
  caseSensitive,
  setCaseSensitive,
  matchCount,
  activeHit,
  onPrev,
  onNext,
  onClose,
}: SearchBarProps) {
  const counterLabel =
    query.length === 0
      ? ""
      : matchCount === 0
        ? "0"
        : `${activeHit + 1} / ${matchCount}`;
  return (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{
        mb: 0.5,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <TextField
        size="small"
        autoFocus
        placeholder="Find in file"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        slotProps={{
          // MUI v9 routes ARIA + start/end adornments through
          // `slotProps.{htmlInput,input}` — the v8 `inputProps` /
          // `InputProps` flat shape was deprecated.
          htmlInput: { "aria-label": "Search text in preview" },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
        sx={{ flex: "1 1 200px", minWidth: 140 }}
      />
      <Select
        size="small"
        value={matchMode}
        onChange={(e: SelectChangeEvent<MatchMode>) =>
          setMatchMode(e.target.value as MatchMode)
        }
        inputProps={{ "aria-label": "Match mode" }}
        sx={{ minWidth: 110 }}
      >
        <MenuItem value="contains">Contains</MenuItem>
        <MenuItem value="exact">Exact word</MenuItem>
        <MenuItem value="regex">Regex</MenuItem>
      </Select>
      <Tooltip title={caseSensitive ? "Case sensitive" : "Case insensitive"}>
        <IconButton
          size="small"
          onClick={() => setCaseSensitive(!caseSensitive)}
          aria-pressed={caseSensitive}
          aria-label="Toggle case sensitivity"
          color={caseSensitive ? "primary" : "default"}
          sx={{
            border: 1,
            borderColor: caseSensitive ? "primary.main" : "divider",
            borderRadius: 1,
            fontSize: "0.7rem",
            fontWeight: 600,
            width: 28,
            height: 28,
          }}
        >
          Aa
        </IconButton>
      </Tooltip>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ minWidth: 56, textAlign: "right" }}
        aria-live="polite"
      >
        {counterLabel}
      </Typography>
      <Tooltip title="Previous match (Shift+Enter)">
        <span>
          <IconButton
            size="small"
            onClick={onPrev}
            disabled={matchCount === 0}
            aria-label="Previous match"
          >
            <KeyboardArrowUpIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Next match (Enter)">
        <span>
          <IconButton
            size="small"
            onClick={onNext}
            disabled={matchCount === 0}
            aria-label="Next match"
          >
            <KeyboardArrowDownIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Close search">
        <IconButton size="small" onClick={onClose} aria-label="Close search">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

interface InlineTextViewProps {
  text: string;
  language: string | null;
  matches: Array<[number, number]>;
  activeHit: number;
  fontPx: number;
}

/** Non-virtualized renderer. Used for files under VIRTUAL_BYTES — a
 *  single `<pre>` block keeps native text-selection across line
 *  boundaries (which the virtualized variant cannot match because
 *  each line is its own DOM node). */
function InlineTextView({
  text,
  language,
  matches,
  activeHit,
  fontPx,
}: InlineTextViewProps) {
  const html = useMemo(() => {
    const highlighted = highlightSource(text, language);
    if (matches.length === 0) return highlighted;
    return overlayMatches(text, highlighted, matches, activeHit);
  }, [text, language, matches, activeHit]);

  const activeRef = useRef<HTMLPreElement | null>(null);
  // Scroll active hit into view when it changes. The mark element
  // has a known className via overlayMatches; query just-in-time
  // after each paint.
  useEffect(() => {
    if (matches.length === 0) return;
    const el = activeRef.current?.querySelector(".skiff-search-hit-active");
    if (el && "scrollIntoView" in el) {
      (el as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  }, [activeHit, matches.length]);

  return (
    <Box
      component="pre"
      ref={activeRef}
      className={language ? `language-${language}` : undefined}
      sx={{
        m: 0,
        p: 1,
        fontSize: `${fontPx}px`,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        lineHeight: 1.5,
      }}
      // Highlighted output mixes Prism span markup with our own
      // `<mark>` search overlay. Both come from `escapeHtml` paths
      // upstream so the dangerous-set-inner-HTML is safe by
      // construction.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

interface VirtualizedTextViewProps {
  text: string;
  fontPx: number;
  maxHeight: number | string;
  matches: Array<[number, number]>;
  activeHit: number;
}

/** Virtualized renderer for large text. Splits on newlines, lets
 *  tanstack-virtual render only the visible window. Syntax
 *  highlighting is OFF in this branch (per the size gate); search
 *  overlay still works because we apply it per-line. */
function VirtualizedTextView({
  text,
  fontPx,
  maxHeight,
  matches,
  activeHit,
}: VirtualizedTextViewProps) {
  // Pre-compute line start offsets once so we can binary-search a
  // match position back to its line index when scrolling the active
  // hit into view. Splitting on `\n` keeps things simple — trailing
  // `\r` on Windows files lives on the previous line's tail and
  // renders fine inside a pre-wrap container.
  const lines = useMemo(() => text.split("\n"), [text]);
  const lineStarts = useMemo(() => {
    const starts: number[] = new Array(lines.length);
    let off = 0;
    for (let i = 0; i < lines.length; i++) {
      starts[i] = off;
      off += lines[i].length + 1; // +1 for the consumed `\n`.
    }
    return starts;
  }, [lines]);

  // Map each match to the line it belongs to. Lines may host
  // multiple matches (a regex `.` would do that); the inner overlay
  // logic deals with that case.
  const lineMatches = useMemo(() => {
    const out: Map<number, Array<[number, number, number]>> = new Map();
    for (let i = 0; i < matches.length; i++) {
      const [start, end] = matches[i];
      // Skip matches that span newlines — they'd need to render
      // across multiple line cells, which the inline overlay
      // approach can't do cleanly. Rare in practice (the user types
      // a query that crosses a line break) but worth handling.
      const lineIdx = lineIndexForOffset(lineStarts, start);
      if (lineIdx < 0) continue;
      const lineStart = lineStarts[lineIdx];
      const lineEnd = lineStart + lines[lineIdx].length;
      if (end > lineEnd) continue;
      const arr = out.get(lineIdx) ?? [];
      arr.push([start - lineStart, end - lineStart, i]);
      out.set(lineIdx, arr);
    }
    return out;
  }, [matches, lineStarts, lines]);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const rowH = Math.max(14, Math.round(fontPx * 1.5));
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 20,
  });

  // Scroll to the active hit's line when the index changes.
  useEffect(() => {
    if (matches.length === 0) return;
    const [start] = matches[activeHit];
    const lineIdx = lineIndexForOffset(lineStarts, start);
    if (lineIdx < 0) return;
    virtualizer.scrollToIndex(lineIdx, { align: "center" });
    // virtualizer is stable per scroll element
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHit, matches.length]);

  return (
    <Box
      ref={parentRef}
      sx={{
        maxHeight,
        height: maxHeight,
        overflow: "auto",
        fontSize: `${fontPx}px`,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        p: 1,
        lineHeight: 1.5,
      }}
    >
      <Box
        sx={{
          position: "relative",
          height: virtualizer.getTotalSize(),
          width: "100%",
        }}
      >
        {virtualizer.getVirtualItems().map((vi) => {
          const line = lines[vi.index];
          const hits = lineMatches.get(vi.index);
          const html =
            hits && hits.length > 0
              ? overlayMatchesInLine(line, hits, activeHit)
              : escapeHtml(line);
          return (
            <Box
              key={vi.key}
              data-line={vi.index}
              sx={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: vi.size,
                transform: `translateY(${vi.start}px)`,
                whiteSpace: "pre",
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        })}
      </Box>
    </Box>
  );
}

/** Overlay <mark> nodes onto already-highlighted HTML for the given
 *  match positions. We can't naively splice because the highlighted
 *  HTML's character positions don't line up with the source text's
 *  positions (every `<span>` Prism emits offsets the indices). The
 *  workaround: when there are matches, we drop the Prism wrapping
 *  and emit our own escaped+marked HTML using the source positions
 *  directly. Loses syntax colors while searching; gains correct
 *  match highlighting. Worth the tradeoff. */
function overlayMatches(
  text: string,
  _highlightedHtml: string,
  matches: Array<[number, number]>,
  activeHit: number,
): string {
  const parts: string[] = [];
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const [start, end] = matches[i];
    if (start > cursor) parts.push(escapeHtml(text.slice(cursor, start)));
    const cls =
      i === activeHit ? "skiff-search-hit skiff-search-hit-active" : "skiff-search-hit";
    parts.push(`<mark class="${cls}">${escapeHtml(text.slice(start, end))}</mark>`);
    cursor = end;
  }
  if (cursor < text.length) parts.push(escapeHtml(text.slice(cursor)));
  return parts.join("");
}

/** Per-line variant of `overlayMatches` for the virtualized branch.
 *  Hits are already translated to line-local offsets by the caller. */
function overlayMatchesInLine(
  line: string,
  hits: Array<[number, number, number]>,
  activeHit: number,
): string {
  const parts: string[] = [];
  let cursor = 0;
  // Hits are appended in match-list order; sort by start to be safe
  // against future caller changes.
  const sorted = [...hits].sort((a, b) => a[0] - b[0]);
  for (const [start, end, idx] of sorted) {
    if (start > cursor) parts.push(escapeHtml(line.slice(cursor, start)));
    const cls =
      idx === activeHit
        ? "skiff-search-hit skiff-search-hit-active"
        : "skiff-search-hit";
    parts.push(`<mark class="${cls}">${escapeHtml(line.slice(start, end))}</mark>`);
    cursor = end;
  }
  if (cursor < line.length) parts.push(escapeHtml(line.slice(cursor)));
  return parts.join("");
}

/** Binary-search line index for a character offset using the
 *  precomputed line-start offsets. Returns -1 when the offset is
 *  past end-of-text. */
function lineIndexForOffset(lineStarts: number[], offset: number): number {
  if (lineStarts.length === 0) return -1;
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const startMid = lineStarts[mid];
    const startNext =
      mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.MAX_SAFE_INTEGER;
    if (offset < startMid) hi = mid - 1;
    else if (offset >= startNext) lo = mid + 1;
    else return mid;
  }
  return -1;
}
