import type { DiagnosticLearningComponent, PublishedDiagnosticLearningComponent } from "../contracts/diagnostic-component";
import { computeContentHash } from "./content-hash";

export function publishApprovedComponent(
  component: DiagnosticLearningComponent,
  publication: { readonly publishedAt: string; readonly publishedBy: string },
): PublishedDiagnosticLearningComponent {
  if (component.status !== "APPROVED" || !component.review) {
    throw new Error("Only an expert-approved component can be published.");
  }
  const snapshot: DiagnosticLearningComponent = {
    ...structuredClone(component),
    status: "PUBLISHED",
    publication: { ...publication, contentHash: "" },
  };
  const published = {
    ...snapshot,
    publication: { ...snapshot.publication!, contentHash: computeContentHash(snapshot) },
  } as PublishedDiagnosticLearningComponent;
  return deepFreeze(published);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

export function incrementVersion(version: string, change: "CONTENT" | "METADATA" | "SCHEMA_BREAKING"): string {
  const [major, minor, patch] = version.split(".").map(Number);
  if (![major, minor, patch].every(Number.isInteger)) throw new Error("Version must be semantic x.y.z.");
  return change === "SCHEMA_BREAKING"
    ? `${major + 1}.0.0`
    : change === "CONTENT"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;
}

