import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("renders disk free / total when supplied", () => {
    r({
      totalEntries: 5,
      selectedEntries: 0,
      selectedSize: 0,
      diskFree: 250 * 1024 * 1024 * 1024,
      diskTotal: 1024 * 1024 * 1024 * 1024,
    });
    expect(screen.getByText(/free of/)).toBeInTheDocument();
  });

  it("hides disk readout when diskFree is null", () => {
    r({
      totalEntries: 5,
      selectedEntries: 0,
      selectedSize: 0,
      diskFree: null,
      diskTotal: null,
    });
    expect(screen.queryByText(/free of/)).not.toBeInTheDocument();
  });

  it("error pill shows a dismiss button when onDismissError is provided", () => {
    const onDismissError = vi.fn();
    r({
      totalEntries: 0,
      selectedEntries: 0,
      selectedSize: 0,
      errorMessage: "boom",
      onDismissError,
    });
    fireEvent.click(screen.getByLabelText("Dismiss error"));
    expect(onDismissError).toHaveBeenCalled();
  });

  it("error pill omits the dismiss button when no handler is supplied", () => {
    r({
      totalEntries: 0,
      selectedEntries: 0,
      selectedSize: 0,
      errorMessage: "boom",
    });
    expect(screen.queryByLabelText("Dismiss error")).not.toBeInTheDocument();
  });

  // Zoom cluster (0.2.260) — surfaces at the right edge when viewZoom
  // + onZoomStep are provided. Bare-minimum tests pin the readout,
  // step semantics, reset on readout click, and the clamp-disabled
  // visuals at the floor / ceiling.
  it("renders the zoom readout as a rounded percent", () => {
    r({
      totalEntries: 1,
      selectedEntries: 0,
      selectedSize: 0,
      viewZoom: 1.25,
      onZoomStep: vi.fn(),
      onZoomReset: vi.fn(),
    });
    expect(screen.getByText("125%")).toBeInTheDocument();
  });

  it("zoom buttons fire onZoomStep with -1 / +1", () => {
    const onZoomStep = vi.fn();
    r({
      totalEntries: 1,
      selectedEntries: 0,
      selectedSize: 0,
      viewZoom: 1,
      onZoomStep,
      onZoomReset: vi.fn(),
    });
    fireEvent.click(screen.getByLabelText("Zoom out"));
    expect(onZoomStep).toHaveBeenLastCalledWith(-1);
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(onZoomStep).toHaveBeenLastCalledWith(1);
  });

  it("clicking the readout fires onZoomReset", () => {
    const onZoomReset = vi.fn();
    r({
      totalEntries: 1,
      selectedEntries: 0,
      selectedSize: 0,
      viewZoom: 1.5,
      onZoomStep: vi.fn(),
      onZoomReset,
    });
    fireEvent.click(screen.getByText("150%"));
    expect(onZoomReset).toHaveBeenCalledTimes(1);
  });

  it("disables Zoom out at the floor (50 %)", () => {
    r({
      totalEntries: 1,
      selectedEntries: 0,
      selectedSize: 0,
      viewZoom: 0.5,
      onZoomStep: vi.fn(),
    });
    expect(screen.getByLabelText("Zoom out")).toBeDisabled();
    expect(screen.getByLabelText("Zoom in")).not.toBeDisabled();
  });

  it("disables Zoom in at the ceiling (200 %)", () => {
    r({
      totalEntries: 1,
      selectedEntries: 0,
      selectedSize: 0,
      viewZoom: 2,
      onZoomStep: vi.fn(),
    });
    expect(screen.getByLabelText("Zoom in")).toBeDisabled();
    expect(screen.getByLabelText("Zoom out")).not.toBeDisabled();
  });

  it("omits the zoom cluster when viewZoom is not supplied", () => {
    r({ totalEntries: 1, selectedEntries: 0, selectedSize: 0 });
    expect(screen.queryByLabelText("Zoom in")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Zoom out")).not.toBeInTheDocument();
  });
});
