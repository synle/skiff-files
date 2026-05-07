import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import PropertiesDialog from "./PropertiesDialog";
import type { Entry } from "../api/fs";

const theme = createTheme();

const file: Entry = {
  name: "notes.md",
  path: "/x/notes.md",
  kind: "markdown",
  size: 4096,
  mtime: 1700000000,
  isDir: false,
  isSymlink: false,
  isHidden: false,
  mode: 0o644,
};

const folder: Entry = {
  ...file,
  name: "stuff",
  path: "/x/stuff",
  kind: "folder",
  size: 0,
  isDir: true,
};

function r(props: { entry: Entry | null }) {
  return render(
    <ThemeProvider theme={theme}>
      <PropertiesDialog
        entry={props.entry}
        onClose={vi.fn()}
      />
    </ThemeProvider>,
  );
}

describe("PropertiesDialog", () => {
  it("renders nothing when entry is null", () => {
    r({ entry: null });
    expect(screen.queryByText("Kind")).not.toBeInTheDocument();
  });

  it("shows file metadata fields", () => {
    r({ entry: file });
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(screen.getByText("markdown")).toBeInTheDocument();
    expect(screen.getByText("/x/notes.md")).toBeInTheDocument();
    expect(screen.getByText(/4\.0 KB/)).toBeInTheDocument();
    expect(screen.getByText("0644")).toBeInTheDocument();
  });

  it("shows recursive folder size for directories", async () => {
    r({ entry: folder });
    // The mock returns entries=42, totalSize=1024 for fs_dir_summary.
    await waitFor(() => {
      expect(screen.getByText(/42 items/)).toBeInTheDocument();
    });
  });
});
