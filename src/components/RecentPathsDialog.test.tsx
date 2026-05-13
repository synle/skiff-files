import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import RecentPathsDialog from "./RecentPathsDialog";

const theme = createTheme();

function r(over: Partial<Parameters<typeof RecentPathsDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <RecentPathsDialog
        open
        paths={["/Users/me/a", "sftp://abc/home/x", "smb://s/share/y"]}
        onClose={onClose}
        onNavigate={onNavigate}
        {...over}
      />
    </ThemeProvider>,
  );
  return { onClose, onNavigate };
}

beforeEach(() => {});
afterEach(() => {});

describe("RecentPathsDialog", () => {
  it("renders every path verbatim (no abbreviation) and tags origins", () => {
    r();
    expect(screen.getByText("/Users/me/a")).toBeInTheDocument();
    expect(screen.getByText("sftp://abc/home/x")).toBeInTheDocument();
    expect(screen.getByText("smb://s/share/y")).toBeInTheDocument();
    expect(screen.getByText("Local")).toBeInTheDocument();
    expect(screen.getByText("SFTP")).toBeInTheDocument();
    expect(screen.getByText("SMB")).toBeInTheDocument();
  });

  it("filters by substring case-insensitively", () => {
    r();
    const search = screen.getByPlaceholderText("Search recent paths…");
    fireEvent.change(search, { target: { value: "smb" } });
    expect(screen.getByText("smb://s/share/y")).toBeInTheDocument();
    expect(screen.queryByText("/Users/me/a")).toBeNull();
    expect(screen.queryByText("sftp://abc/home/x")).toBeNull();
  });

  it("invokes onNavigate + onClose when a row is clicked", () => {
    const { onClose, onNavigate } = r();
    fireEvent.click(screen.getByText("/Users/me/a"));
    expect(onNavigate).toHaveBeenCalledWith("/Users/me/a");
    expect(onClose).toHaveBeenCalled();
  });

  it("renders an empty state when filter matches nothing", () => {
    r();
    fireEvent.change(screen.getByPlaceholderText("Search recent paths…"), {
      target: { value: "zzzzz" },
    });
    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });

  it("caps display at 200 entries", () => {
    const many = Array.from({ length: 250 }, (_, i) => `/dir-${i}`);
    r({ paths: many });
    expect(screen.getByText(/200 of 200 shown/)).toBeInTheDocument();
    expect(screen.getByText(/capped at 200/)).toBeInTheDocument();
  });
});
