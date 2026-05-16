// Pins the unreachable-folder placeholder contract: an actionable
// error view that replaces the misleading "Empty folder" line when
// the current folder's list_dir failed (broken pipe / bad creds /
// disconnected remote). Without this test the placeholder could
// silently regress to the bare error toast, leaving users to
// mistake a broken connection for an empty folder.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import UnreachableFolderPlaceholder from "./UnreachableFolderPlaceholder";

const theme = createTheme();

function r(over: Partial<Parameters<typeof UnreachableFolderPlaceholder>[0]> = {}) {
  const onRetry = over.onRetry ?? vi.fn();
  const onUp = over.onUp;
  render(
    <ThemeProvider theme={theme}>
      <UnreachableFolderPlaceholder
        path={over.path ?? "ftp://abc/home"}
        error={over.error ?? "list(/): Connection error: Broken pipe (os error 32)"}
        onRetry={onRetry}
        onUp={onUp}
      />
    </ThemeProvider>,
  );
  return { onRetry, onUp };
}

describe("UnreachableFolderPlaceholder", () => {
  it("renders the headline, path, error message, and retry CTA", () => {
    r();
    expect(screen.getByText(/Can.?t reach this folder/i)).toBeInTheDocument();
    expect(screen.getByText("ftp://abc/home")).toBeInTheDocument();
    expect(
      screen.getByText(/Broken pipe \(os error 32\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Retry connection/i }),
    ).toBeInTheDocument();
  });

  it("Retry fires onRetry", () => {
    const onRetry = vi.fn();
    r({ onRetry });
    fireEvent.click(screen.getByRole("button", { name: /Retry connection/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("Go up renders only when onUp is wired", () => {
    const onUp = vi.fn();
    r({ onUp });
    fireEvent.click(screen.getByRole("button", { name: /Go up/i }));
    expect(onUp).toHaveBeenCalledTimes(1);
  });

  it("Go up is hidden when onUp is omitted (root of a remote)", () => {
    r();
    expect(
      screen.queryByRole("button", { name: /Go up/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the alert role so screen readers announce the failure", () => {
    r();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
