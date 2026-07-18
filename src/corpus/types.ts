export type CorpusSourceType = "OFFICIAL_SYLLABUS" | "SECONDARY_REFERENCE" | "TEACHER_NOTE" | "STRUCTURED_CASE";
export type DistributionScope = "SCHOOL_INTERNAL" | "PUBLIC";

export interface CorpusSearchFilters {
  readonly examBoard?: "CAIE";
  readonly syllabusCode?: "9701";
  readonly syllabusVersion?: string;
  readonly level?: "AS" | "A" | "AS_A";
  readonly topic?: string;
  readonly calculationFamilyId?: string;
  readonly learningOutcomeId?: string;
  readonly sourceType?: CorpusSourceType;
  readonly distributionScope?: DistributionScope;
}

export interface CorpusSearchResult {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly sourceType: CorpusSourceType;
  readonly distributionScope: DistributionScope;
  readonly title: string;
  readonly excerpt: string;
  readonly syllabusCode: "9701";
  readonly syllabusVersion?: string;
  readonly learningOutcomeIds: readonly string[];
  readonly calculationFamilyIds: readonly string[];
  readonly page?: number;
  readonly section?: string;
  readonly score: number;
}

export interface CorpusSearchResponse {
  readonly retrievalTraceId: string;
  readonly query: string;
  readonly filters: CorpusSearchFilters;
  readonly results: readonly CorpusSearchResult[];
}

export interface CorpusSearchService {
  search(query: string, filters: CorpusSearchFilters, context?: { readonly conversationId?: string; readonly conversationEvidenceHash?: string; readonly route?: string; readonly executionRole?: "AUTHORITATIVE" | "SHADOW" }, signal?: AbortSignal): Promise<CorpusSearchResponse>;
}

export interface CorpusChunk {
  readonly chunkId: string;
  readonly documentId: string;
  readonly sourceType: CorpusSourceType;
  readonly distributionScope: DistributionScope;
  readonly title: string;
  readonly text: string;
  readonly contextualText?: string;
  readonly examBoard: "CAIE";
  readonly syllabusCode: "9701";
  readonly syllabusVersion?: string;
  readonly level?: "AS" | "A" | "AS_A";
  readonly topic: string;
  readonly calculationFamilyIds?: readonly string[];
  readonly learningOutcomeIds?: readonly string[];
  readonly documentPage?: number;
  readonly printedPage?: number;
  readonly section?: string;
  readonly rights?: {
    readonly publicExportAllowed: boolean;
    readonly maxQuoteWords?: number;
    readonly attribution?: string;
  };
  readonly contentHash: string;
}

export interface CorpusSourceStatus {
  readonly sourceId: string;
  readonly sourceType: CorpusSourceType;
  readonly distributionScope: DistributionScope;
  readonly expectedLocalFilename?: string;
  readonly status: "REGISTERED" | "MISSING";
  readonly contentHash?: string;
}

export interface CorpusIndexManifest {
  readonly schemaVersion: "1.0.0";
  readonly corpusId: string;
  readonly indexVersion: string;
  readonly indexHash: string;
  readonly createdAt: string;
  readonly sourceManifestHash: string;
  readonly chunksFile: string;
  readonly chunksHash: string;
  readonly chunkCount: number;
  readonly chunkCounts: Readonly<Record<string, number>>;
  readonly sources: readonly CorpusSourceStatus[];
}
