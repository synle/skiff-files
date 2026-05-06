import { AppBar, Toolbar, Typography, Button, Box } from "@mui/material";
import { Link as RouterLink, useLocation } from "react-router";

/** Top app bar with links to the Home and Settings pages. */
export default function NavBar() {
  const { pathname } = useLocation();
  return (
    <AppBar position="static" color="primary" elevation={1}>
      <Toolbar>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Skiff Files
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            component={RouterLink}
            to="/"
            color="inherit"
            variant={pathname === "/" ? "outlined" : "text"}
          >
            Home
          </Button>
          <Button
            component={RouterLink}
            to="/settings"
            color="inherit"
            variant={pathname === "/settings" ? "outlined" : "text"}
          >
            Settings
          </Button>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
