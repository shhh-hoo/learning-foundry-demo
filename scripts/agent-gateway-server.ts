import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createDeepSeekClient } from "../src/agent/deepseek-client.ts";
import { createAgentGateway } from "../src/agent/gateway.ts";
import { runAgent } from "../src/agent/run-agent.ts";
import { createAgentToolExecutor, type CapabilityRecord, type LearningResource } from "../src/agent/tool-executor.ts";

const root = new URL("../", import.meta.url);
const readText = (path: string) => readFile(new URL(path, root), "utf8");
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readText(path)) as T;
const apiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
const model = process.env.DEEPSEEK_MODEL?.trim() ?? "";
const baseUrl = process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com";
const thinkingMode = process.env.DEEPSEEK_THINKING_MODE === "enabled" ? "enabled" : "disabled";
const port = Number(process.env.AGENT_GATEWAY_PORT ?? 4176);
const capabilities = await readJson<{ readonly version: string; readonly capabilities: readonly CapabilityRecord[] }>("config/capabilities/registry.json");
const resources = await readJson<{ readonly resources: readonly LearningResource[] }>("config/resources/learning-resources.json");
const toolConfig = await readJson<{ readonly version: string; readonly tools: readonly unknown[] }>("config/tools/tool-descriptions.json");
const responsePolicy = await readText("config/agent/response-policy.json");
const systemPrompt = `${await readText("config/agent/instructions.md")}\nResponse policy: ${responsePolicy}`;
const configured = Boolean(apiKey && model);
const client = configured ? createDeepSeekClient({ apiKey, model, baseUrl, thinkingMode }) : null;
const tools = createAgentToolExecutor({ capabilities: capabilities.capabilities, resources: resources.resources, diagnosisUrl: "http://127.0.0.1:4177/diagnose" });
const gateway = createAgentGateway({
  configured,
  model: model || null,
  thinkingMode,
  ...(client ? { run: async (request) => {
    const toolResults: { readonly name: string; readonly resultRef: string; readonly data: unknown }[] = [];
    const trace = await runAgent({ request, model, thinkingMode, systemPrompt, promptVersion: "1.0.0", capabilityRegistryVersion: capabilities.version, toolDefinitions: toolConfig.tools, modelClient: client, tools, onToolResult: (result) => toolResults.push(result) });
    return { trace, toolResults };
  } } : {}),
});

const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const webRequest = new Request(`http://127.0.0.1:${port}${request.url ?? "/"}`, { method: request.method, headers: request.headers as HeadersInit, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
  const result = await gateway.handle(webRequest);
  response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
  response.end(Buffer.from(await result.arrayBuffer()));
});

server.listen(port, "127.0.0.1", () => console.log(`DeepSeek Agent Gateway listening on http://127.0.0.1:${port} · configured=${configured}`));
