import { describe, expect, it } from "vitest";
import { massDraft } from "../src/components/stoichiometric-product-mass";
import { ComponentLifecycle } from "../src/governance/lifecycle";
import { runComponentContractChecks } from "../src/governance/component-contract-checks";
import { standardTrainerCapability } from "../src/runtime/capability";
import { caie9701StandardPack } from "../src/standards/caie-9701";

const review = { reviewer: "Expert", reviewedAt: "2026-07-15T09:00:00.000Z", notes: "Approved after deterministic checks." };
const TEST_FIXTURE = "TEST_FIXTURE" as const;
const publication = { publishedAt: "2026-07-15T09:05:00.000Z", publishedBy: "Publisher" };

describe("component lifecycle", () => {
  it("rejects an empty Expert Review identity or notes", () => {
    expect(TEST_FIXTURE).toBe("TEST_FIXTURE");
    const lifecycle = new ComponentLifecycle(); lifecycle.author(massDraft);
    lifecycle.recordContractChecks(runComponentContractChecks(massDraft, caie9701StandardPack, standardTrainerCapability));
    expect(() => lifecycle.approve({ reviewer: "", reviewedAt: review.reviewedAt, notes: "" })).toThrow(/reviewer name and notes/i);
  });
  it("blocks approval after failed contract checks and blocks unapproved publication", () => {
    const lifecycle = new ComponentLifecycle();
    const invalid = { ...structuredClone(massDraft), target: { ...massDraft.target, expectedValue: 9 } };
    lifecycle.author(invalid);
    lifecycle.recordContractChecks(runComponentContractChecks(invalid, caie9701StandardPack, standardTrainerCapability));
    expect(() => lifecycle.approve(review)).toThrow(/Component Contract Checks/);
    expect(() => lifecycle.publish(publication)).toThrow(/approved component/);
  });

  it("invalidates contract checks and approval after edits", () => {
    const lifecycle = new ComponentLifecycle(); lifecycle.author(massDraft);
    lifecycle.recordContractChecks(runComponentContractChecks(massDraft, caie9701StandardPack, standardTrainerCapability));
    lifecycle.edit((component) => ({ ...component, presentation: { ...component.presentation, prompt: `${component.presentation.prompt} Revised.` } }));
    expect(lifecycle.snapshot.contractChecks).toBeNull();
    lifecycle.recordContractChecks(runComponentContractChecks(lifecycle.snapshot.component!, caie9701StandardPack, standardTrainerCapability));
    lifecycle.approve(review);
    lifecycle.edit((component) => component);
    expect(lifecycle.snapshot.component?.status).toBe("DRAFT");
    expect(lifecycle.snapshot.component?.review).toBeUndefined();
  });

  it("publishes a frozen immutable snapshot and increments a revision", () => {
    const lifecycle = new ComponentLifecycle(); lifecycle.author(massDraft);
    lifecycle.recordContractChecks(runComponentContractChecks(massDraft, caie9701StandardPack, standardTrainerCapability));
    lifecycle.approve(review);
    const published = lifecycle.publish(publication);
    expect(Object.isFrozen(published)).toBe(true);
    expect(() => { (published.presentation as { title: string }).title = "Mutated"; }).toThrow();
    expect(lifecycle.createRevision().version).toBe("1.1.0");
    expect(published.version).toBe("1.0.0");
  });
});
