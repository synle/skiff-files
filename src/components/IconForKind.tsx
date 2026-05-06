// Map FileKind -> MUI icon. Keeping the lookup here means components don't
// import twelve icons each; they import one component and pass the kind.
import {
  Folder,
  InsertDriveFile,
  Image,
  Movie,
  MusicNote,
  Archive,
  PictureAsPdf,
  Code,
  TableChart,
  Article,
  Link as LinkIcon,
} from "@mui/icons-material";
import type { FileKind } from "../api/fs";

interface Props {
  kind: FileKind;
  fontSize?: "inherit" | "small" | "medium" | "large";
}

/** Tiny adapter — switch on kind, render the matching icon. */
export default function IconForKind({ kind, fontSize = "small" }: Props) {
  switch (kind) {
    case "folder":
      return <Folder fontSize={fontSize} color="primary" />;
    case "symlink":
      return <LinkIcon fontSize={fontSize} />;
    case "image":
      return <Image fontSize={fontSize} />;
    case "video":
      return <Movie fontSize={fontSize} />;
    case "audio":
      return <MusicNote fontSize={fontSize} />;
    case "archive":
      return <Archive fontSize={fontSize} />;
    case "pdf":
      return <PictureAsPdf fontSize={fontSize} />;
    case "code":
      return <Code fontSize={fontSize} />;
    case "spreadsheet":
      return <TableChart fontSize={fontSize} />;
    case "document":
    case "markdown":
    case "text":
      return <Article fontSize={fontSize} />;
    case "binary":
    case "unknown":
    default:
      return <InsertDriveFile fontSize={fontSize} />;
  }
}
