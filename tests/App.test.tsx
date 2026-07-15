import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/App";

describe("Learning Foundry workbench", () => {
  it("keeps Foundry production as the primary surface", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /Turn curriculum intent/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Author and generate" })).toBeInTheDocument();
    expect(screen.queryByText("deterministic-demo-generator", { exact: false })).not.toBeInTheDocument();
  });

  it("generates and rejects an invalid deterministic draft", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Generate invalid draft" }));
    expect(screen.getByText("deterministic-demo-generator")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run 15 checks" }));
    expect(screen.getAllByText("FAIL").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Approve component" })).toBeDisabled();
  });

  it("opens a new minor revision when published content is edited", () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "A revised bounded prompt with enough authored detail." } });
    expect(screen.getByText("1.1.0", { selector: ".command-bar strong" })).toBeInTheDocument();
    expect(screen.getByText("DRAFT", { selector: ".command-bar strong" })).toBeInTheDocument();
  });
});
