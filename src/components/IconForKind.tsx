// Map FileKind -> MUI icon. Keeping the lookup here means components don't
// import twelve icons each; they import one component and pass the kind.
// Per-icon imports — pulling from the barrel `"@mui/icons-material"` loads
// every icon and chokes CI runners with EMFILE. Always go via the deep path.
import Folder from "@mui/icons-material/Folder";
import InsertDriveFile from "@mui/icons-material/InsertDriveFile";
import Image from "@mui/icons-material/Image";
import Movie from "@mui/icons-material/Movie";
import MusicNote from "@mui/icons-material/MusicNote";
import Archive from "@mui/icons-material/Archive";
import PictureAsPdf from "@mui/icons-material/PictureAsPdf";
import Code from "@mui/icons-material/Code";
import TableChart from "@mui/icons-material/TableChart";
import Article from "@mui/icons-material/Article";
import LinkIcon from "@mui/icons-material/Link";
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
