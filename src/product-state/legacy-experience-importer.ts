import { createHash } from "node:crypto";
import { z } from "zod";
import type { ConversationEvent, LearningEpisode, LearningTask } from "../core/domain/learning";
import {
  PRODUCT_STATE_SCHEMA_VERSION,
  type CanonicalProductStateRepository,
  type LegacyImportReceipt,
  type LegacyProductStateBundle,
} from "../core/ports/product-state-repository";

interface Clock {
  now(): string;
}

const legacyMessageSchema = z.object({
  id: z.string().trim().min(1),
  role: z.enum(["USER", "AGENT"]),
  content: z.string(),
  inputOrigin: z.string().optional(),
  sourceRefs: z.array(z.string()).optional(),
});

const legacySnapshotSchema = z.object({
  conversationId: z.string().trim().min(1),
  messages: z.array(legacyMessageSchema),
  agentTraces: z.array(z.unknown()).default([]),
  diagnoses: z.array(z.unknown()).default([]),
  eventLog: z.array(z.unknown()).default([]),
  library: z.array(z.unknown()).default([]),
  schedule: z.array(z.unknown()).default([]),
  capabilityGaps: z.array(z.unknown()).default([]),
}).passthrough();

type LegacySnapshot = z.infer<typeof legacySnapshotSchema>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function buildBundle(
  snapshot: LegacySnapshot,
  goal: string,
  learnerId: string,
  importedBy: string,
  importedAt: string,
): LegacyProductStateBundle {
  const sourceKey = snapshot.conversationId;
  const sourceHash = digest({ goal, learnerId, snapshot });
  const keyHash = digest(sourceKey).slice(0, 24);
  const taskId = `legacy-task:${keyHash}`;
  const episodeId = `legacy-episode:${keyHash}`;
  const task: LearningTask = {
    id: taskId,
    learnerId,
    status: "ACTIVE",
    goal,
    createdAt: importedAt,
    updatedAt: importedAt,
    materialRefs: [],
  };
  const episode: LearningEpisode = {
    id: episodeId,
    taskId,
    status: "ACTIVE",
    startedAt: importedAt,
  };
  const seenMessageIds = new Set<string>();
  const conversationEvents: ConversationEvent[] = snapshot.messages.map((message, index) => {
    if (seenMessageIds.has(message.id)) throw new Error(`DUPLICATE_LEGACY_MESSAGE_ID: ${message.id}`);
    seenMessageIds.add(message.id);
    const payload: Record<string, unknown> = { content: message.content };
    if (message.inputOrigin) payload.inputOrigin = message.inputOrigin;
    if (message.sourceRefs?.length) payload.legacySourceRefs = message.sourceRefs;
    return {
      id: `legacy-event:${keyHash}:${message.id}`,
      taskId,
      episodeId,
      sequence: index + 1,
      occurredAt: importedAt,
      actor: message.role === "USER" ? "LEARNER" : "FOUNDRY",
      kind: "LEGACY_MESSAGE",
      payload,
      artifactRefs: [],
      sourceRefs: [],
      evidenceRefs: [],
    };
  });
  const receipt: LegacyImportReceipt = {
    schemaVersion: PRODUCT_STATE_SCHEMA_VERSION,
    id: `legacy-import:${keyHash}`,
    sourceSystem: "LEGACY_SHOWCASE",
    sourceKey,
    sourceHash,
    importedAt,
    importedBy,
    taskId,
    details: {
      importedMessageCount: conversationEvents.length,
      ignoredAgentTraceCount: snapshot.agentTraces.length,
      ignoredDiagnosisCount: snapshot.diagnoses.length,
      ignoredDemoEventCount: snapshot.eventLog.length,
      deferredLibraryCount: snapshot.library.length,
      deferredScheduleCount: snapshot.schedule.length,
      deferredCapabilityGapCount: snapshot.capabilityGaps.length,
    },
  };
  return {
    task,
    episode,
    conversationEvents,
    receipt,
    decision: {
      schemaVersion: PRODUCT_STATE_SCHEMA_VERSION,
      id: `decision:legacy-import:${keyHash}`,
      eventType: "LEGACY_SNAPSHOT_IMPORTED",
      actor: { actorId: importedBy, role: "SYSTEM" },
      aggregateType: "LEARNING_TASK",
      aggregateId: taskId,
      occurredAt: importedAt,
      details: { sourceSystem: receipt.sourceSystem, sourceKey, sourceHash },
    },
    outbox: {
      schemaVersion: PRODUCT_STATE_SCHEMA_VERSION,
      id: `outbox:legacy-import:${keyHash}`,
      eventType: "LEGACY_SNAPSHOT_IMPORTED",
      aggregateType: "LEARNING_TASK",
      aggregateId: taskId,
      occurredAt: importedAt,
      payload: { sourceSystem: receipt.sourceSystem, sourceKey, taskId },
    },
  };
}

export type LegacyImportResult =
  | { readonly status: "IMPORTED"; readonly receipt: LegacyImportReceipt }
  | { readonly status: "ALREADY_IMPORTED"; readonly receipt: LegacyImportReceipt };

export class LegacyExperienceImporter {
  constructor(
    private readonly repository: CanonicalProductStateRepository,
    private readonly clock: Clock = { now: () => new Date().toISOString() },
  ) {}

  async import(input: { readonly snapshot: unknown; readonly goal: string; readonly learnerId: string; readonly importedBy: string }): Promise<LegacyImportResult> {
    const snapshot = legacySnapshotSchema.parse(input.snapshot);
    const goal = input.goal.trim();
    const learnerId = input.learnerId.trim();
    const importedBy = input.importedBy.trim();
    if (!goal) throw new Error("LEGACY_IMPORT_GOAL_REQUIRED");
    if (!learnerId) throw new Error("LEGACY_IMPORT_LEARNER_REQUIRED");
    if (!importedBy) throw new Error("LEGACY_IMPORT_ACTOR_REQUIRED");
    const bundle = buildBundle(snapshot, goal, learnerId, importedBy, this.clock.now());
    const existing = await this.repository.getLegacyImportReceipt("LEGACY_SHOWCASE", bundle.receipt.sourceKey);
    if (existing) {
      if (existing.sourceHash !== bundle.receipt.sourceHash) throw new Error("LEGACY_IMPORT_HASH_CONFLICT");
      return { status: "ALREADY_IMPORTED", receipt: existing };
    }
    try {
      await this.repository.importLegacyBundle(bundle);
      return { status: "IMPORTED", receipt: bundle.receipt };
    } catch (error) {
      const raced = await this.repository.getLegacyImportReceipt("LEGACY_SHOWCASE", bundle.receipt.sourceKey);
      if (raced?.sourceHash === bundle.receipt.sourceHash) return { status: "ALREADY_IMPORTED", receipt: raced };
      if (raced) throw new Error("LEGACY_IMPORT_HASH_CONFLICT");
      throw error;
    }
  }
}
