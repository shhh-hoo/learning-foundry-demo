import { z } from "zod";
import postgres, { type Sql } from "postgres";
import { RUNTIME_DATABASE_ROLES, resolveAuthorityDatabaseUrls, withRuntimeDatabaseRole } from "@/db/database-config";
import { DomainInvariantError } from "@/domain/invariants";

let workerSql: Sql | null = null;

function getAuditedWorkerClient(): Sql {
  if (!workerSql) {
    const roleScopedUrl = withRuntimeDatabaseRole(resolveAuthorityDatabaseUrls().workerDatabaseUrl, RUNTIME_DATABASE_ROLES.worker);
    workerSql = postgres(roleScopedUrl, { max: 5, prepare: false });
  }
  return workerSql;
}

const ServiceGrant = z.object({
  principal: z.string().min(1),
  purposes: z.array(z.string().min(1)).min(1),
  institutionIds: z.array(z.string().uuid()).min(1),
}).strict();

const ServiceGrants = z.array(ServiceGrant);

export function resolveServiceGrant(input: { principal: string; purpose: string; institutionId: string }, raw = process.env.FOUNDRY_SERVICE_GRANTS): z.infer<typeof ServiceGrant> {
  if (!raw) throw new DomainInvariantError("No service authority grants are configured", "SERVICE_AUTHORITY_NOT_CONFIGURED");
  const grants = ServiceGrants.parse(JSON.parse(raw));
  const grant = grants.find((candidate) => candidate.principal === input.principal
    && candidate.purposes.includes(input.purpose)
    && candidate.institutionIds.includes(input.institutionId));
  if (!grant) throw new DomainInvariantError("Service principal, purpose and institution are not allowlisted", "SERVICE_SCOPE_DENIED");
  return grant;
}

/** Worker work is tenant-scoped, transaction-local and audited; it never receives a bypass-RLS role. */
export async function withServiceTenantContext<T>(
  input: { principal: string; purpose: string; institutionId: string },
  operation: (sql: Sql) => Promise<T>,
): Promise<T> {
  resolveServiceGrant(input);
  const result = await getAuditedWorkerClient().begin(async (transaction) => {
    await transaction`
      SELECT
        set_config('foundry.institution_id', ${input.institutionId}, true),
        set_config('foundry.service_principal', ${input.principal}, true),
        set_config('foundry.service_purpose', ${input.purpose}, true)
    `;
    await transaction`
      INSERT INTO foundry_operational.security_events
        (institution_id, event_class, event_code, principal, purpose, detail)
      VALUES
        (${input.institutionId}::uuid, 'SERVICE', 'SERVICE_INVOCATION', ${input.principal}, ${input.purpose}, '{}'::jsonb)
    `;
    return operation(transaction as unknown as Sql);
  });
  return result as unknown as T;
}

export async function closeServiceAuthority(): Promise<void> {
  if (workerSql) await workerSql.end();
  workerSql = null;
}
