export type ComponentExecutorEnvironment = {
  NODE_ENV?: string;
  COMPONENT_EXECUTOR_PRODUCT_DATABASE_URL?: string;
  COMPONENT_EXECUTOR_DATABASE_URL?: string;
  COMPONENT_EXECUTOR_SERVICE_TOKEN?: string;
  COMPONENT_EXECUTOR_HOST?: string;
  COMPONENT_EXECUTOR_PORT?: string;
};

function databaseIdentity(rawUrl: string): string {
  const url = new URL(rawUrl);
  return `${url.protocol}//${url.username}@${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

export function resolveComponentExecutorServiceConfig(environment: ComponentExecutorEnvironment = process.env) {
  const productDatabaseUrl = environment.COMPONENT_EXECUTOR_PRODUCT_DATABASE_URL;
  const executorDatabaseUrl = environment.COMPONENT_EXECUTOR_DATABASE_URL;
  const token = environment.COMPONENT_EXECUTOR_SERVICE_TOKEN;
  if (!productDatabaseUrl) throw new Error("COMPONENT_EXECUTOR_PRODUCT_DATABASE_URL is required by the separate executor process");
  if (!executorDatabaseUrl) throw new Error("COMPONENT_EXECUTOR_DATABASE_URL is required by the separate executor process");
  if (!token || token.length < 32) throw new Error("COMPONENT_EXECUTOR_SERVICE_TOKEN must contain at least 32 characters");
  if (environment.NODE_ENV === "production" && databaseIdentity(productDatabaseUrl) === databaseIdentity(executorDatabaseUrl)) {
    throw new Error("The executor write identity must be distinct from its product read identity in production");
  }
  const port = Number.parseInt(environment.COMPONENT_EXECUTOR_PORT ?? "3202", 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("COMPONENT_EXECUTOR_PORT must be a valid port");
  return {
    productDatabaseUrl,
    executorDatabaseUrl,
    token,
    host: environment.COMPONENT_EXECUTOR_HOST ?? "127.0.0.1",
    port,
  };
}
