import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import DiffDialog from "./DiffDialog";

vi.mock("../api/client", () => ({
  readText: vi.fn(async (p: string) => {
    if (p === "/left.txt") return "alpha\nbeta\ngamma\n";
    if (p === "/right.txt") return "alpha\nBETA\ngamma\n";
    if (p === "/broken.txt") throw new Error("nope");
    return "";
  }),
}));

const theme = createTheme();

describe("DiffDialog", () => {
  it("renders nothing when either side is null", () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <DiffDialog left={null} right="/x" onClose={vi.fn()} />
      </ThemeProvider>,
    );
    expect(container.querySelector("[role=dialog]")).toBeNull();
  });

  it("shows the header with both paths once open", async () => {
    render(
      <ThemeProvider theme={theme}>
        <DiffDialog
          left="/left.txt"
          right="/right.txt"
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(
      screen.getByText(/\/left\.txt ↔ \/right\.txt/),
    ).toBeInTheDocument();
  });

  it("renders the diff hunks once readText resolves on both sides", async () => {
    render(
      <ThemeProvider theme={theme}>
        <DiffDialog
          left="/left.txt"
          right="/right.txt"
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );
    // beta → BETA — the dialog will render both as removed + added.
    await waitFor(() => {
      expect(screen.getByText(/- beta/)).toBeInTheDocument();
    });
    expect(screen.getByText(/\+ BETA/)).toBeInTheDocument();
  });

  it("surfaces a load error from either side", async () => {
    render(
      <ThemeProvider theme={theme}>
        <DiffDialog
          left="/broken.txt"
          right="/right.txt"
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText(/nope/)).toBeInTheDocument();
    });
  });
});
