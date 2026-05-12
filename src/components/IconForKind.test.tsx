import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import IconForKind from "./IconForKind";
import type { FileKind } from "../api/fs";

const KINDS: FileKind[] = [
  "folder",
  "symlink",
  "text",
  "code",
  "markdown",
  "image",
  "audio",
  "video",
  "archive",
  "pdf",
  "spreadsheet",
  "document",
  "binary",
  "unknown",
];

describe("IconForKind", () => {
  it("renders an svg for every documented FileKind", () => {
    for (const kind of KINDS) {
      const { container, unmount } = render(<IconForKind kind={kind} />);
      const svg = container.querySelector("svg");
      expect(svg, `expected an icon for kind=${kind}`).not.toBeNull();
      unmount();
    }
  });

  it("honors the fontSize prop", () => {
    const { container } = render(
      <IconForKind kind="folder" fontSize="large" />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
