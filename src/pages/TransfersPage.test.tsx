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
  localStorage.clear();
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
    expect(screen.getByLabelText(/^Source$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Destination$/)).toBeInTheDocument();
    expect(screen.getByText("Start")).toBeInTheDocument();
  });

  it("disables Start until source + destination are filled", () => {
    r();
    const start = screen.getByText("Start");
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Source$/), {
      target: { value: "/a" },
    });
    fireEvent.change(screen.getByLabelText(/^Destination$/), {
      target: { value: "/b" },
    });
    expect(start).not.toBeDisabled();
  });

  it("invokes sync_start_local with the form values", async () => {
    r();
    fireEvent.change(screen.getByLabelText(/^Source$/), {
      target: { value: "/src" },
    });
    fireEvent.change(screen.getByLabelText(/^Destination$/), {
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

  it("invokes sync_cpstamp when Stamp + copy is clicked", async () => {
    r();
    fireEvent.change(screen.getByLabelText(/Source file/), {
      target: { value: "/zshrc" },
    });
    fireEvent.change(screen.getByLabelText(/Destination folder/), {
      target: { value: "/backup" },
    });
    fireEvent.click(screen.getByText("Stamp + copy"));
    await waitFor(() => {
      expect(mocked).toHaveBeenCalledWith("sync_cpstamp", {
        src: "/zshrc",
        destDir: "/backup",
      });
    });
    expect(
      await screen.findByText(/Wrote/, { exact: false }),
    ).toBeInTheDocument();
  });

  it("invokes sync_dedup when Find + move duplicates is clicked", async () => {
    r();
    fireEvent.change(screen.getByLabelText(/Folder/), {
      target: { value: "/downloads" },
    });
    fireEvent.click(screen.getByText("Find + move duplicates"));
    await waitFor(() => {
      expect(mocked).toHaveBeenCalledWith("sync_dedup", { path: "/downloads" });
    });
    expect(
      await screen.findByText(/Scanned 5 files/, { exact: false }),
    ).toBeInTheDocument();
  });

  it("Save as template persists a saved job", async () => {
    r();
    fireEvent.change(screen.getByLabelText(/^Source$/), {
      target: { value: "/a" },
    });
    fireEvent.change(screen.getByLabelText(/^Destination$/), {
      target: { value: "/b" },
    });
    fireEvent.click(screen.getByText("Save as template"));
    await waitFor(() => {
      expect(screen.getByText("Saved templates")).toBeInTheDocument();
      expect(screen.getByText("/a → /b")).toBeInTheDocument();
    });
    const stored = JSON.parse(
      localStorage.getItem("skiff-files.savedJobs.v1") ?? "[]",
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ src: "/a", dest: "/b" });
  });

  it("clicking Run on a saved job invokes sync_start_local", async () => {
    // Pre-populate localStorage with a saved job so the section renders.
    localStorage.setItem(
      "skiff-files.savedJobs.v1",
      JSON.stringify([
        {
          id: "x",
          label: "/foo → /bar",
          planner: "local",
          src: "/foo",
          dest: "/bar",
          maxSizeGb: 1,
          lookbackDays: 7,
          conflictPolicy: "skip",
        },
      ]),
    );
    r();
    fireEvent.click(screen.getByLabelText("Run /foo → /bar"));
    await waitFor(() => {
      expect(mocked).toHaveBeenCalledWith(
        "sync_start_local",
        expect.objectContaining({ src: "/foo", dest: "/bar" }),
      );
    });
  });

  it("renders Pause + Cancel buttons for an in-flight job and Pause invokes sync_pause", async () => {
    r();
    // Drive a fake job into the running state via the form.
    fireEvent.change(screen.getByLabelText(/^Source$/), {
      target: { value: "/src" },
    });
    fireEvent.change(screen.getByLabelText(/^Destination$/), {
      target: { value: "/dest" },
    });
    fireEvent.click(screen.getByText("Start"));
    await waitFor(() => {
      expect(
        screen.getByLabelText("Pause job test-job-id"),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("Pause job test-job-id"));
    await waitFor(() => {
      expect(mocked).toHaveBeenCalledWith("sync_pause", { id: "test-job-id" });
    });
    // After pause the row should now expose a Resume button.
    await waitFor(() => {
      expect(
        screen.getByLabelText("Resume job test-job-id"),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("Resume job test-job-id"));
    await waitFor(() => {
      expect(mocked).toHaveBeenCalledWith("sync_resume", {
        id: "test-job-id",
      });
    });
  });

  it("routes to sync_start_repo when planner is set to Repo copy", async () => {
    r();
    // Open the mode select.
    fireEvent.mouseDown(screen.getByLabelText("Mode"));
    fireEvent.click(screen.getByRole("option", { name: /Repo copy/i }));
    fireEvent.change(screen.getByLabelText(/^Source$/), {
      target: { value: "/repo" },
    });
    fireEvent.change(screen.getByLabelText(/^Destination$/), {
      target: { value: "/backup" },
    });
    fireEvent.click(screen.getByText("Start"));
    await waitFor(() => {
      expect(mocked).toHaveBeenCalledWith(
        "sync_start_repo",
        expect.objectContaining({ src: "/repo", dest: "/backup" }),
      );
    });
  });
});
