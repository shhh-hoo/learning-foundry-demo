import type { DiagnosticLearningComponent, PublishedDiagnosticLearningComponent } from "../contracts/diagnostic-component";
import type { FoundryEvaluationReport } from "./evaluation";
import { incrementVersion, publishApprovedComponent } from "./publishing";

export type ComponentLifecycleState = "EMPTY" | "DRAFT" | "EVALUATION_FAILED" | "READY_FOR_REVIEW" | "APPROVED" | "PUBLISHED" | "REVISION_DRAFT";

export class ComponentLifecycle {
  private component: DiagnosticLearningComponent | null = null;
  private evaluation: FoundryEvaluationReport | null = null;
  private state: ComponentLifecycleState = "EMPTY";
  private published: PublishedDiagnosticLearningComponent | null = null;

  get snapshot() { return { component: this.component, evaluation: this.evaluation, state: this.state, published: this.published } as const; }

  author(component: DiagnosticLearningComponent): void {
    this.component = structuredClone({ ...component, status: "DRAFT", review: undefined, publication: undefined });
    this.evaluation = null;
    this.state = this.published ? "REVISION_DRAFT" : "DRAFT";
  }

  edit(mutator: (component: DiagnosticLearningComponent) => DiagnosticLearningComponent): void {
    if (!this.component) throw new Error("No component is being authored.");
    this.component = { ...mutator(structuredClone(this.component)), status: "DRAFT", review: undefined, publication: undefined };
    this.evaluation = null;
    this.state = this.published ? "REVISION_DRAFT" : "DRAFT";
  }

  recordEvaluation(report: FoundryEvaluationReport): void {
    if (!this.component) throw new Error("No component is being authored.");
    this.evaluation = report;
    this.state = report.outcome === "PASSED" ? "READY_FOR_REVIEW" : "EVALUATION_FAILED";
  }

  approve(review: NonNullable<DiagnosticLearningComponent["review"]>): void {
    if (!this.component || this.evaluation?.outcome !== "PASSED") throw new Error("A passing Foundry evaluation is required before approval.");
    this.component = { ...this.component, status: "APPROVED", review };
    this.state = "APPROVED";
  }

  reject(notes: string): void {
    if (!this.component) throw new Error("No component is being reviewed.");
    this.component = { ...this.component, status: "DRAFT", review: undefined };
    this.evaluation = null;
    this.state = "DRAFT";
    if (!notes.trim()) throw new Error("Rejection notes are required.");
  }

  publish(publication: { readonly publishedAt: string; readonly publishedBy: string }): PublishedDiagnosticLearningComponent {
    if (!this.component || this.state !== "APPROVED") throw new Error("An approved component is required before publication.");
    this.published = publishApprovedComponent(this.component, publication);
    this.component = this.published;
    this.state = "PUBLISHED";
    return this.published;
  }

  createRevision(change: "CONTENT" | "METADATA" | "SCHEMA_BREAKING" = "CONTENT"): DiagnosticLearningComponent {
    if (!this.published) throw new Error("A published snapshot is required before revision.");
    const revision = { ...structuredClone(this.published), version: incrementVersion(this.published.version, change), status: "DRAFT" as const, review: undefined, publication: undefined };
    this.component = revision;
    this.evaluation = null;
    this.state = "REVISION_DRAFT";
    return revision;
  }
}

