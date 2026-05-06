import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { MemoryRouter } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import TransfersPage from "./TransfersPage";

const theme = createTheme();
const mocked = vi.mocked(invoke);

beforeEach(() => {
  mocked.mockClear();
});

function r() {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <TransfersPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe("TransfersPage", () => {
  it("renders the new-job form", () => {
    r();
    expect(screen.getByLabelText(/Source/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Destination/)).toBeInTheDocument();
    expect(screen.getByText("Start")).toBeInTheDocument();
  });

  it("disables Start until source + destination are filled", () => {
    r();
    const start = screen.getByText("Start");
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Source/), {
      target: { value: "/a" },
    });
    fireEvent.change(screen.getByLabelText(/Destination/), {
      target: { value: "/b" },
    });
    expect(start).not.toBeDisabled();
  });

  it("invokes sync_start_local with the form values", async () => {
    r();
    fireEvent.change(screen.getByLabelText(/Source/), {
      target: { value: "/src" },
    });
    fireEvent.change(screen.getByLabelText(/Destination/), {
      target: { value: "/dest" },
    });
    fireEvent.click(screen.getByText("Start"));
    await waitFor(() => {
      expect(mocked).toHaveBeenCalledWith(
        "sync_start_local",
        expect.objectContaining({
          src: "/src",
          dest: "/dest",
          options: expect.objectContaining({
            maxSizeGb: 1,
            conflictPolicy: "skip",
            dryRun: false,
          }),
        }),
      );
    });
  });

  it("shows the empty-state when there are no jobs", async () => {
    r();
    await waitFor(() => {
      expect(screen.getByText(/No jobs yet/i)).toBeInTheDocument();
    });
  });
});
