import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import StatusBar from "./StatusBar";

const theme = createTheme();

function r(props: React.ComponentProps<typeof StatusBar>) {
  return render(
    <ThemeProvider theme={theme}>
      <StatusBar {...props} />
    </ThemeProvider>,
  );
}

describe("StatusBar — extras", () => {
  it("shows the selected entry name when exactly one is selected", () => {
    r({
      totalEntries: 5,
      selectedEntries: 1,
      selectedSize: 100,
      selectedName: "report.pdf",
    });
    expect(screen.getByText(/report\.pdf/)).toBeInTheDocument();
  });

  it("shows find-mode counts with hit cap suffix", () => {
    r({
      totalEntries: 1000,
      selectedEntries: 0,
      selectedSize: 0,
      findActive: true,
      findHitCap: true,
    });
    expect(screen.getByText(/1000\+ matches/)).toBeInTheDocument();
  });

  it("shows folder / file split when both > 0", () => {
    r({
      totalEntries: 5,
      selectedEntries: 0,
      selectedSize: 0,
      folderCount: 2,
      fileCount: 3,
    });
    expect(screen.getByText(/2 folders, 3 files/)).toBeInTheDocument();
  });

  it("shows tagged count when > 0", () => {
    r({
      totalEntries: 5,
      selectedEntries: 0,
      selectedSize: 0,
      taggedCount: 3,
    });
    expect(screen.getByText(/3 tagged/)).toBeInTheDocument();
  });

  it("shows hidden-by-filter count when > 0", () => {
    r({
      totalEntries: 5,
      selectedEntries: 0,
      selectedSize: 0,
      hiddenByFilter: 2,
    });
    expect(screen.getByText(/2 hidden by filter/)).toBeInTheDocument();
  });

  it("shows clipboard hint with the right verb (cut → move)", () => {
    r({
      totalEntries: 5,
      selectedEntries: 0,
      selectedSize: 0,
      clipboardHint: { count: 2, op: "cut" },
    });
    expect(screen.getByText(/2 items ready to move/)).toBeInTheDocument();
  });

  it("shows clipboard hint with the right verb (copy → paste)", () => {
    r({
      totalEntries: 5,
      selectedEntries: 0,
      selectedSize: 0,
      clipboardHint: { count: 1, op: "copy" },
    });
    expect(screen.getByText(/1 item ready to paste/)).toBeInTheDocument();
  });
});
