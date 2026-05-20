// Lightweight syntax highlighting bridge over Prism.
//
// We pull Prism Core and explicitly load the languages we care about
// rather than relying on `prismjs/components/index` autoload — the
// autoload variant uses XHR fetches at runtime, which doesn't work in
// the Tauri webview's `tauri://localhost` scheme. Loading languages
// at module init means everything lives in one bundle.
//
// Tradeoff: bundle size grows by ~30 KB total for the languages
// below. That's fine for a desktop app; the alternative is shipping
// no highlighting at all on remote/large files.
//
// To add a language: import its Prism component below and add an
// extension → Prism-id mapping in `pickLanguage`. Don't import
// `prismjs/themes/*` here — themes are CSS, applied globally via
// `index.css` so dark/light modes can be styled independently.
import Prism from "prismjs";

// Languages explicitly bundled. Order doesn't matter except that any
// language depending on another must come after its dependency
// (Prism's loader is ordered). The set covers what the user
// requested: js/ts/python/cpp/java/xml/yaml + the obvious other
// common kinds users will run into in a file explorer.
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-python";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-java";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-php";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-shell-session";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-markup"; // xml / html / svg
import "prismjs/components/prism-css";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-ini";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-makefile";
import "prismjs/components/prism-lua";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-r";
import "prismjs/components/prism-scala";
import "prismjs/components/prism-perl";
import "prismjs/components/prism-graphql";
import "prismjs/components/prism-protobuf";
import "prismjs/components/prism-nginx";

// Extension → Prism language id. Maps onto Prism's grammar registry.
// Lowercased extensions only — the picker does its own toLowerCase.
const EXT_TO_LANG: Record<string, string> = {
  // JS / TS family
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  // Python
  py: "python",
  pyw: "python",
  pyi: "python",
  // C family
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  // JVM family
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  sc: "scala",
  groovy: "java", // close enough — Prism has no groovy grammar
  // .NET
  cs: "csharp",
  csx: "csharp",
  // Go / Rust / Ruby / PHP / Lua / Perl / R / Swift
  go: "go",
  rs: "rust",
  rb: "ruby",
  rake: "ruby",
  php: "php",
  phtml: "php",
  lua: "lua",
  pl: "perl",
  pm: "perl",
  r: "r",
  swift: "swift",
  // Shell / config
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ksh: "bash",
  fish: "bash",
  ps1: "powershell",
  psm1: "powershell",
  bat: "powershell",
  cmd: "powershell",
  // Data / config
  json: "json",
  json5: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  // Markup
  xml: "markup",
  html: "markup",
  htm: "markup",
  svg: "markup",
  xsl: "markup",
  xsd: "markup",
  rss: "markup",
  atom: "markup",
  plist: "markup",
  // Web stylesheets
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "css",
  // Docs / diff / build
  md: "markdown",
  markdown: "markdown",
  diff: "diff",
  patch: "diff",
  dockerfile: "docker",
  makefile: "makefile",
  mk: "makefile",
  // SQL
  sql: "sql",
  // API schemas
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  // Servers
  nginx: "nginx",
  conf_nginx: "nginx",
};

/** Pick a Prism language id from a filename (case-insensitive
 *  extension lookup). Returns `null` if we don't have a grammar for
 *  this extension — the caller should render plain text in that
 *  case rather than passing the file through Prism with a missing
 *  grammar (Prism falls back to no-op but the wrapper still adds
 *  `language-undefined` which confuses CSS selectors). */
export function pickLanguage(filename: string): string | null {
  const lower = filename.toLowerCase();
  // Dockerfile / Makefile etc. are extension-less but match by basename.
  const base = lower.split(/[/\\]/).pop() ?? lower;
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "docker";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  if (base === ".gitignore" || base === ".dockerignore") return "ini";
  // Some shell config files have no extension by convention.
  if (
    base === ".bashrc" ||
    base === ".bash_profile" ||
    base === ".zshrc" ||
    base === ".profile" ||
    base === ".bashrc.local"
  ) {
    return "bash";
  }
  const dot = base.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = base.slice(dot + 1);
  return EXT_TO_LANG[ext] ?? null;
}

/** Highlight a string of source. Returns an HTML string with Prism's
 *  span markup applied. The caller is responsible for sticking the
 *  result inside an element with `className="language-<lang>"` (or
 *  `language-none` for plain text) — Prism's themes key off of that.
 *
 *  If `language` is null or not registered, returns an
 *  HTML-escaped passthrough so the consumer can always
 *  `dangerouslySetInnerHTML` the result without re-escaping. */
export function highlightSource(text: string, language: string | null): string {
  if (!language) return escapeHtml(text);
  const grammar = Prism.languages[language];
  if (!grammar) return escapeHtml(text);
  try {
    return Prism.highlight(text, grammar, language);
  } catch {
    return escapeHtml(text);
  }
}

/** Minimal HTML-escape so that plain-text fallbacks can flow through
 *  `dangerouslySetInnerHTML` the same way highlighted output does.
 *  Centralized here to keep the entity table in one place. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
