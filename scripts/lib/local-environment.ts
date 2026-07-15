const allowed = new Set(["DEEPSEEK_API_KEY", "DEEPSEEK_MODEL", "DEEPSEEK_BASE_URL", "DEEPSEEK_THINKING_MODE", "TRACE_STORE_DIR", "PRODUCT_TRACE_STORE_DIR", "AGENT_EVAL_TRACE_STORE_DIR", "DIAGNOSIS_TRACE_STORE_DIR", "PRODUCT_DIAGNOSIS_STORE_DIR", "AGENT_EVAL_DIAGNOSIS_STORE_DIR", "AGENT_EVAL_STORE_DIR"]);

export function parseLocalEnvironment(contents: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const values: NodeJS.ProcessEnv = {};
  for (const key of allowed) if (base[key] !== undefined) values[key] = base[key];
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim(); if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line); if (!match || !allowed.has(match[1]!)) continue;
    const key = match[1]!; if (base[key] !== undefined) continue;
    const raw = match[2]!.trim();
    values[key] = raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) ? raw.slice(1, -1) : raw;
  }
  return values;
}
