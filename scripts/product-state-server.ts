import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ProductStateApi } from "../src/product-state/product-state-api";
import { ProductStateService } from "../src/product-state/product-state-service";
import { resolveProductStateConfiguration } from "../src/product-state/product-state-mode";
import { createPostgresProductStateRepository } from "../src/product-state/postgres-product-state-repository";

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 1_000_000) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(value);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const configuration = resolveProductStateConfiguration(process.env);
if (configuration.mode !== "POSTGRES_CANONICAL") throw new Error("CANONICAL_API_DISABLED_IN_LEGACY_SHOWCASE");
const connection = createPostgresProductStateRepository(configuration.databaseUrl);
const health = await connection.repository.health();
if (!health.ready) {
  await connection.close();
  throw new Error(`PRODUCT_STATE_DATABASE_NOT_READY: migration ${health.schemaVersion ?? "none"}`);
}
if (!await connection.repository.getCutoverAcceptance(configuration.environment)) {
  await connection.close();
  throw new Error(`PRODUCT_STATE_CUTOVER_ACCEPTANCE_REQUIRED: ${configuration.environment}`);
}

const api = new ProductStateApi(new ProductStateService(connection.repository), connection.repository);
const port = Number(process.env.PRODUCT_STATE_PORT ?? "4180");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("INVALID_PRODUCT_STATE_PORT");

const server = createServer(async (request, response) => {
  try {
    const headers: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(request.headers)) headers[name] = Array.isArray(value) ? value[0] : value;
    const result = await api.handle({
      method: request.method ?? "GET",
      path: new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname,
      headers,
      body: request.method === "POST" ? await readBody(request) : undefined,
    });
    json(response, result.status, result.body);
  } catch (error) {
    json(response, 400, { ok: false, error: { code: error instanceof SyntaxError ? "INVALID_JSON" : "INVALID_REQUEST" } });
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Canonical Product State API: http://127.0.0.1:${port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => connection.close().finally(() => process.exit(0))));
}
