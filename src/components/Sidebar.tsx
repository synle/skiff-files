// Left sidebar — Phase 1 only ships Favorites + a Settings link. Hosts and
// Devices sections come online when the connection layer lands in Phase 2.
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from "@mui/material";
import HomeIcon from "@mui/icons-material/Home";
import DescriptionIcon from "@mui/icons-material/Description";
import DesktopWindowsIcon from "@mui/icons-material/DesktopWindows";
import DownloadIcon from "@mui/icons-material/Download";
import SettingsIcon from "@mui/icons-material/Settings";
import { Link as RouterLink } from "react-router";

interface Favorite {
  label: string;
  /** Relative-from-home segment. The Browser resolves this against the actual
   *  home dir before navigating. */
  rel: string;
  icon: React.ReactNode;
}

const FAVORITES: Favorite[] = [
  { label: "Home", rel: "", icon: <HomeIcon fontSize="small" /> },
  { label: "Desktop", rel: "Desktop", icon: <DesktopWindowsIcon fontSize="small" /> },
  { label: "Documents", rel: "Documents", icon: <DescriptionIcon fontSize="small" /> },
  { label: "Downloads", rel: "Downloads", icon: <DownloadIcon fontSize="small" /> },
];

interface Props {
  /** Absolute home dir, resolved at app start. May be empty during the first
   *  paint — favorite buttons are disabled until it arrives. */
  home: string;
  onNavigate: (path: string) => void;
}

/** Simple list of favorite shortcuts + a Settings link at the bottom. */
export default function Sidebar({ home, onNavigate }: Props) {
  // POSIX-style join is fine here — Tauri normalizes the slashes for us when
  // we hand the path to canonicalize / list_dir.
  const join = (rel: string) => (rel ? `${home}/${rel}` : home);

  return (
    <Box
      component="nav"
      aria-label="Sidebar"
      sx={{
        width: 220,
        flexShrink: 0,
        borderRight: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
      }}
    >
      <Box sx={{ flex: 1, overflow: "auto" }}>
        <Typography
          variant="overline"
          sx={{ px: 2, pt: 1.5, color: "text.secondary" }}
        >
          Favorites
        </Typography>
        <List dense disablePadding>
          {FAVORITES.map((f) => (
            <ListItem key={f.label} disablePadding>
              <ListItemButton
                disabled={!home}
                onClick={() => onNavigate(join(f.rel))}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>{f.icon}</ListItemIcon>
                <ListItemText primary={f.label} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>

        <Typography
          variant="overline"
          sx={{ px: 2, pt: 1.5, color: "text.secondary", display: "block" }}
        >
          Hosts
        </Typography>
        <Typography variant="caption" sx={{ px: 2, color: "text.disabled" }}>
          (FTP / SFTP / SMB — Phase 2)
        </Typography>

        <Typography
          variant="overline"
          sx={{ px: 2, pt: 1.5, color: "text.secondary", display: "block" }}
        >
          Devices
        </Typography>
        <Typography variant="caption" sx={{ px: 2, color: "text.disabled" }}>
          (mounted volumes — Phase 5)
        </Typography>
      </Box>

      <List dense disablePadding sx={{ borderTop: 1, borderColor: "divider" }}>
        <ListItem disablePadding>
          <ListItemButton component={RouterLink} to="/settings">
            <ListItemIcon sx={{ minWidth: 32 }}>
              <SettingsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Settings" />
          </ListItemButton>
        </ListItem>
      </List>
    </Box>
  );
}
