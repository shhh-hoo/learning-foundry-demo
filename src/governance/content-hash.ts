import type { DiagnosticLearningComponent } from "../contracts/diagnostic-component";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function canonicalComponentContent(component: DiagnosticLearningComponent): string {
  const hashable = {
    ...component,
    publication: component.publication
      ? { ...component.publication, contentHash: "" }
      : undefined,
  };
  return JSON.stringify(canonicalize(hashable));
}

export function computeContentHash(component: DiagnosticLearningComponent): string {
  const bytes = new TextEncoder().encode(canonicalComponentContent(component));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `lfh1-${hash.toString(16).padStart(8, "0")}`;
}

export function contentHashMatches(component: DiagnosticLearningComponent): boolean {
  return Boolean(component.publication?.contentHash) && component.publication?.contentHash === computeContentHash(component);
}

