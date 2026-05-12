import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import BulkRenameDialog from "./BulkRenameDialog";
import type { Entry } from "../api/fs";

vi.mock("../api/client", () => ({
  rename: vi.fn(async () => {}),
}));

const theme = createTheme();

function entry(over: Partial<Entry>): Entry {
  return {
    name: "x.txt",
    path: "/x/x.txt",
    kind: "text",
    size: 0,
    mtime: null,
    isDir: false,
    isSymlink: false,
    isHidden: false,
    mode: null,
    ...over,
  };
}

function r(entries: Entry[]) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <BulkRenameDialog
        entries={entries}
        onClose={onClose}
        onDone={onDone}
      />
    </ThemeProvider>,
  );
  return { onClose, onDone };
}

describe("BulkRenameDialog", () => {
  it("renders nothing when entries is empty", () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <BulkRenameDialog entries={[]} onClose={vi.fn()} onDone={vi.fn()} />
      </ThemeProvider>,
    );
    expect(container.querySelector("[role=dialog]")).toBeNull();
  });

  it("shows the count of items being renamed", () => {
    r([
      entry({ name: "a.txt", path: "/a.txt" }),
      entry({ name: "b.txt", path: "/b.txt" }),
    ]);
    expect(screen.getByText("Rename 2 items")).toBeInTheDocument();
  });

  it("preview reflects find/replace typing", () => {
    r([
      entry({ name: "alpha.txt", path: "/alpha.txt" }),
      entry({ name: "alpha-2.txt", path: "/alpha-2.txt" }),
    ]);
    fireEvent.change(screen.getByLabelText("Find"), {
      target: { value: "alpha" },
    });
    fireEvent.change(screen.getByLabelText("Replace"), {
      target: { value: "beta" },
    });
    // The preview is rendered as a single Typography line with
    // `{old} → {new}` interpolation. Match on a function combining
    // child text since the arrow + names land as one text node.
    expect(
      screen.getAllByText((_, el) =>
        (el?.textContent ?? "").includes("alpha.txt → beta.txt"),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("shows a 'no matches' message when find matches nothing", () => {
    r([entry({ name: "a.txt", path: "/a.txt" })]);
    fireEvent.change(screen.getByLabelText("Find"), {
      target: { value: "zzzz" },
    });
    expect(screen.getByText(/No names matched/i)).toBeInTheDocument();
  });

  it("regex toggle surfaces a regex error in red", () => {
    r([entry({ name: "a.txt", path: "/a.txt" })]);
    fireEvent.click(screen.getByLabelText(/Regular expression/));
    fireEvent.change(screen.getByLabelText("Find"), {
      target: { value: "[" },
    });
    // The applyBulkRename helper returns the error in r.error; the
    // dialog renders it as a caption. We just assert the Apply button
    // is disabled when there's an error.
    const applyBtn = screen.getByRole("button", { name: /Rename 0 items/ });
    expect(applyBtn).toBeDisabled();
  });

  it("prefix is prepended in the preview", () => {
    r([entry({ name: "a.txt", path: "/a.txt" })]);
    // Need a find pattern to flip the preview out of the empty-state.
    fireEvent.change(screen.getByLabelText("Find"), {
      target: { value: "a" },
    });
    fireEvent.change(screen.getByLabelText("Replace"), {
      target: { value: "a" }, // no-op replace so prefix is the only diff
    });
    fireEvent.change(screen.getByLabelText("Prefix"), {
      target: { value: "pre-" },
    });
    expect(
      screen.getAllByText((_, el) =>
        (el?.textContent ?? "").includes("a.txt → pre-a.txt"),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("suffix is inserted before the extension", () => {
    r([entry({ name: "a.txt", path: "/a.txt" })]);
    fireEvent.change(screen.getByLabelText("Find"), {
      target: { value: "a" },
    });
    fireEvent.change(screen.getByLabelText("Replace"), {
      target: { value: "a" },
    });
    fireEvent.change(screen.getByLabelText("Suffix"), {
      target: { value: "-v2" },
    });
    expect(
      screen.getAllByText((_, el) =>
        (el?.textContent ?? "").includes("a.txt → a-v2.txt"),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("inline edit toggle reveals per-row text fields", () => {
    r([entry({ name: "a.txt", path: "/a.txt" })]);
    fireEvent.click(screen.getByLabelText(/Inline edit/));
    // Now there's an extra TextField per row — at least find/replace +
    // prefix/suffix + 1 row override = 5 text inputs.
    const inputs = document.querySelectorAll("input[type=text]");
    expect(inputs.length).toBeGreaterThanOrEqual(5);
  });

  it("preview prompt appears when find is empty and inline edit is off", () => {
    r([entry({ name: "a.txt", path: "/a.txt" })]);
    expect(
      screen.getByText(/Enter a Find pattern/i),
    ).toBeInTheDocument();
  });

  it("Cancel button fires onClose", () => {
    const { onClose } = r([entry({})]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Apply button is disabled when there are no changes", () => {
    r([entry({})]);
    expect(
      screen.getByRole("button", { name: /Rename 0 items/ }),
    ).toBeDisabled();
  });
});
