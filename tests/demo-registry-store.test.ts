import { describe, expect, it } from "vitest";
import { publishedComponents } from "../src/components/published";
import { acceptPublishedDiagnosticComponent, DemoRegistryStore, type DiagnosticComponentRepository } from "../src/demo-registry/registry-store";
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
  it("accepts through an asynchronous durable repository contract", async () => {
    let persisted = false;
    const repository = {
      reset: async () => {},
      list: async () => [],
      get: async () => null,
      manifest: async () => ({ protocolVersion: "1.0.0" as const, generatedAt: "2026-07-16T10:00:00.000Z", components: [] }),
      put: async (component) => { persisted = true; return component; },
    } satisfies DiagnosticComponentRepository;

    await expect(acceptPublishedDiagnosticComponent(repository, validV110())).resolves.toMatchObject({
      ok: true,
      component: { version: "1.1.0" },
    });
    expect(persisted).toBe(true);
  });

  it("lists the latest accepted version and resets to the published local snapshot", async () => {
    const store = new DemoRegistryStore(publishedComponents);
    const original = await store.get("stoichiometric-product-mass");
    const accepted = validV110();

    await expect(store.accept(accepted)).resolves.toMatchObject({ ok: true });
    expect((await store.get(accepted.id))?.version).toBe("1.1.0");
    expect(await store.list()).toContainEqual(accepted);

    await store.reset();
    expect(await store.get(accepted.id)).toEqual(original);
    expect(await store.list()).not.toContainEqual(accepted);
  });

  it("accepts a valid published snapshot and rejects malformed or tampered content", async () => {
    const store = new DemoRegistryStore(publishedComponents);
    const valid = validV110();
    await expect(store.accept(valid)).resolves.toMatchObject({ ok: true, component: { version: "1.1.0" } });

    const tampered = { ...structuredClone(valid), presentation: { ...valid.presentation, title: "Tampered" } };
    await expect(store.accept(tampered)).resolves.toMatchObject({ ok: false, error: { code: "CONTENT_HASH_MISMATCH" } });
    await expect(store.accept({ id: "broken" })).resolves.toMatchObject({ ok: false, error: { code: "MALFORMED_COMPONENT" } });
  });
});
