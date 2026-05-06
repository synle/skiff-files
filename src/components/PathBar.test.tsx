import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import PathBar from "./PathBar";

const theme = createTheme();

function renderBar(props: {
  path?: string;
  onNavigate?: (p: string) => void;
  onHome?: () => void;
}) {
  const onNavigate = props.onNavigate ?? vi.fn();
  const onHome = props.onHome ?? vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <PathBar
        path={props.path ?? "/Users/syle/git"}
        onNavigate={onNavigate}
        onHome={onHome}
      />
    </ThemeProvider>,
  );
  return { onNavigate, onHome };
}

describe("PathBar", () => {
  it("renders one breadcrumb per segment", () => {
    renderBar({ path: "/Users/syle/git" });
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("syle")).toBeInTheDocument();
    expect(screen.getByText("git")).toBeInTheDocument();
  });

  it("clicking a segment calls onNavigate with the absolute prefix", () => {
    const { onNavigate } = renderBar({ path: "/Users/syle/git" });
    fireEvent.click(screen.getByText("syle"));
    expect(onNavigate).toHaveBeenCalledWith("/Users/syle");
  });

  it("home button fires onHome", () => {
    const { onHome } = renderBar({ path: "/" });
    fireEvent.click(screen.getByLabelText("Home"));
    expect(onHome).toHaveBeenCalled();
  });

  it("edit button switches to a text field", () => {
    renderBar({ path: "/Users/syle" });
    fireEvent.click(screen.getByLabelText("Edit path"));
    // The text field replaces the breadcrumb when editing — find the input
    // by role since MUI strips inputProps in some configurations.
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
