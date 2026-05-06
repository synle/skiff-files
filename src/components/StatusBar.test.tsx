import { describe, it, expect } from "vitest";
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

describe("StatusBar", () => {
  it("shows the total when nothing is selected", () => {
    r({ totalEntries: 14, selectedEntries: 0, selectedSize: 0 });
    expect(screen.getByText("14 items")).toBeInTheDocument();
  });

  it("uses singular for one item", () => {
    r({ totalEntries: 1, selectedEntries: 0, selectedSize: 0 });
    expect(screen.getByText("1 item")).toBeInTheDocument();
  });

  it("shows selection count and size when something is selected", () => {
    r({ totalEntries: 14, selectedEntries: 3, selectedSize: 1024 * 1024 * 4 });
    expect(screen.getByText(/3 of 14 selected/)).toBeInTheDocument();
    expect(screen.getByText(/4\.0 MB/)).toBeInTheDocument();
  });

  it("renders the error message when present", () => {
    r({
      totalEntries: 0,
      selectedEntries: 0,
      selectedSize: 0,
      errorMessage: "permission denied",
    });
    expect(screen.getByText("permission denied")).toBeInTheDocument();
  });

  it("error message takes precedence over selection summary", () => {
    r({
      totalEntries: 14,
      selectedEntries: 3,
      selectedSize: 1024,
      errorMessage: "boom",
    });
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.queryByText(/3 of 14 selected/)).not.toBeInTheDocument();
  });
});
