// Left sidebar — Phase 1 only ships Favorites + a Settings link. Hosts and
// Devices sections come online when the connection layer lands in Phase 2.
import {
  Box,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
} from "@mui/material";
import HomeIcon from "@mui/icons-material/Home";
import DescriptionIcon from "@mui/icons-material/Description";
import DesktopWindowsIcon from "@mui/icons-material/DesktopWindows";
import DownloadIcon from "@mui/icons-material/Download";
import SettingsIcon from "@mui/icons-material/Settings";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import HubIcon from "@mui/icons-material/Hub";
import CircleIcon from "@mui/icons-material/Circle";
import { Link as RouterLink } from "react-router";
import { useEffect, useState } from "react";
import { connList, type ConnectionInfo } from "../api/conn";

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

/** Simple list of favorite shortcuts + Connections + a Settings link. */
export default function Sidebar({ home, onNavigate }: Props) {
  // POSIX-style join is fine here — Tauri normalizes the slashes for us when
  // we hand the path to canonicalize / list_dir.
  const join = (rel: string) => (rel ? `${home}/${rel}` : home);

  // Live connections, refreshed on mount + when other code dispatches the
  // 'skiff:connections-changed' event (Connections page does that on
  // connect/disconnect). A poll loop would be wasted work given how rare
  // these state changes are.
  const [connections, setConnections] = useState<ConnectionInfo[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      connList()
        .then((c) => !cancelled && setConnections(c))
        .catch(() => !cancelled && setConnections([]));
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener("skiff:connections-changed", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("skiff:connections-changed", onChange);
    };
  }, []);

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
        {connections == null ? (
          <Box sx={{ px: 2, py: 0.5 }}>
            <CircularProgress size={14} />
          </Box>
        ) : connections.length === 0 ? (
          <List dense disablePadding>
            <ListItem disablePadding>
              <ListItemButton component={RouterLink} to="/connections">
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <HubIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary="Add connection…"
                  slotProps={{ primary: { variant: "body2" } }}
                />
              </ListItemButton>
            </ListItem>
          </List>
        ) : (
          <List dense disablePadding>
            {connections.map((c) => (
              <ListItem key={c.id} disablePadding>
                <ListItemButton
                  onClick={() =>
                    onNavigate(`sftp://${c.id}/`)
                  }
                  aria-label={`Browse ${c.label}`}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <Tooltip title="Connected">
                      <CircleIcon
                        sx={{ fontSize: 10, color: "success.main" }}
                      />
                    </Tooltip>
                  </ListItemIcon>
                  <ListItemText
                    primary={c.label}
                    slotProps={{
                      primary: { variant: "body2", noWrap: true },
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
            <ListItem disablePadding>
              <ListItemButton component={RouterLink} to="/connections">
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <HubIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary="Manage connections…"
                  slotProps={{ primary: { variant: "body2" } }}
                />
              </ListItemButton>
            </ListItem>
          </List>
        )}

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
          <ListItemButton component={RouterLink} to="/transfers">
            <ListItemIcon sx={{ minWidth: 32 }}>
              <SwapHorizIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Transfers" />
          </ListItemButton>
        </ListItem>
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
