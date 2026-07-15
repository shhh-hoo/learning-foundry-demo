import { describe, expect, it } from "vitest";
import { massDraft } from "../src/components/stoichiometric-product-mass";
import { ComponentLifecycle } from "../src/governance/lifecycle";
import { evaluateComponent } from "../src/governance/evaluation";
import { standardTrainerCapability } from "../src/runtime/capability";
import { caie9701StandardPack } from "../src/standards/caie-9701";

const review = { reviewer: "Expert", reviewedAt: "2026-07-15T09:00:00.000Z", notes: "Approved after deterministic checks." };
const publication = { publishedAt: "2026-07-15T09:05:00.000Z", publishedBy: "Publisher" };

describe("component lifecycle", () => {
  it("blocks approval after failed evaluation and blocks unapproved publication", () => {
    const lifecycle = new ComponentLifecycle();
    const invalid = { ...structuredClone(massDraft), target: { ...massDraft.target, expectedValue: 9 } };
    lifecycle.author(invalid);
    lifecycle.recordEvaluation(evaluateComponent(invalid, caie9701StandardPack, standardTrainerCapability));
    expect(() => lifecycle.approve(review)).toThrow(/passing Foundry evaluation/);
    expect(() => lifecycle.publish(publication)).toThrow(/approved component/);
  });

  it("invalidates evaluation and approval after edits", () => {
    const lifecycle = new ComponentLifecycle(); lifecycle.author(massDraft);
    lifecycle.recordEvaluation(evaluateComponent(massDraft, caie9701StandardPack, standardTrainerCapability));
    lifecycle.edit((component) => ({ ...component, presentation: { ...component.presentation, prompt: `${component.presentation.prompt} Revised.` } }));
    expect(lifecycle.snapshot.evaluation).toBeNull();
    lifecycle.recordEvaluation(evaluateComponent(lifecycle.snapshot.component!, caie9701StandardPack, standardTrainerCapability));
    lifecycle.approve(review);
    lifecycle.edit((component) => component);
    expect(lifecycle.snapshot.component?.status).toBe("DRAFT");
    expect(lifecycle.snapshot.component?.review).toBeUndefined();
  });

  it("publishes a frozen immutable snapshot and increments a revision", () => {
    const lifecycle = new ComponentLifecycle(); lifecycle.author(massDraft);
    lifecycle.recordEvaluation(evaluateComponent(massDraft, caie9701StandardPack, standardTrainerCapability));
    lifecycle.approve(review);
    const published = lifecycle.publish(publication);
    expect(Object.isFrozen(published)).toBe(true);
    expect(() => { (published.presentation as { title: string }).title = "Mutated"; }).toThrow();
    expect(lifecycle.createRevision().version).toBe("1.1.0");
    expect(published.version).toBe("1.0.0");
  });
});
