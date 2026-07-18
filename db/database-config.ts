export type DatabaseEnvironment = {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  PRODUCT_DATABASE_URL?: string;
  CHECKPOINT_DATABASE_URL?: string;
};

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
