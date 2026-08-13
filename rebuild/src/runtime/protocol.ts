import { z } from "zod";
import { FOUNDRY_COMPONENT_PROTOCOL_VERSION } from "../core/component";

export const FOUNDRY_COMPONENT_PROTOCOL = "foundry-component" as const;

const common = {
  protocol: z.literal(FOUNDRY_COMPONENT_PROTOCOL),
  protocolVersion: z.literal(FOUNDRY_COMPONENT_PROTOCOL_VERSION),
  messageId: z.string().min(1),
  runtimeSessionId: z.string().min(1),
  timestamp: z.string().datetime(),
} as const;

const emptyPayload = z.object({}).strict();

export const FoundryComponentMessage = z.discriminatedUnion("type", [
  z.object({
    ...common,
    type: z.literal("FOUNDRY_INIT"),
    payload: z.object({
      capability: z.object({ id: z.string().min(1), version: z.string().min(1) }).strict(),
      parameters: z.record(z.string(), z.unknown()).default({}),
      initialState: z.unknown().nullable().optional(),
    }).strict(),
  }).strict(),
  z.object({ ...common, type: z.literal("FOUNDRY_PAUSE"), payload: emptyPayload }).strict(),
  z.object({ ...common, type: z.literal("FOUNDRY_RESUME"), payload: emptyPayload }).strict(),
  z.object({ ...common, type: z.literal("FOUNDRY_RESET"), payload: emptyPayload }).strict(),
  z.object({
    ...common,
    type: z.literal("FOUNDRY_RESTORE"),
    payload: z.object({ state: z.unknown() }).strict(),
  }).strict(),
  z.object({
    ...common,
    type: z.literal("COMPONENT_READY"),
    payload: z.object({ supportedProtocolVersions: z.array(z.string().min(1)).min(1) }).strict(),
  }).strict(),
  z.object({ ...common, type: z.literal("COMPONENT_INITIALIZED"), payload: emptyPayload }).strict(),
  z.object({
    ...common,
    type: z.literal("LEARNING_EVENT"),
    payload: z.object({ eventName: z.string().min(1), data: z.unknown() }).strict(),
  }).strict(),
  z.object({
    ...common,
    type: z.literal("ATTEMPT_SUBMITTED"),
    payload: z.object({
      attemptId: z.string().min(1).optional(),
      response: z.unknown(),
      stateSnapshot: z.unknown().optional(),
      assistance: z.unknown().optional(),
    }).strict(),
  }).strict(),
  z.object({
    ...common,
    type: z.literal("STATE_CHANGED"),
    payload: z.object({ state: z.unknown() }).strict(),
  }).strict(),
  z.object({
    ...common,
    type: z.literal("COMPONENT_COMPLETED"),
    payload: z.object({ completionReason: z.string().min(1).optional(), finalState: z.unknown().optional() }).strict(),
  }).strict(),
  z.object({
    ...common,
    type: z.literal("COMPONENT_ERROR"),
    payload: z.object({
      code: z.string().min(1),
      message: z.string().min(1),
      recoverable: z.boolean(),
      details: z.unknown().optional(),
    }).strict(),
  }).strict(),
]);

export type FoundryComponentMessage = z.infer<typeof FoundryComponentMessage>;

export function parseFoundryComponentMessage(input: unknown): FoundryComponentMessage {
  return FoundryComponentMessage.parse(input);
}

export function isComponentToFoundryMessage(message: FoundryComponentMessage): boolean {
  return message.type.startsWith("COMPONENT_")
    || message.type === "LEARNING_EVENT"
    || message.type === "ATTEMPT_SUBMITTED"
    || message.type === "STATE_CHANGED";
}
