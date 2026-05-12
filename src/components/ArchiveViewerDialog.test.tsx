import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import ArchiveViewerDialog from "./ArchiveViewerDialog";

const theme = createTheme();
const mocked = vi.mocked(invoke);

beforeEach(() => {
  mocked.mockClear();
});

function r(over: Partial<Parameters<typeof ArchiveViewerDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onExtracted = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <ArchiveViewerDialog
        open
        archivePath="/tmp/test.zip"
        onClose={onClose}
        onExtracted={onExtracted}
        {...over}
      />
    </ThemeProvider>,
  );
  return { onClose, onExtracted };
}

describe("ArchiveViewerDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <ArchiveViewerDialog
          open={false}
          archivePath={null}
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(container.querySelector("[role=dialog]")).toBeNull();
  });

  it("lists entries returned by fs_archive_list", async () => {
    mocked.mockImplementationOnce(async (cmd) => {
      if (cmd === "fs_archive_list") {
        return [
          { name: "README.md", size: 100, isDir: false },
          { name: "src/", size: 0, isDir: true },
          { name: "src/index.ts", size: 4096, isDir: false },
        ];
      }
      return null;
    });
    r();
    await waitFor(() => {
      expect(screen.getByText("README.md")).toBeInTheDocument();
    });
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
  });

  it("filters entries by case-insensitive substring", async () => {
    mocked.mockImplementationOnce(async (cmd) => {
      if (cmd === "fs_archive_list") {
        return [
          { name: "README.md", size: 100, isDir: false },
          { name: "src/main.rs", size: 4096, isDir: false },
        ];
      }
      return null;
    });
    r();
    await waitFor(() => {
      expect(screen.getByText("README.md")).toBeInTheDocument();
    });
    const filterInput = screen.getByPlaceholderText(/Filter/i);
    fireEvent.change(filterInput, { target: { value: "MAIN" } });
    expect(screen.getByText("src/main.rs")).toBeInTheDocument();
    expect(screen.queryByText("README.md")).toBeNull();
  });

  it("surfaces an error from fs_archive_list", async () => {
    mocked.mockImplementationOnce(async (cmd) => {
      if (cmd === "fs_archive_list") throw new Error("bad zip");
      return null;
    });
    r();
    await waitFor(() => {
      expect(screen.getByText(/bad zip/)).toBeInTheDocument();
    });
  });

  it("clicking the extract icon invokes fs_archive_extract_one", async () => {
    mocked.mockImplementationOnce(async (cmd) => {
      if (cmd === "fs_archive_list") {
        return [{ name: "file.txt", size: 100, isDir: false }];
      }
      return null;
    });
    mocked.mockImplementationOnce(async () => undefined);
    const { onExtracted } = r();
    await waitFor(() => {
      expect(screen.getByText("file.txt")).toBeInTheDocument();
    });
    const extractBtn = screen.getByLabelText("Extract file.txt");
    fireEvent.click(extractBtn);
    await waitFor(() => {
      expect(onExtracted).toHaveBeenCalled();
    });
    expect(mocked).toHaveBeenCalledWith(
      "fs_archive_extract_one",
      expect.objectContaining({
        zipPath: "/tmp/test.zip",
        entryName: "file.txt",
      }),
    );
  });
});
