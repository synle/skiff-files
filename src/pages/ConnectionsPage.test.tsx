import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { MemoryRouter } from "react-router";
import ConnectionsPage from "./ConnectionsPage";
import { invoke } from "@tauri-apps/api/core";

const theme = createTheme();

beforeEach(() => {
  localStorage.clear();
});

function r() {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <ConnectionsPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe("ConnectionsPage", () => {
  it("renders the new-connection form", () => {
    r();
    expect(screen.getByLabelText(/Host/)).toBeInTheDocument();
    expect(screen.getByLabelText(/User/)).toBeInTheDocument();
    expect(screen.getByText("Connect")).toBeInTheDocument();
  });

  it("disables Connect until host + user are filled", () => {
    r();
    const btn = screen.getByText("Connect");
    expect(btn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Host/), {
      target: { value: "example.com" },
    });
    fireEvent.change(screen.getByLabelText(/User/), {
      target: { value: "alice" },
    });
    expect(btn).not.toBeDisabled();
  });

  it("invokes conn_create_sftp on Connect and saves a draft", async () => {
    r();
    fireEvent.change(screen.getByLabelText(/Host/), {
      target: { value: "example.com" },
    });
    fireEvent.change(screen.getByLabelText(/User/), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText(/Password/), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "conn_create_sftp",
        expect.objectContaining({
          config: expect.objectContaining({
            host: "example.com",
            user: "alice",
            password: "hunter2",
          }),
        }),
      );
    });

    // Draft persisted (no password!).
    const drafts = JSON.parse(
      localStorage.getItem("skiff-files.connections.sftp.v1") ?? "[]",
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].host).toBe("example.com");
    expect(drafts[0]).not.toHaveProperty("password");
  });

  it("shows the empty-state message when no live connections exist", async () => {
    r();
    await waitFor(() => {
      expect(screen.getByText(/No live connections/i)).toBeInTheDocument();
    });
  });
});

void vi;
