import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

describe("external learning component catalog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/?view=components");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("shows current candidates with review state, attribution and no launch authority", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<App />);

    expect(screen.getByRole("navigation", { name: "External learning component catalog" })).toBeVisible();
    expect(screen.getByText("Balancing Chemical Equations")).toBeVisible();
    expect(screen.getByText("Virtual Lab")).toBeVisible();
    expect(screen.getByText("Course Presentation example")).toBeVisible();
    expect(screen.getAllByRole("button", { name: /review required|discovered/i }).every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(screen.getByText(/opening a link is not completion or learning evidence/i)).toBeVisible();
    expect(open).not.toHaveBeenCalled();
  });
});
