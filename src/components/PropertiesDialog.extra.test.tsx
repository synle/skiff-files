import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import PropertiesDialog from "./PropertiesDialog";
import type { Entry } from "../api/fs";

const theme = createTheme();

function entry(over: Partial<Entry> = {}): Entry {
  return {
    name: "x.txt",
    path: "/x.txt",
    kind: "text",
    size: 100,
    mtime: 1700000000,
    isDir: false,
    isSymlink: false,
    isHidden: false,
    mode: 0o644,
    ...over,
  };
}

function r(e: Entry | null) {
  const onClose = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <PropertiesDialog entry={e} onClose={onClose} />
    </ThemeProvider>,
  );
  return { onClose };
}

describe("PropertiesDialog — extras", () => {
  it("Compute SHA-256 button kicks the hash and surfaces the result", async () => {
    r(entry({ kind: "binary", size: 1024 }));
    const btn = screen.getByRole("button", { name: /Compute SHA-256/ });
    fireEvent.click(btn);
    // The default mock returns 'deadbeef' for fs_hash_sha256.
    await waitFor(() => {
      expect(screen.getByText("deadbeef")).toBeInTheDocument();
    });
  });

  it("Copy info as JSON writes to navigator.clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    r(entry({ name: "info.txt", path: "/info.txt" }));
    fireEvent.click(screen.getByRole("button", { name: /Copy info as JSON/ }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const firstCall = writeText.mock.calls[0] as unknown as [string];
    const json = JSON.parse(firstCall[0]);
    expect(json.name).toBe("info.txt");
    expect(json.path).toBe("/info.txt");
  });

  it("does not crash for a symlink entry", () => {
    r(entry({ isSymlink: true, kind: "symlink" }));
    expect(screen.getByText("x.txt")).toBeInTheDocument();
  });

  it("does not crash for a hidden entry", () => {
    r(entry({ isHidden: true }));
    expect(screen.getByText("x.txt")).toBeInTheDocument();
  });

  it("missing mode does not crash the dialog", () => {
    r(entry({ mode: null }));
    expect(screen.getByText("x.txt")).toBeInTheDocument();
  });

  it("missing mtime does not crash the dialog", () => {
    r(entry({ mtime: null }));
    expect(screen.getByText("x.txt")).toBeInTheDocument();
  });
});
