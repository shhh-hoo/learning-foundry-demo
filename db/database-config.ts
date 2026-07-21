export type DatabaseEnvironment = {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  PRODUCT_DATABASE_URL?: string;
  CHECKPOINT_DATABASE_URL?: string;
  AUTH_DATABASE_URL?: string;
  WORKER_DATABASE_URL?: string;
  /** Forbidden in the product web process; declared only so configuration rejects it explicitly. */
  COMPONENT_EXECUTOR_DATABASE_URL?: string;
  MIGRATION_DATABASE_URL?: string;
  CHECKPOINT_MIGRATION_DATABASE_URL?: string;
};

export const RUNTIME_DATABASE_ROLES = {
  product: "foundry_product_runtime",
  auth: "foundry_auth_bootstrap",
  worker: "foundry_worker",
  componentExecutor: "foundry_component_executor",
  checkpoint: "foundry_checkpoint_runtime",
} as const;

export function withPostgresStartupSettings(rawUrl: string, settings: Record<string, string>): string {
  const url = new URL(rawUrl);
  const existing = url.searchParams.get("options")?.trim();
  const additions = Object.entries(settings).map(([name, value]) => {
    if (!/^[a-z][a-z0-9_.]*$/.test(name) || !/^[A-Za-z0-9_.:-]+$/.test(value)) {
      throw new Error(`Unsafe PostgreSQL startup setting: ${name}`);
    }
    return `-c ${name}=${value}`;
  });
  url.searchParams.set("options", [existing, ...additions].filter(Boolean).join(" "));
  return url.toString();
}

export function withRuntimeDatabaseRole(rawUrl: string, role: (typeof RUNTIME_DATABASE_ROLES)[keyof typeof RUNTIME_DATABASE_ROLES]): string {
  return withPostgresStartupSettings(rawUrl, { role });
}

function databaseIdentity(rawUrl: string): string {
  const url = new URL(rawUrl);
  return `${url.protocol}//${url.username}@${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

export function resolveDatabaseUrls(environment: DatabaseEnvironment = process.env): {
  productDatabaseUrl: string;
  checkpointDatabaseUrl: string;
} {
  const production = environment.NODE_ENV === "production";
  const productDatabaseUrl = environment.PRODUCT_DATABASE_URL ?? (production ? undefined : environment.DATABASE_URL);
  const checkpointDatabaseUrl = environment.CHECKPOINT_DATABASE_URL ?? (production ? undefined : environment.DATABASE_URL);

  if (!productDatabaseUrl) {
    throw new Error(production
      ? "PRODUCT_DATABASE_URL is required in production"
      : "PRODUCT_DATABASE_URL or DATABASE_URL is required for Product State");
  }
  if (!checkpointDatabaseUrl) {
    throw new Error(production
      ? "CHECKPOINT_DATABASE_URL is required in production"
      : "CHECKPOINT_DATABASE_URL or DATABASE_URL is required for LangGraph checkpoints");
  }
  if (production && databaseIdentity(productDatabaseUrl) === databaseIdentity(checkpointDatabaseUrl)) {
    throw new Error("PRODUCT_DATABASE_URL and CHECKPOINT_DATABASE_URL must use distinct database roles or targets in production");
  }
  return { productDatabaseUrl, checkpointDatabaseUrl };
}

function resolveDedicatedUrl(
  name: "AUTH_DATABASE_URL" | "WORKER_DATABASE_URL" | "MIGRATION_DATABASE_URL" | "CHECKPOINT_MIGRATION_DATABASE_URL",
  environment: DatabaseEnvironment,
  localFallback: string,
): string {
  const configured = environment[name];
  if (configured) return configured;
  if (environment.NODE_ENV === "production") throw new Error(`${name} is required in production`);
  return localFallback;
}

function assertDistinctProductionRole(name: string, value: string, others: Array<[string, string]>, environment: DatabaseEnvironment): void {
  if (environment.NODE_ENV !== "production") return;
  for (const [otherName, otherValue] of others) {
    if (databaseIdentity(value) === databaseIdentity(otherValue)) {
      throw new Error(`${name} must use a distinct database role or target from ${otherName} in production`);
    }
  }
}

export function resolveAuthorityDatabaseUrls(environment: DatabaseEnvironment = process.env) {
  if (environment.COMPONENT_EXECUTOR_DATABASE_URL) {
    throw new Error("COMPONENT_EXECUTOR_DATABASE_URL is forbidden in the product web process; run the separate Component Executor service instead");
  }
  const runtime = resolveDatabaseUrls(environment);
  const authDatabaseUrl = resolveDedicatedUrl("AUTH_DATABASE_URL", environment, runtime.productDatabaseUrl);
  const workerDatabaseUrl = resolveDedicatedUrl("WORKER_DATABASE_URL", environment, runtime.productDatabaseUrl);
  const migrationDatabaseUrl = resolveDedicatedUrl("MIGRATION_DATABASE_URL", environment, runtime.productDatabaseUrl);
  const checkpointMigrationDatabaseUrl = resolveDedicatedUrl("CHECKPOINT_MIGRATION_DATABASE_URL", environment, runtime.checkpointDatabaseUrl);

  assertDistinctProductionRole("AUTH_DATABASE_URL", authDatabaseUrl, [["PRODUCT_DATABASE_URL", runtime.productDatabaseUrl], ["CHECKPOINT_DATABASE_URL", runtime.checkpointDatabaseUrl]], environment);
  assertDistinctProductionRole("WORKER_DATABASE_URL", workerDatabaseUrl, [["PRODUCT_DATABASE_URL", runtime.productDatabaseUrl], ["AUTH_DATABASE_URL", authDatabaseUrl], ["CHECKPOINT_DATABASE_URL", runtime.checkpointDatabaseUrl]], environment);
  assertDistinctProductionRole("MIGRATION_DATABASE_URL", migrationDatabaseUrl, [["PRODUCT_DATABASE_URL", runtime.productDatabaseUrl], ["AUTH_DATABASE_URL", authDatabaseUrl], ["WORKER_DATABASE_URL", workerDatabaseUrl], ["CHECKPOINT_DATABASE_URL", runtime.checkpointDatabaseUrl]], environment);
  assertDistinctProductionRole("CHECKPOINT_MIGRATION_DATABASE_URL", checkpointMigrationDatabaseUrl, [["CHECKPOINT_DATABASE_URL", runtime.checkpointDatabaseUrl], ["PRODUCT_DATABASE_URL", runtime.productDatabaseUrl], ["AUTH_DATABASE_URL", authDatabaseUrl], ["WORKER_DATABASE_URL", workerDatabaseUrl], ["MIGRATION_DATABASE_URL", migrationDatabaseUrl]], environment);

  return { ...runtime, authDatabaseUrl, workerDatabaseUrl, migrationDatabaseUrl, checkpointMigrationDatabaseUrl };
}

/**
 * Production URLs identify distinct non-owning, non-superuser, NOINHERIT
 * logins, each granted only its matching NOLOGIN runtime group. Every runtime
 * connection still SETs that exact group role at startup.
 */
export function resolveRuntimeDatabaseUrls(environment: DatabaseEnvironment = process.env) {
  const authority = resolveAuthorityDatabaseUrls(environment);
  if (environment.NODE_ENV !== "production") return authority;
  return {
    ...authority,
    productDatabaseUrl: withRuntimeDatabaseRole(authority.productDatabaseUrl, RUNTIME_DATABASE_ROLES.product),
    checkpointDatabaseUrl: withRuntimeDatabaseRole(authority.checkpointDatabaseUrl, RUNTIME_DATABASE_ROLES.checkpoint),
    authDatabaseUrl: withRuntimeDatabaseRole(authority.authDatabaseUrl, RUNTIME_DATABASE_ROLES.auth),
    workerDatabaseUrl: withRuntimeDatabaseRole(authority.workerDatabaseUrl, RUNTIME_DATABASE_ROLES.worker),
  };
}
