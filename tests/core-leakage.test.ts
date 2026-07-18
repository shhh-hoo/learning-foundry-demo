import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { analyzeCoreSource, auditCoreArchitecture } from "../scripts/lib/core-leakage";

describe("Core dependency and contract leakage", () => {
  it("keeps Core-owned production modules free of Reference Pack dependencies and required domain fields", async () => {
    const report = await auditCoreArchitecture(resolve("."));

    expect(report.scannedRoots).toEqual([
      "src/core/domain",
      "src/core/application",
      "src/core/ports",
    ]);
    expect(report.violations).toEqual([]);
    expect(report.allowlist.entries.length).toBeLessThanOrEqual(report.allowlist.maximumEntries);
  });

  it("classifies import, contract, union, runtime and schema leakage independently", () => {
    const violations = analyzeCoreSource("src/core/domain/leaking-contract.ts", `
      import { z } from "zod";
      import type { DomainAdapter } from "../../reference-packs/domain/adapter";
      export interface LeakingContract { readonly examBoard: string; }
      export type Domain = "Chemistry" | "GENERAL";
    `);

    expect(new Set(violations.map((violation) => violation.category))).toEqual(new Set([
      "IMPORT_GRAPH",
      "REQUIRED_PUBLIC_FIELD",
      "CORE_DISCRIMINATED_UNION",
      "RUNTIME_DEPENDENCY",
      "SCHEMA_DEPENDENCY",
    ]));
  });
});
