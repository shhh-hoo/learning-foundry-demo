import type { PublishedDiagnosticLearningComponent } from "../contracts/diagnostic-component";
import { publishedDiagnosticLearningComponentSchema } from "../contracts/published-component";
import { COMPONENT_SCHEMA_VERSION } from "../contracts/schema-version";
import { contentHashMatches } from "../governance/content-hash";

export type RegistryAcceptResult =
  | { readonly ok: true; readonly component: PublishedDiagnosticLearningComponent }
  | { readonly ok: false; readonly error: { readonly code: "MALFORMED_COMPONENT" | "UNSUPPORTED_SCHEMA" | "NOT_PUBLISHED" | "CONTENT_HASH_MISMATCH"; readonly message: string; readonly issues?: readonly string[] } };

export interface DiagnosticComponentRepository {
  reset(): void;
  list(): readonly PublishedDiagnosticLearningComponent[];
  get(id: string): PublishedDiagnosticLearningComponent | null;
  manifest(): {
    readonly protocolVersion: "1.0.0";
    readonly generatedAt: string;
    readonly components: readonly { readonly id: string; readonly version: string; readonly schemaVersion: string; readonly contentHash: string }[];
  };
  put(component: PublishedDiagnosticLearningComponent): PublishedDiagnosticLearningComponent;
}

export function acceptPublishedDiagnosticComponent(repository: DiagnosticComponentRepository, value: unknown): RegistryAcceptResult {
  if (typeof value === "object" && value !== null) {
    const raw = value as Record<string, unknown>;
    if (raw.schemaVersion !== undefined && raw.schemaVersion !== COMPONENT_SCHEMA_VERSION) return { ok: false, error: { code: "UNSUPPORTED_SCHEMA", message: `Schema ${String(raw.schemaVersion)} is unsupported.` } };
    if (raw.status !== undefined && raw.status !== "PUBLISHED") return { ok: false, error: { code: "NOT_PUBLISHED", message: "The local registry only accepts PUBLISHED snapshots." } };
  }
  const parsed = publishedDiagnosticLearningComponentSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: { code: "MALFORMED_COMPONENT", message: "The component does not satisfy the canonical published schema.", issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) } };
  const component = parsed.data as PublishedDiagnosticLearningComponent;
  if (!contentHashMatches(component)) return { ok: false, error: { code: "CONTENT_HASH_MISMATCH", message: "The component content does not match its publication hash." } };
  return { ok: true, component: repository.put(component) };
}

function versionParts(version: string): readonly number[] {
  return version.split(".").map(Number);
}

function compareVersion(left: string, right: string): number {
  const a = versionParts(left); const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

export class LocalShowcaseComponentRepository implements DiagnosticComponentRepository {
  private readonly initial: readonly PublishedDiagnosticLearningComponent[];
  private components: PublishedDiagnosticLearningComponent[];

  constructor(initial: readonly PublishedDiagnosticLearningComponent[]) {
    this.initial = initial.map((item) => structuredClone(item));
    this.components = this.initial.map((item) => structuredClone(item));
  }

  reset(): void { this.components = this.initial.map((item) => structuredClone(item)); }

  list(): readonly PublishedDiagnosticLearningComponent[] {
    return this.components.map((item) => structuredClone(item));
  }

  get(id: string): PublishedDiagnosticLearningComponent | null {
    const matches = this.components.filter((item) => item.id === id).sort((left, right) => compareVersion(right.version, left.version));
    return matches[0] ? structuredClone(matches[0]) : null;
  }

  manifest() {
    return {
      protocolVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      components: this.components.map((item) => ({ id: item.id, version: item.version, schemaVersion: item.schemaVersion, contentHash: item.publication.contentHash })),
    } as const;
  }

  put(component: PublishedDiagnosticLearningComponent): PublishedDiagnosticLearningComponent {
    const key = `${component.id}@${component.version}`;
    this.components = [...this.components.filter((item) => `${item.id}@${item.version}` !== key), structuredClone(component)];
    return structuredClone(component);
  }

  accept(value: unknown): RegistryAcceptResult { return acceptPublishedDiagnosticComponent(this, value); }
}

export { LocalShowcaseComponentRepository as DemoRegistryStore };
