import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import PathBar from "./PathBar";

vi.mock("../api/fs", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../api/fs");
  return {
    ...actual,
    fsCanonicalize: vi.fn(async (p: string) => p),
    fsRevealInOs: vi.fn(async () => {}),
    fsOpenWithDefault: vi.fn(async () => {}),
  };
});

vi.mock("../api/client", () => ({
  listDir: vi.fn(async () => [
    { name: "alpha", isDir: true },
    { name: "alpha-2", isDir: true },
    { name: "beta.txt", isDir: false },
  ]),
}));

const theme = createTheme();

function r(over: Partial<Parameters<typeof PathBar>[0]> = {}) {
  const onNavigate = vi.fn();
  const onHome = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <PathBar
        path={over.path ?? "/Users/test"}
        onNavigate={onNavigate}
        onHome={onHome}
        focusRequest={over.focusRequest}
      />
    </ThemeProvider>,
  );
  return { onNavigate, onHome };
}

describe("PathBar — extras", () => {
  it("Escape cancels edit mode and restores the breadcrumbs", () => {
    r({ path: "/x/y" });
    fireEvent.click(screen.getByLabelText("Edit path"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Enter on the edit field navigates to the typed local path", async () => {
    const { onNavigate } = r({ path: "/x" });
    fireEvent.click(screen.getByLabelText("Edit path"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/Users/syle/foo" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith("/Users/syle/foo");
    });
  });

  it("Tab inside the edit field triggers autocomplete (single match)", async () => {
    r({ path: "/Users" });
    fireEvent.click(screen.getByLabelText("Edit path"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/Users/be" } });
    fireEvent.keyDown(input, { key: "Tab" });
    // listDir is mocked to return alpha/alpha-2/beta.txt — only "beta"
    // matches "be" so the input completes to /Users/beta.txt (file, no
    // trailing slash).
    await waitFor(() => {
      expect(input.value).toBe("/Users/beta.txt");
    });
  });

  it("Tab autocompletes the longest common prefix on multi-match", async () => {
    r({ path: "/Users" });
    fireEvent.click(screen.getByLabelText("Edit path"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/Users/al" } });
    fireEvent.keyDown(input, { key: "Tab" });
    // alpha + alpha-2 → LCP "alpha".
    await waitFor(() => {
      expect(input.value).toBe("/Users/alpha");
    });
  });

  it("Right-click on a segment opens the segment menu", () => {
    r({ path: "/Users/syle/git" });
    fireEvent.contextMenu(screen.getByText("syle"));
    expect(screen.getByText(/Open in new tab/i)).toBeInTheDocument();
  });

  it("Segment-menu 'Reveal in Finder/Explorer' calls fsRevealInOs", async () => {
    r({ path: "/Users/syle" });
    fireEvent.contextMenu(screen.getByText("syle"));
    fireEvent.click(screen.getByText(/Reveal in Finder/i));
    const { fsRevealInOs } = await import("../api/fs");
    expect(fsRevealInOs).toHaveBeenCalledWith("/Users/syle");
  });

  it("focusRequest pulses flip into edit mode", async () => {
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <PathBar
          path="/x"
          onNavigate={vi.fn()}
          onHome={vi.fn()}
          focusRequest={0}
        />
      </ThemeProvider>,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    rerender(
      <ThemeProvider theme={theme}>
        <PathBar
          path="/x"
          onNavigate={vi.fn()}
          onHome={vi.fn()}
          focusRequest={1}
        />
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
  });
});
