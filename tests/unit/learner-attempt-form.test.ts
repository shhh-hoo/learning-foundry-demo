// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttemptForm } from "@/components/ClientActions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

describe("natural Learner Attempt form", () => {
  it("renders learner-safe fields without internal IDs, contracts or JSON authoring", () => {
    const { container } = render(createElement(AttemptForm, {
      taskId: "80000000-0000-4000-8000-000000000001",
      episodeId: "80000000-0000-4000-8000-000000000002",
      capabilities: [{
        publicKey: "chemistry-molar-concentration",
        name: "Molar concentration",
        purpose: "Check concentration from amount and volume.",
        example: "Use 0.25 mol and 500 mL.",
        fields: [
          { key: "amount", label: "Amount of substance", kind: "quantity", help: "Enter the given amount.", unitOptions: ["mol", "mmol"], defaultUnit: "mol" },
          { key: "learnerAnswer", label: "Your final numerical answer", kind: "number", help: "Enter your answer." },
        ],
      }],
    }));

    expect(screen.getByLabelText("Problem or question")).toBeTruthy();
    expect(screen.getByLabelText("Your working and answer")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Let Foundry identify the calculation" })).toBeTruthy();
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Calculation activity hint (optional)"), { target: { value: "chemistry-molar-concentration" } });
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(0);
    fireEvent.click(screen.getByLabelText("Enter calculation values myself"));
    expect(screen.getByLabelText("Amount of substance")).toBeTruthy();
    expect(screen.getByLabelText("Amount of substance unit")).toBeTruthy();

    const rendered = container.innerHTML;
    expect(rendered).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    expect(rendered).not.toContain("implementationKey");
    expect(rendered).not.toContain("Capability input JSON");
    expect(rendered).not.toContain("Capability input contracts");
    expect(rendered).not.toContain("structuredInput");
  });
});
