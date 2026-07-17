import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const scannedRoots = [
  "src/core/domain",
  "src/core/application",
  "src/core/ports",
] as const;

const packTerms = [
  /\bcaie\b/iu,
  /\b9701\b/u,
  /\bchemistry\b/iu,
  /\bmgo\b/iu,
  /\bcalculation[\s_-]*famil(?:y|ies)\b/iu,
  /\bstandard[\s_-]*trainer\b/iu,
] as const;

const packFieldNames = new Set([
  "examboard",
  "syllabuscode",
  "calculationfamily",
  "calculationfamilyid",
  "stoichiometricratio",
]);

export type CoreLeakageCategory =
  | "IMPORT_GRAPH"
  | "REQUIRED_PUBLIC_FIELD"
  | "CORE_DISCRIMINATED_UNION"
  | "RUNTIME_DEPENDENCY"
  | "SCHEMA_DEPENDENCY";

export interface CoreLeakageViolation {
  readonly path: string;
  readonly symbol: string;
  readonly category: CoreLeakageCategory;
  readonly reason: string;
}

export interface CoreLeakageAllowlist {
  readonly schemaVersion: "1.0.0";
  readonly maximumEntries: number;
  readonly entries: readonly (CoreLeakageViolation & {
    readonly removalTarget: string;
  })[];
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function containsPackTerm(value: string): boolean {
  return packTerms.some((term) => term.test(value));
}

function isCoreRelativeImport(path: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const target = resolve("/", dirname(path), specifier);
  const coreRoot = resolve("/", "src/core");
  return target === coreRoot || target.startsWith(`${coreRoot}${sep}`);
}

export function analyzeCoreSource(path: string, source: string): readonly CoreLeakageViolation[] {
  const violations: CoreLeakageViolation[] = [];

  function add(category: CoreLeakageCategory, symbol: string, reason: string): void {
    if (!violations.some((item) => item.category === category && item.symbol === symbol)) {
      violations.push({ path, category, symbol, reason });
    }
  }

  const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? "";
    if (!isCoreRelativeImport(path, specifier)) {
      add("IMPORT_GRAPH", specifier, "Core production modules may import only other Core modules.");
    }
    if (/(?:^|\/)(?:runtime|agent|components|reference-packs|standards)(?:\/|$)/u.test(specifier)) {
      add("RUNTIME_DEPENDENCY", specifier, "Core must not depend on a Runtime, Agent, Pack or implementation Adapter.");
    }
    if (/\.json$/u.test(specifier) || specifier === "zod") {
      add("SCHEMA_DEPENDENCY", specifier, "Core contracts must not be defined by implementation configuration or validation schemas.");
    }
  }

  const propertyPattern = /\b(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/gu;
  for (const match of source.matchAll(propertyPattern)) {
    const name = match[1] ?? "";
    if (packFieldNames.has(normalized(name))) {
      add("REQUIRED_PUBLIC_FIELD", name, "Core public contracts must not require a Pack-specific field.");
    }
  }

  const literalPattern = /(?:^|[=|:,(\[]\s*)["']([^"'\r\n]+)["'](?=\s*(?:[|;,\])}]|$))/gmu;
  for (const match of source.matchAll(literalPattern)) {
    const literal = match[1] ?? "";
    if (containsPackTerm(literal)) {
      add("CORE_DISCRIMINATED_UNION", literal, "Core discriminated unions must remain domain-neutral.");
    }
  }

  return violations;
}

async function typescriptFiles(directory: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return typescriptFiles(path);
      return entry.isFile() && path.endsWith(".ts") ? [path] : [];
    }));
    return nested.flat();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

function allowlistKey(item: Pick<CoreLeakageViolation, "path" | "symbol" | "category">): string {
  return `${item.path}\u0000${item.symbol}\u0000${item.category}`;
}

export async function auditCoreArchitecture(repositoryRoot: string) {
  const allowlist = JSON.parse(
    await readFile(resolve(repositoryRoot, "known-core-chemistry-leakages.json"), "utf8"),
  ) as CoreLeakageAllowlist;
  if (allowlist.schemaVersion !== "1.0.0" || !Number.isInteger(allowlist.maximumEntries) || allowlist.maximumEntries < 0) {
    throw new Error("INVALID_CORE_LEAKAGE_ALLOWLIST");
  }
  if (allowlist.entries.length > allowlist.maximumEntries) {
    throw new Error("CORE_LEAKAGE_ALLOWLIST_GROWTH_REQUIRES_REVIEW");
  }
  const allowed = new Set(allowlist.entries.map(allowlistKey));
  const files = (await Promise.all(scannedRoots.map((root) => typescriptFiles(resolve(repositoryRoot, root))))).flat();
  const violations = (await Promise.all(files.map(async (absolutePath) => {
    const path = relative(repositoryRoot, absolutePath).split(sep).join("/");
    return analyzeCoreSource(path, await readFile(absolutePath, "utf8"));
  }))).flat().filter((violation) => !allowed.has(allowlistKey(violation)));

  return { scannedRoots: [...scannedRoots], violations, allowlist } as const;
}
