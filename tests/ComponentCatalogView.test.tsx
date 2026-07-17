import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXTERNAL_COMPONENT_LAUNCH_KEY } from "../src/external-components/launch-repository";
import { ComponentCatalogView } from "../src/surfaces/ComponentCatalogView";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("External Component Catalog", () => {
  it("shows launchable and review-gated resources separately", () => {
    render(<ComponentCatalogView />);
    expect(screen.getAllByRole("button", { name: "Open governed link" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Unavailable until review" })).toHaveLength(6);
    expect(screen.getByText("Balancing Chemical Equations")).toBeInTheDocument();
    expect(screen.getByText("License review required", { selector: "strong" })).toBeInTheDocument();
  });

  it("records a launch before opening an approved external link", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<ComponentCatalogView />);
    await userEvent.click(screen.getAllByRole("button", { name: "Open governed link" })[0]!);

    expect(open).toHaveBeenCalledWith("https://chemcollective.org/activities/info/78", "_blank", "noopener,noreferrer");
    const records = JSON.parse(window.localStorage.getItem(EXTERNAL_COMPONENT_LAUNCH_KEY) ?? "[]") as readonly { readonly componentId: string; readonly evidenceClass: string; readonly outcomeEligible: boolean }[];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      componentId: "chemcollective-stoichiometry-solution-preparation",
      evidenceClass: "SHOWCASE_EXTERNAL_LAUNCH",
      outcomeEligible: false,
    });
    expect(screen.getByText("1 local launch records")).toBeInTheDocument();
  });

  it("does not launch a license-review candidate", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<ComponentCatalogView />);
    const restricted = screen.getAllByRole("button", { name: "Unavailable until review" })[0]!;
    expect(restricted).toBeDisabled();
    await userEvent.click(restricted);
    expect(open).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(EXTERNAL_COMPONENT_LAUNCH_KEY)).toBeNull();
  });
});
