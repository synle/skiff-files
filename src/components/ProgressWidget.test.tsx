import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProgressWidget from "./ProgressWidget";

describe("ProgressWidget", () => {
  it("renders the files counter even with no byte data", () => {
    render(
      <ProgressWidget label="Copying" filesDone={3} filesTotal={10} />,
    );
    expect(screen.getByText(/3 of 10 files/)).toBeInTheDocument();
  });

  it("renders 'Calculating ETA…' when etaSeconds is null and there is work", () => {
    render(
      <ProgressWidget
        label="Copying"
        filesDone={1}
        filesTotal={10}
        bytesTotal={1000}
        bytesDone={100}
        etaSeconds={null}
      />,
    );
    expect(screen.getByText(/Calculating ETA…/)).toBeInTheDocument();
  });

  it("renders the ETA + completion time + rate once provided", () => {
    render(
      <ProgressWidget
        label="Copying"
        filesDone={1}
        filesTotal={10}
        bytesDone={500_000}
        bytesTotal={5_000_000}
        etaSeconds={120}
        bytesPerSec={1_000_000}
      />,
    );
    expect(screen.getByText(/2m remaining/)).toBeInTheDocument();
    expect(screen.getByText(/done at/)).toBeInTheDocument();
  });

  it("calls onPause when the pause button is clicked", () => {
    const onPause = vi.fn();
    render(
      <ProgressWidget
        label="Copying"
        filesDone={1}
        filesTotal={10}
        onPause={onPause}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(onPause).toHaveBeenCalled();
  });

  it("shows the resume button when paused", () => {
    const onResume = vi.fn();
    render(
      <ProgressWidget
        label="Copying"
        filesDone={1}
        filesTotal={10}
        paused
        onResume={onResume}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onResume).toHaveBeenCalled();
  });

  it("renders the current item below the bar", () => {
    render(
      <ProgressWidget
        label="Copying"
        filesDone={1}
        filesTotal={10}
        currentItem="/some/path/to/file.bin"
      />,
    );
    expect(screen.getByText("/some/path/to/file.bin")).toBeInTheDocument();
  });

  it("shows error inline", () => {
    render(
      <ProgressWidget
        label="Copying"
        filesDone={1}
        filesTotal={10}
        error="permission denied"
      />,
    );
    expect(screen.getByText("permission denied")).toBeInTheDocument();
  });

  it("renders Paused instead of ETA line when paused", () => {
    render(
      <ProgressWidget
        label="Copying"
        filesDone={1}
        filesTotal={10}
        bytesDone={100}
        bytesTotal={1000}
        etaSeconds={60}
        bytesPerSec={50}
        paused
      />,
    );
    expect(screen.getByText(/Paused/)).toBeInTheDocument();
  });
});
