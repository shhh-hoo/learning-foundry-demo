import { and, eq } from "drizzle-orm";
import { ComponentContract } from "@/domain/component";
import type { Actor } from "@/domain/model";
import { DomainInvariantError, requireRole } from "@/domain/invariants";
import { getDb } from "@/db/client";
import { componentVersions, components, governanceEvents, subjects } from "@/db/schema";

export type StructuralPreflightCheck = { id: string; status: "VALID" | "INVALID"; detail: string };

export async function runComponentStructuralPreflight(actor: Actor, componentVersionId: string) {
  requireRole(actor, ["EXPERT", "ADMIN"]);
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select({ version: componentVersions, component: components })
      .from(componentVersions)
      .innerJoin(components, eq(components.id, componentVersions.componentId))
      .where(and(eq(componentVersions.id, componentVersionId), eq(components.institutionId, actor.institutionId)))
      .for("update")
      .limit(1);
    if (!row) throw new DomainInvariantError("Component version is outside the active institution", "TENANT_ISOLATION");
    if (row.version.status !== "DRAFT") throw new DomainInvariantError("Only a mutable Draft can run structural preflight", "VERSION_IMMUTABLE");

    const parsed = ComponentContract.safeParse(row.version.contract);
    const contract = parsed.success ? parsed.data : null;
    const pack = contract ? (await tx.select({ id: subjects.id }).from(subjects).where(and(
      eq(subjects.institutionId, actor.institutionId),
      eq(subjects.referencePackKey, contract.referencePackKey),
    )).limit(1))[0] : null;
    const requirements = contract?.evidenceRequirements ?? [];
    const checks: StructuralPreflightCheck[] = [
      { id: "contract-shape", status: parsed.success ? "VALID" : "INVALID", detail: parsed.success ? "The Component contract matches the structural schema." : "The Component contract does not match the structural schema." },
      { id: "reference-pack-registration", status: pack ? "VALID" : "INVALID", detail: pack ? "The referenced Pack key is registered for this institution." : "The referenced Pack key is not registered for this institution." },
      { id: "governance-requirements", status: requirements.includes("DiagnosticObservation") && requirements.includes("TeacherReview") ? "VALID" : "INVALID", detail: "The contract must require DiagnosticObservation and TeacherReview lineage." },
      { id: "content-presence", status: Object.keys(row.version.content).length > 0 ? "VALID" : "INVALID", detail: "Draft content must be non-empty." },
    ];
    const structuralStatus = checks.every((check) => check.status === "VALID") ? "COMPLETE" : "ISSUES_FOUND";
    const validation = { kind: "STRUCTURAL_PREFLIGHT", status: structuralStatus, checks, executedAt: new Date().toISOString() };
    const evalResult = {
      status: "UNAVAILABLE",
      publicationEligible: false,
      requiredChecks: {
        capabilityExecution: "UNAVAILABLE",
        domainCorrectness: "UNAVAILABLE",
        pedagogySafety: "UNAVAILABLE",
        reuseValidation: "UNAVAILABLE",
      },
    };
    await tx.update(componentVersions).set({ validation, evalResult, status: "DRAFT" }).where(and(
      eq(componentVersions.id, row.version.id),
      eq(componentVersions.componentId, row.component.id),
      eq(componentVersions.status, "DRAFT"),
    ));
    await tx.insert(governanceEvents).values({
      institutionId: actor.institutionId,
      actorUserId: actor.userId,
      entityType: "COMPONENT_VERSION",
      entityId: row.version.id,
      action: "STRUCTURAL_PREFLIGHT_RECORDED",
      payload: { componentId: row.component.id, structuralStatus, publicationEligible: false },
    });
    return { validation, evalResult, status: `STRUCTURAL_PREFLIGHT_${structuralStatus}` as const, publicationEligible: false as const };
  });
}
