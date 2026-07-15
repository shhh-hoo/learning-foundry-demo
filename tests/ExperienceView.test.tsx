import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../src/App";

describe("separated product experience", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/?view=learner");
  });
  afterEach(() => window.history.replaceState({}, "", "/"));

  it("returns a student-facing diagnosis and saves a clean learning artifact", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Check my working" }));
    expect(screen.getByText(/first error is the mole ratio/i)).toBeVisible();
    fireEvent.click(screen.getByText("Why this answer?"));
    expect(screen.getByText("Mole-ratio error")).toBeVisible();
    expect(screen.queryByText("WRONG_STOICHIOMETRIC_RATIO")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(screen.getByRole("heading", { name: "Magnesium to magnesium oxide" })).toBeVisible();
    expect(screen.queryByText("evidence-mgo-ratio-current")).not.toBeInTheDocument();
  });

  it("offers meaningful review actions without an immediate reopen loop", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Check my working" }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(screen.getByRole("button", { name: "Start review" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Start transfer problem" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    expect(screen.getByRole("button", { name: "Completed" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
  });

  it("creates a draft only after current learner evidence reaches the threshold", () => {
    const learner = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Check my working" }));
    learner.unmount();

    window.history.replaceState({}, "", "/?view=studio");
    render(<App />);
    expect(screen.getByText("3 / 3")).toBeVisible();
    expect(screen.getByText("1 current learner trace")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create component candidate" }));
    expect(screen.getByText(/evidence-mgo-ratio-current/)).toBeVisible();
    expect(screen.getByText("PROMOTED_TO_FOUNDRY")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Continue to evaluation" }));
    expect(screen.getByText("NOT RUN")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Run 15 checks" }));
    fireEvent.click(screen.getByRole("button", { name: "Expert Review" }));
    expect(screen.getByRole("button", { name: "Approve component" })).toBeEnabled();
  });
});
