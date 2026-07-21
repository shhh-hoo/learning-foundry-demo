import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { resolveComponentExecutorServiceConfig } from "@/component-executor/config";
import { EvaluateWebComponentDraftCommand, PreviewWebComponentDraftCommand } from "@/component-executor/protocol";
import { createComponentExecutorService } from "@/component-executor/service";
import { DomainInvariantError } from "@/domain/invariants";

function authorized(request: IncomingMessage, expectedToken: string): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 16_384) throw new DomainInvariantError("Component Executor command exceeds the bounded payload limit", "COMPONENT_EXECUTOR_PAYLOAD_REJECTED");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

export async function startComponentExecutorServer(environment = process.env) {
  const config = resolveComponentExecutorServiceConfig(environment);
  const service = createComponentExecutorService(environment);
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { status: "ok", service: "component-executor" });
      return;
    }
    if (request.method !== "POST" || !new Set(["/commands/evaluate", "/commands/preview"]).has(request.url ?? "")) {
      json(response, 404, { error: "Not found", code: "NOT_FOUND" });
      return;
    }
    if (!authorized(request, config.token)) {
      json(response, 401, { error: "Component Executor authentication failed", code: "COMPONENT_EXECUTOR_UNAUTHENTICATED" });
      return;
    }
    try {
      const body = await readJson(request);
      const result = request.url === "/commands/evaluate"
        ? await service.evaluate(EvaluateWebComponentDraftCommand.parse(body))
        : await service.preview(PreviewWebComponentDraftCommand.parse(body));
      json(response, 200, result);
    } catch (error) {
      if (error instanceof DomainInvariantError) {
        json(response, error.code === "TENANT_ISOLATION" || error.code.includes("FORBIDDEN") ? 403 : 422, { error: error.message, code: error.code });
      } else if (error instanceof ZodError || error instanceof SyntaxError) {
        json(response, 400, { error: "Only the canonical Component Executor command contract is accepted", code: "COMPONENT_EXECUTOR_PAYLOAD_REJECTED" });
      } else if (error && typeof error === "object" && "code" in error && "message" in error
        && typeof error.code === "string" && typeof error.message === "string"
        && new Set(["23505", "23514", "42501"]).has(error.code)) {
        json(response, error.code === "42501" ? 403 : 422, {
          error: error.message,
          code: error.code === "23505" ? "COMPONENT_EXECUTOR_REPLAY_MISMATCH" : error.code === "42501" ? "COMPONENT_EXECUTOR_DATABASE_DENIED" : "COMPONENT_EXECUTOR_INTEGRITY",
        });
      } else {
        console.error(error);
        json(response, 500, { error: "Component Executor failed", code: "COMPONENT_EXECUTOR_FAILED" });
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  console.log(JSON.stringify({ service: "component-executor", status: "listening", host: config.host, port }));
  const close = async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await service.close();
  };
  process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
  process.once("SIGINT", () => void close().finally(() => process.exit(0)));
  return { server, service, port, close };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await startComponentExecutorServer();
