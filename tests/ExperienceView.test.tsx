import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../src/App";

describe("Product Experience", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/?view=experience");
  });

  afterEach(() => window.history.replaceState({}, "", "/"));

  it("shows the learner journey and saves the bounded diagnosis", () => {
    render(<App />);

    expect(screen.getByText(/I calculated the mass of MgO as 4.00 g/)).toBeInTheDocument();
    expect(screen.getByText("Stoichiometric Product Mass Trainer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Diagnose learner attempt" }));
    expect(screen.getByText("WRONG_STOICHIOMETRIC_RATIO")).toBeInTheDocument();
    expect(screen.getByText(/1:1—not 0.5/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(screen.getByText("Worked correction · Magnesium to magnesium oxide")).toBeInTheDocument();
    expect(screen.getByText("Observed ratio: 0.5")).toBeInTheDocument();
  });

  it("schedules a delayed retry, supports completion, and resets the session", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Diagnose learner attempt" }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(screen.getByText("Retry: Stoichiometric product mass")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Jump back to Chat" }));
    expect(screen.getByText(/I calculated the mass of MgO as 4.00 g/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset demo" }));
    expect(screen.getByRole("button", { name: "Diagnose learner attempt" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(screen.getByText(/Run the diagnosis to schedule a retry/)).toBeInTheDocument();
  });

  it("moves a candidate through governance and returns the published revision to Library", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Component Lifecycle" }));
    expect(screen.getAllByText("WRONG_STOICHIOMETRIC_RATIO", { selector: ".trace-grid code" })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Promote to Foundry candidate" }));

    expect(screen.getByText("Ratio-transfer improvement candidate")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Component" })).toHaveDisplayValue("Stoichiometric product mass");
    expect(screen.getByText("1.1.0", { selector: ".command-bar strong" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve component" })).toBeDisabled();
    expect(screen.getAllByText("NOT RUN").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Run 15 checks" }));
    expect(screen.getByRole("button", { name: "Approve component" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Approve component" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish 1.1.0" }));
    fireEvent.click(screen.getByRole("link", { name: "Product Experience" }));
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(screen.getByText(/stoichiometric-product-mass@1.1.0/)).toBeInTheDocument();
    expect(screen.getByText(/Published from learner evidence/)).toBeInTheDocument();
  });
});
