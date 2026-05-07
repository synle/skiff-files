import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import * as React from "react";
import { SettingsProvider, useSettings } from "../state/settings";
import QuickJump from "./QuickJump";
import type { Bookmark } from "../state/settings";

const theme = createTheme();

/** Tiny helper that pre-populates settings with bookmarks + recent
 *  paths via the provider, then renders QuickJump. */
function Harness({
  bookmarks,
  recentPaths,
  open,
  onJump,
  onClose,
}: {
  bookmarks: Bookmark[];
  recentPaths: string[];
  open: boolean;
  onJump: (p: string) => void;
  onClose: () => void;
}) {
  return (
    <SettingsProvider>
      <Seeder bookmarks={bookmarks} recentPaths={recentPaths} />
      <QuickJump open={open} onClose={onClose} onJump={onJump} home="/home/test" />
    </SettingsProvider>
  );
}

function Seeder({
  bookmarks,
  recentPaths,
}: {
  bookmarks: Bookmark[];
  recentPaths: string[];
}) {
  const { update } = useSettings();
  // useEffect with empty deps so this runs exactly once, not on
  // every render. (The previous version called update() during
  // render, causing an infinite loop.)
  React.useEffect(() => {
    if (bookmarks.length) update("bookmarks", bookmarks);
    if (recentPaths.length) update("recentPaths", recentPaths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function r(opts?: {
  bookmarks?: Bookmark[];
  recentPaths?: string[];
  open?: boolean;
}) {
  const onJump = vi.fn();
  const onClose = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <Harness
        bookmarks={opts?.bookmarks ?? []}
        recentPaths={opts?.recentPaths ?? []}
        open={opts?.open ?? true}
        onJump={onJump}
        onClose={onClose}
      />
    </ThemeProvider>,
  );
  return { onJump, onClose };
}

describe("QuickJump", () => {
  it("does not render when closed", () => {
    r({ open: false });
    expect(screen.queryByLabelText("Quick jump query")).not.toBeInTheDocument();
  });

  it("seeds favorites from `home` when bookmarks + recent are empty", async () => {
    r();
    await waitFor(() =>
      expect(screen.getByText("Home")).toBeInTheDocument(),
    );
    expect(screen.getByText("Desktop")).toBeInTheDocument();
    expect(screen.getByText("Documents")).toBeInTheDocument();
    expect(screen.getByText("Downloads")).toBeInTheDocument();
  });

  it("filters by substring against label and path", async () => {
    r({
      bookmarks: [
        { id: "1", label: "alpha", path: "/x/alpha" },
        { id: "2", label: "beta", path: "/x/beta" },
      ],
    });
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Quick jump query"), {
      target: { value: "alp" },
    });
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("Enter on the highlighted entry calls onJump", async () => {
    const { onJump } = r({
      bookmarks: [{ id: "1", label: "alpha", path: "/x/alpha" }],
    });
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
    const input = screen.getByLabelText("Quick jump query");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onJump).toHaveBeenCalledWith("/x/alpha");
  });

  it("dedups when a path is in both bookmarks and recent", async () => {
    r({
      bookmarks: [{ id: "1", label: "shared", path: "/x/shared" }],
      recentPaths: ["/x/shared"],
    });
    await waitFor(() =>
      expect(screen.getAllByText("shared")).toHaveLength(1),
    );
  });
});
