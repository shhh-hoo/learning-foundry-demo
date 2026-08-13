export interface SourceRef {
  readonly id: string;
  readonly version?: string;
  readonly locator?: string;
}

export interface EvidenceRef {
  readonly id: string;
  readonly kind?: string;
  readonly sourceRef?: SourceRef;
}

/**
 * A small, persisted snapshot passed to orchestration. Foundry owns the
 * identity/provenance boundary; Dify may reason over the payload but does not
 * become the canonical store for learner or teacher state.
 */
export interface ContextSnapshot {
  readonly id: string;
  readonly taskId: string;
  readonly episodeId: string;
  readonly learnerContext: unknown;
  readonly teacherConstraints: unknown;
  readonly sourceRefs: readonly SourceRef[];
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly createdAt: string;
}
