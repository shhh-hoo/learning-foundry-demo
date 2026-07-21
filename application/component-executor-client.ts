import { z } from "zod";
import type { Actor } from "@/domain/model";
import { DomainInvariantError } from "@/domain/invariants";
import {
  ComponentEvaluationReceipt,
  ComponentPreviewReceipt,
  EvaluateWebComponentDraftCommand,
  PreviewWebComponentDraftCommand,
} from "@/component-executor/protocol";

type WebExecutorEnvironment = {
  COMPONENT_EXECUTOR_DATABASE_URL?: string;
  COMPONENT_EXECUTOR_SERVICE_URL?: string;
  COMPONENT_EXECUTOR_SERVICE_TOKEN?: string;
};

export function resolveComponentExecutorClientConfig(environment: WebExecutorEnvironment = process.env as WebExecutorEnvironment) {
  if (environment.COMPONENT_EXECUTOR_DATABASE_URL) {
    throw new Error("The product web process must not receive COMPONENT_EXECUTOR_DATABASE_URL");
  }
  const endpoint = environment.COMPONENT_EXECUTOR_SERVICE_URL;
  const token = environment.COMPONENT_EXECUTOR_SERVICE_TOKEN;
  if (!endpoint || !token || token.length < 32) {
    throw new Error("Component Executor service URL and a token of at least 32 characters are required");
  }
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Component Executor service URL must use HTTP or HTTPS");
  return { endpoint: parsed.toString().replace(/\/$/, ""), token };
}

function actorClaim(actor: Actor) {
  return {
    userId: actor.userId,
    institutionId: actor.institutionId,
    authMethod: actor.authMethod,
    sessionId: actor.sessionId,
  };
}

async function executeCommand<T>(path: string, command: unknown, responseSchema: z.ZodType<T>): Promise<T> {
  const config = resolveComponentExecutorClientConfig();
  let response: Response;
  try {
    response = await fetch(`${config.endpoint}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
      cache: "no-store",
    });
  } catch (error) {
    throw new DomainInvariantError(
      `Component Executor service is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      "COMPONENT_EXECUTOR_UNAVAILABLE",
    );
  }
  const body = await response.json().catch(() => null) as { error?: unknown; code?: unknown } | null;
  if (!response.ok) {
    throw new DomainInvariantError(
      typeof body?.error === "string" ? body.error : "Component Executor command failed",
      typeof body?.code === "string" ? body.code : "COMPONENT_EXECUTOR_FAILED",
    );
  }
  return responseSchema.parse(body);
}

export function requestWebComponentEvaluation(actor: Actor, input: { componentVersionId: string; expectedContentHash: string }) {
  const command = EvaluateWebComponentDraftCommand.parse({
    command: "EVALUATE_WEB_COMPONENT_DRAFT",
    actor: actorClaim(actor),
    ...input,
  });
  return executeCommand("/commands/evaluate", command, ComponentEvaluationReceipt);
}

export function requestWebComponentPreview(actor: Actor, input: { componentId: string; componentVersionId: string; expectedContentHash: string; selectedChoiceId: string; idempotencyKey: string }) {
  const command = PreviewWebComponentDraftCommand.parse({
    command: "PREVIEW_WEB_COMPONENT_DRAFT",
    actor: actorClaim(actor),
    ...input,
  });
  return executeCommand("/commands/preview", command, ComponentPreviewReceipt);
}
