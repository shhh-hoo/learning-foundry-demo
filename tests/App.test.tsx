import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../src/App";

describe("role-separated product routes", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.history.replaceState({}, "", "/"));

  it("keeps governance and engineering metadata out of Learner Workspace", () => {
    window.history.replaceState({}, "", "/?view=learner");
    render(<App />);
    expect(screen.getByRole("navigation", { name: "Learner workspace" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Chat" })).toBeVisible();
    expect(screen.queryByText("Pattern Inbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/content hash/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/schema version/i)).not.toBeInTheDocument();
  });

  it("keeps learner tools out of Foundry Studio", () => {
    window.history.replaceState({}, "", "/?view=studio");
    render(<App />);
    expect(screen.getByText("Foundry Studio")).toBeVisible();
    expect(screen.getByRole("button", { name: "Pattern Inbox" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Learner workspace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chat" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Schedule" })).not.toBeInTheDocument();
  });

  it("makes engineering evidence visible only in Inspector", () => {
    window.history.replaceState({}, "", "/?view=inspector");
    render(<App />);
    expect(screen.getByRole("navigation", { name: "Engineering Inspector" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Component Registry" }));
    expect(screen.getByText("stoichiometric-product-mass")).toBeVisible();
    expect(screen.getByText("kp-from-equilibrium-moles")).toBeVisible();
    expect(screen.getByText("Legacy regression")).toBeVisible();
  });
});
