import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { publishedComponents } from "../src/components/published";
import { acceptPublishedDiagnosticComponent, LocalShowcaseComponentRepository, type DiagnosticComponentRepository } from "../src/demo-registry/registry-store";

const port = 4175;
const allowedOrigins = new Set([
  "http://127.0.0.1:4173", "http://localhost:4173",
  "http://127.0.0.1:4174", "http://localhost:4174",
]);
const store: DiagnosticComponentRepository = new LocalShowcaseComponentRepository(publishedComponents);

function json(response: ServerResponse, status: number, body: unknown, origin?: string): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  if (origin && allowedOrigins.has(origin)) response.setHeader("access-control-allow-origin", origin);
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 1_000_000) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
  if (origin && !allowedOrigins.has(origin)) return json(response, 403, { ok: false, error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin is not allowed." } });
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    if (origin) response.setHeader("access-control-allow-origin", origin);
    response.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
    return response.end();
  }
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, service: "learning-foundry-demo-registry", protocolVersion: "1.0.0" }, origin);
  if (request.method === "GET" && url.pathname === "/manifest") return json(response, 200, await store.manifest(), origin);
  if (request.method === "GET" && url.pathname === "/components") return json(response, 200, { ok: true, components: await store.list() }, origin);
  if (request.method === "GET" && url.pathname.startsWith("/components/")) {
    const component = await store.get(decodeURIComponent(url.pathname.slice("/components/".length)));
    return component ? json(response, 200, { ok: true, component }, origin) : json(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Component was not found." } }, origin);
  }
  if (request.method === "POST" && url.pathname === "/components") {
    try {
      const result = await acceptPublishedDiagnosticComponent(store, await readJson(request));
      return json(response, result.ok ? 201 : 422, result, origin);
    } catch (error) {
      return json(response, 400, { ok: false, error: { code: "INVALID_JSON", message: error instanceof Error ? error.message : "Invalid JSON body." } }, origin);
    }
  }
  if (request.method === "DELETE" && url.pathname === "/session") {
    await store.reset();
    return json(response, 200, { ok: true, reset: true }, origin);
  }
  return json(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Route was not found." } }, origin);
});

server.listen(port, "127.0.0.1", () => console.log(`Local Demo Registry: http://127.0.0.1:${port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
