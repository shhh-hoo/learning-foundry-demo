export type ProductStateMode = "LEGACY_SHOWCASE" | "POSTGRES_CANONICAL";

export type ProductStateConfiguration =
  | {
      readonly mode: "LEGACY_SHOWCASE";
      readonly environment: string;
    }
  | {
      readonly mode: "POSTGRES_CANONICAL";
      readonly environment: string;
      readonly databaseUrl: string;
    };

function required(value: string | undefined, code: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

export function resolveProductStateConfiguration(environment: Readonly<Record<string, string | undefined>>): ProductStateConfiguration {
  const environmentName = required(environment.FOUNDRY_ENVIRONMENT, "FOUNDRY_ENVIRONMENT_REQUIRED");
  if (environment.PRODUCT_STATE_DUAL_WRITE === "true" || environment.PRODUCT_STATE_DUAL_WRITE === "1") {
    throw new Error("PRODUCT_STATE_DUAL_WRITE_PROHIBITED");
  }
  const mode = required(environment.PRODUCT_STATE_MODE, "PRODUCT_STATE_MODE_REQUIRED");
  if (mode === "LEGACY_SHOWCASE") return { mode, environment: environmentName };
  if (mode === "POSTGRES_CANONICAL") {
    return {
      mode,
      environment: environmentName,
      databaseUrl: required(environment.PRODUCT_STATE_DATABASE_URL, "PRODUCT_STATE_DATABASE_URL_REQUIRED"),
    };
  }
  throw new Error(`INVALID_PRODUCT_STATE_MODE: ${mode}`);
}

export async function selectProductStateBackend<T>(
  configuration: ProductStateConfiguration,
  factories: {
    readonly legacy: () => T | Promise<T>;
    readonly postgres: (databaseUrl: string) => T | Promise<T>;
  },
): Promise<T> {
  if (configuration.mode === "LEGACY_SHOWCASE") return factories.legacy();
  // Deliberately no catch/fallback: once configured canonical, a database
  // failure is visible and cannot silently restore browser authority.
  return factories.postgres(configuration.databaseUrl);
}
