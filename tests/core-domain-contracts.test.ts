import { describe, expect, it } from "vitest";
import {
  createEvidenceReference,
  createSourceReference,
} from "../src/core/domain/evidence";
import { productRecordAuthority } from "../src/core/domain/learning";
import type { LearningCapabilityRuntime } from "../src/core/ports/learning-capability-runtime";
import { LegacyTrainerCapabilityRuntime } from "../src/runtime/learning-capability-runtime";

describe("domain-neutral Core contracts", () => {
  it("keeps source lineage separate from internal Evidence lineage", () => {
    const sourceRef = createSourceReference("source-1", "version-2");
    const evidenceRef = createEvidenceReference("evidence-1", "provenance-1");

    expect(sourceRef).toEqual({ referenceClass: "SOURCE", sourceId: "source-1", sourceVersion: "version-2" });
    expect(evidenceRef).toEqual({ referenceClass: "EVIDENCE", evidenceUnitId: "evidence-1", provenanceId: "provenance-1" });
    expect(sourceRef.referenceClass).not.toBe(evidenceRef.referenceClass);
  });

  it("classifies canonical records and derived representations without conflating them", () => {
    expect(productRecordAuthority("LEARNING_EPISODE")).toEqual({
      record: "CANONICAL",
      derivedFields: ["summary"],
    });
    expect(productRecordAuthority("DIAGNOSTIC_OBSERVATION")).toEqual({
      record: "CANONICAL",
      derivedFields: ["diagnosisPayload"],
    });
    expect(productRecordAuthority("RUNTIME_TRACE")).toEqual({
      record: "DERIVED_OPERATIONAL_EVIDENCE",
      derivedFields: ["record"],
    });
  });

  it("keeps the existing Trainer behind the domain-neutral Capability Runtime port", () => {
    const runtime: LearningCapabilityRuntime = new LegacyTrainerCapabilityRuntime(
      "http://127.0.0.1:4177/diagnose",
      async () => Response.json({ ok: false }, { status: 503 }),
    );

    expect(runtime).toBeInstanceOf(LegacyTrainerCapabilityRuntime);
  });
});
