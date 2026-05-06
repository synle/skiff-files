import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import App from "./App";
import { ThemeProvider, createTheme } from "@mui/material";

const theme = createTheme();

/** Smoke test: verifies App renders with both navigation links. */
describe("App", () => {
  it("renders the nav bar with Home and Settings links", () => {
    render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );
    expect(screen.getByText("Skiff Files")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /home/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });

  it("renders the Settings page when navigated to /settings", () => {
    render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={["/settings"]}>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });
});
