import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DemoShell } from "../src/demo/DemoShell";
import { createDemoEvent } from "../src/demo/events";

describe("guided demo shell", () => {
  afterEach(() => { window.history.replaceState({}, "", "/"); });

  it("unlocks the next scene only after the required real product event", () => {
    window.history.replaceState({}, "", "/?view=demo");
    render(<DemoShell />);
    const next = screen.getByRole("button", { name: "Next" });
    const frame = screen.getByTitle("Live product surface") as HTMLIFrameElement;
    expect(next).toBeDisabled();

    const event = createDemoEvent("LEARNER_DIAGNOSIS_COMPLETED", "FOUNDRY", { stage: "FORMULA" });
    fireEvent(window, new MessageEvent("message", {
      data: { source: "learning-foundry-product", event },
      origin: window.location.origin,
      source: frame.contentWindow,
    }));

    expect(screen.getByText("What happened")).toBeVisible();
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect((screen.getByTitle("Live product surface") as HTMLIFrameElement).getAttribute("src")).toContain("section=library");
  });
});
