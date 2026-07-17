export interface SourceReference {
  readonly referenceClass: "SOURCE";
  readonly sourceId: string;
  readonly sourceVersion?: string;
}

export interface EvidenceReference {
  readonly referenceClass: "EVIDENCE";
  readonly evidenceUnitId: string;
  readonly provenanceId: string;
}

export type LearningReference = SourceReference | EvidenceReference;

export interface EvidenceSource {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly authority: "PRIMARY" | "SECONDARY" | "INSTITUTIONAL" | "LEARNER_PROVIDED" | "OTHER_REVIEWED";
  readonly rights: {
    readonly licenseId: string;
    readonly distributionScope: string;
    readonly deliveryPolicyId: string;
  };
  readonly contentHash: string;
}

export interface EvidenceUnit {
  readonly id: string;
  readonly version: string;
  readonly modality:
    | "TEXT"
    | "TABLE"
    | "FIGURE"
    | "DIAGRAM"
    | "QUESTION"
    | "RUBRIC"
    | "EXAMPLE"
    | "LEARNER_WORK"
    | "AUDIO"
    | "VIDEO_SEGMENT"
    | "INTERACTIVE_RESOURCE";
  readonly sourceRefs: readonly SourceReference[];
  readonly contentHash: string;
  readonly location?: {
    readonly page?: number;
    readonly region?: string;
    readonly timeRange?: readonly [number, number];
  };
}

export interface ArtifactReference {
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly contentHash: string;
}

function requireId(value: string, label: string): string {
  const id = value.trim();
  if (!id) throw new Error(`INVALID_REFERENCE: ${label} is required.`);
  return id;
}

export function createSourceReference(sourceId: string, sourceVersion?: string): SourceReference {
  return {
    referenceClass: "SOURCE",
    sourceId: requireId(sourceId, "sourceId"),
    ...(sourceVersion === undefined ? {} : { sourceVersion: requireId(sourceVersion, "sourceVersion") }),
  };
}

export function createEvidenceReference(evidenceUnitId: string, provenanceId: string): EvidenceReference {
  return {
    referenceClass: "EVIDENCE",
    evidenceUnitId: requireId(evidenceUnitId, "evidenceUnitId"),
    provenanceId: requireId(provenanceId, "provenanceId"),
  };
}

