import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { HashRouter } from "react-router";
import App from "./App";

/**
 * Use HashRouter so deep links work under the `tauri://` protocol without
 * needing server-side route fallbacks (the file:// loader can't rewrite paths).
 */
const theme = createTheme({ palette: { mode: "light" } });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
