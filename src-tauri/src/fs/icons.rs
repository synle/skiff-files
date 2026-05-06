//! Maps a file path / extension to a [`FileKind`] for UI grouping + icon
//! selection. Pure function table; no IO. Add new mappings as needed.

use super::types::FileKind;
use std::path::Path;

/// Returns the coarse kind for a path. Folders / symlinks should be classified
/// by the caller (since this only sees the path, not metadata) — this fn only
/// answers for regular files based on extension.
pub fn kind_for_extension(ext: &str) -> FileKind {
    match ext.to_ascii_lowercase().as_str() {
        // text-ish
        "txt" | "log" | "csv" | "tsv" | "rtf" => FileKind::Text,
        "md" | "markdown" | "mdx" => FileKind::Markdown,

        // code
        "rs" | "go" | "py" | "js" | "jsx" | "ts" | "tsx" | "mjs" | "cjs" | "java" | "kt"
        | "swift" | "c" | "cc" | "cpp" | "h" | "hpp" | "cs" | "rb" | "php" | "sh" | "bash"
        | "zsh" | "fish" | "lua" | "pl" | "r" | "scala" | "clj" | "ex" | "exs" | "json"
        | "yaml" | "yml" | "toml" | "ini" | "cfg" | "conf" | "xml" | "html" | "htm" | "css"
        | "scss" | "less" | "sql" => FileKind::Code,

        // images
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tiff" | "tif" | "ico" | "svg"
        | "heic" | "heif" | "avif" => FileKind::Image,

        // audio
        "mp3" | "wav" | "flac" | "ogg" | "m4a" | "aac" | "wma" | "opus" | "aiff" => {
            FileKind::Audio
        }

        // video
        "mp4" | "mkv" | "mov" | "avi" | "webm" | "wmv" | "flv" | "m4v" | "mpeg" | "mpg" => {
            FileKind::Video
        }

        // archive
        "zip" | "tar" | "gz" | "tgz" | "bz2" | "xz" | "7z" | "rar" | "zst" | "lz4" => {
            FileKind::Archive
        }

        // documents
        "pdf" => FileKind::Pdf,
        "xls" | "xlsx" | "ods" | "numbers" => FileKind::Spreadsheet,
        "doc" | "docx" | "odt" | "pages" => FileKind::Document,

        _ => FileKind::Unknown,
    }
}

/// Convenience helper that pulls the extension off a path before delegating.
/// Returns [`FileKind::Unknown`] for paths with no extension.
pub fn kind_for_path(path: &Path) -> FileKind {
    match path.extension().and_then(|s| s.to_str()) {
        Some(ext) => kind_for_extension(ext),
        None => FileKind::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_lookup_is_case_insensitive() {
        assert_eq!(kind_for_extension("PNG"), FileKind::Image);
        assert_eq!(kind_for_extension("Md"), FileKind::Markdown);
        assert_eq!(kind_for_extension("rs"), FileKind::Code);
    }

    #[test]
    fn unknown_extension_falls_back() {
        assert_eq!(kind_for_extension("xyz123"), FileKind::Unknown);
    }

    #[test]
    fn path_helper_handles_no_extension() {
        assert_eq!(kind_for_path(Path::new("README")), FileKind::Unknown);
        assert_eq!(kind_for_path(Path::new("notes.md")), FileKind::Markdown);
    }
}
