import { describe, expect, it } from "vitest";
import { publishedComponents } from "../src/components/published";
import { DemoRegistryStore } from "../src/demo-registry/registry-store";
import { publishApprovedComponent } from "../src/governance/publishing";

function validV110() {
  const original = publishedComponents.find((item) => item.id === "stoichiometric-product-mass")!;
  return publishApprovedComponent({
    ...structuredClone(original),
    version: "1.1.0",
    status: "APPROVED",
    publication: undefined,
    hintPolicy: { ...original.hintPolicy, hints: original.hintPolicy.hints.map((hint) => hint.id === "mass-ratio" ? { ...hint, text: "2Mg : 2MgO simplifies to 1:1. Each mole of Mg forms one mole of MgO." } : hint) },
  }, { publishedAt: "2026-07-16T10:00:00.000Z", publishedBy: "test" });
}

describe("local demo registry validation", () => {
  it("lists the latest accepted version and resets to the published local snapshot", () => {
    const store = new DemoRegistryStore(publishedComponents);
    const original = store.get("stoichiometric-product-mass");
    const accepted = validV110();

    expect(store.accept(accepted).ok).toBe(true);
    expect(store.get(accepted.id)?.version).toBe("1.1.0");
    expect(store.list()).toContainEqual(accepted);

    store.reset();
    expect(store.get(accepted.id)).toEqual(original);
    expect(store.list()).not.toContainEqual(accepted);
  });

  it("accepts a valid published snapshot and rejects malformed or tampered content", () => {
    const store = new DemoRegistryStore(publishedComponents);
    const valid = validV110();
    expect(store.accept(valid)).toMatchObject({ ok: true, component: { version: "1.1.0" } });

    const tampered = { ...structuredClone(valid), presentation: { ...valid.presentation, title: "Tampered" } };
    expect(store.accept(tampered)).toMatchObject({ ok: false, error: { code: "CONTENT_HASH_MISMATCH" } });
    expect(store.accept({ id: "broken" })).toMatchObject({ ok: false, error: { code: "MALFORMED_COMPONENT" } });
  });
});
