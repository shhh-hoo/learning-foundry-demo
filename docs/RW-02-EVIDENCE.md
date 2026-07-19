# RW-02 production authentication and tenant enforcement evidence

Date: 2026-07-19

Status: **INTERNAL DRAFT IMPLEMENTATION CHECKPOINT — NOT PRODUCTION-READY TENANT ISOLATION — NOT PRODUCT OWNER ACCEPTED**

## Change identity and authority

- Implementation repository: `learning-foundry-demo`
- Branch: `codex/rw-02-production-auth-tenant-enforcement`
- Exact stacked base: `78fe22ffe167f59cbb0b872478263d36044319d8`
- Base subject: `Implement replay and recovery safety`
- Reviewed RW-02 implementation checkpoint: `ff4d43210155a7fb7ce517544d64e1a61958dc98`. The follow-up commit that binds this ledger to that SHA changes evidence prose only; it does not change runtime, migration or test behavior.
- Documentation authority followed: `learning-foundry-docs@c77132314e385308c9a49fd0b5af5ed720d420a3`
- RW-00 and RW-01 evidence remain historical inputs. This change does not rewrite or re-audit them.

Relevant authority requirements:

- `REL-05`: Authentication, authorization, tenant isolation, privacy and execution safety must satisfy Doc 09 `SEC-*` requirements. RW-02 supplies bounded implementation evidence for authentication and tenant enforcement only; it does not claim the whole release row.
- `SEC-01`: server-side authorization and tenant isolation must cover commands, queries, retrieval, files, projections and Component selection/delivery.
- `SEC-12`: security denial, injection, leakage, replay and rollback cases require browser/integration execution against an exact implementation SHA. The reviewed checkpoint has denial/replay/rollback and relevant leakage-boundary evidence bound to `ff4d43210155a7fb7ce517544d64e1a61958dc98`, but this ledger does not upgrade the row or claim complete injection coverage.
- `OPS-06`: session expiry and interrupted workflows must preserve authorized saved state and provide safe reauthentication/resume. The PostgreSQL suite exercises this as one combined case; it is not live-provider or human recovery evidence.
- `DEC-008`: managed-auth selection and its official terms, minor/privacy fit, recovery operations, lock-in and exit evidence remain unresolved. This generic OIDC Draft does not select or approve a production provider.

## Bounded work package

RW-02 replaces production synthetic/browser-only identity assumptions on protected paths with a generic OIDC contract; adds immutable issuer+subject identity binding and DB-backed session issue, verification, rotation, expiry and revocation; supplies fresh actor membership/role/course authority; pins protected database work to transaction-local tenant context; adds forced RLS and scoped privileges for the complete accepted-base table inventory and the new auth/audit tables; scopes LangGraph checkpoint access by institution; and defines explicit audited worker authority.

Non-goals preserved:

- no RW-03 identity/context/evidence domain-schema expansion;
- no product feature, Retrieval, Component-lifecycle or UI redesign work;
- no new candidate runtime or runtime-authority decision;
- no production identity-provider procurement or approval;
- no preview, deployment, merge, cutover or production configuration;
- no creation of production login credentials;
- no claim based only on automated tests.

## Production contracts

### OIDC and sessions

Production requires all of:

- `AUTH_OIDC_ISSUER`: HTTPS issuer URL;
- `AUTH_OIDC_CLIENT_ID`;
- `AUTH_OIDC_CLIENT_SECRET`;
- `AUTH_SECRET` for Auth.js session integrity.

`AUTH_OIDC_INSTITUTION_CLAIM` optionally names the trusted institution claim and defaults to `institution_id`. The issuer, client ID and client secret must be configured together. OIDC uses authorization code flow with PKCE, state and nonce. Protected production paths fail closed when the OIDC contract is absent. Credentials authentication is possible only outside production when `SYNTHETIC_SHOWCASE_MODE=true`; the showcase mode can never enable Credentials in production.

An OIDC callback resolves only an existing active `auth_identities(issuer, subject)` binding. Email is not identity authority and the auth runtime has no `INSERT` privilege on `auth_identities`. The selected institution must match an active membership; without a trusted claim the user must have exactly one unambiguous institution. Actor roles and active course access are read fresh from the database. The browser token carries only the session reference/provenance needed to verify the DB session; revocation, expiry or a stale version invalidates it. Sign-out revokes the DB session.

### Database URLs and roles

Production requires these separately configured URLs:

- `PRODUCT_DATABASE_URL` → non-owning login granted only `foundry_product_runtime`;
- `CHECKPOINT_DATABASE_URL` → non-owning login granted only `foundry_checkpoint_runtime`;
- `AUTH_DATABASE_URL` → non-owning login granted only `foundry_auth_bootstrap`;
- `WORKER_DATABASE_URL` → non-owning login granted only `foundry_worker`;
- `MIGRATION_DATABASE_URL` → migration authority associated with `foundry_migrator`/the owning migration account;
- `CHECKPOINT_MIGRATION_DATABASE_URL` → checkpoint migration authority associated with `foundry_checkpoint_migrator`/the owning checkpoint migration account.

Runtime/auth/worker/migration identities must be distinct by role or target as enforced by startup configuration. In production, every application login must be `LOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOBYPASSRLS`, non-owning and a direct member of exactly one matching runtime group. The application still merges a PostgreSQL startup `role` setting into each runtime URL and requires `current_user` to become that exact documented group role; a login lacking the grant fails at connection startup. Existing URL query parameters and startup options are preserved. Migration URLs remain unmodified owner boundaries. The migration creates NOLOGIN group roles only, and the direct harness proves those roles are not superusers, do not bypass RLS and own no governed product, operational or checkpoint table. It also creates four disposable login identities with the production attributes, proves each has exactly one direct membership and owns no governed object, proves each can SET its expected startup authority for the tested connection, then drops every harness role. An operator must provision the real identities, store URLs outside the repository and apply the migration through the migration boundary. No committed secret, Authorization header, private corpus data or local absolute path is part of this change.

The local E2E setup uses its owning connection only to reset, migrate and seed the explicitly guarded disposable database. The actual Next.js server receives no owner `DATABASE_URL`; its product, auth, worker and checkpoint pools each start under the exact runtime group role. This proves local role behavior, not production login provisioning or the absence of an owning `session_user` in a managed environment.

Service grants use `FOUNDRY_SERVICE_GRANTS`, a strict JSON array of `{ principal, purposes, institutionIds }`. A worker invocation must match all three values, establishes transaction-local institution/principal/purpose settings and inserts one `SERVICE_INVOCATION` security event before work. The worker connection is private to this audited facade; no raw worker client or worker URL is exported. The callback cannot run when the audit insert fails, and later callback failure rolls the audit and work back together. The worker has no BYPASSRLS, superuser authority, password-verifier access or canonical Product State write privilege.

## Complete table authority inventory

The accepted RW-01 base contained 36 tables: 35 application/operational tables plus `foundry_product.__drizzle_migrations`. RW-02 adds `auth_identities`, `auth_sessions` and `security_events`, for 39 catalog rows. Thirty-eight rows require and receive both enabled and forced RLS; migration metadata is the only policy-exempt row.

| Classification | Tables |
|---|---|
| `GLOBAL_MIGRATION_METADATA` / policy exempt | `foundry_product.__drizzle_migrations` |
| `GLOBAL_REFERENCE_READ_ONLY` | `foundry_product.capabilities`, `foundry_product.capability_versions` |
| `TENANT_DIRECT` | `foundry_product.component_deliveries`, `component_evaluations`, `components`, `course_enrollments`, `courses`, `file_assets`, `governance_events`, `idempotency_keys`, `institution_memberships`, `institutions`, `learning_tasks`, `subjects`; `foundry_operational.model_runs`, `retrieval_runs`, `workflow_runs` |
| `TENANT_INDIRECT` | `foundry_product.component_versions`, `context_compilations`, `conversation_events`, `diagnostic_observations`, `learner_attempts`, `learning_episodes`, `learning_outcomes`, `library_items`, `publication_decisions`, `retention_reviews`, `retry_attempts`, `schedule_items`, `teacher_reviews`, `transfer_activities`, `users` |
| tenant-or-global governed reference/operational | `foundry_product.evidence_units`, `source_records`; `foundry_operational.eval_runs` |
| auth boundary | `foundry_product.auth_identities` (`AUTH_BOOTSTRAP_ONLY`), `foundry_product.auth_sessions` (`TENANT_AUTH_SESSION`) |
| tenant/pre-tenant audit | `foundry_operational.security_events` |

The catalog is executable enforcement input, not prose only. Static tests require its 39 exact rows, retain all 36 accepted-base rows and compare every `policy_required=true` row to every `FORCE ROW LEVEL SECURITY` statement.

A second executable catalog inventories every table with runtime `INSERT`, `UPDATE` or `DELETE` authority across product, worker and auth roles and its tenant-bearing references. Its final count is derived from the database grant catalogs and is 29 distinct tables: 23 Product State tables, `auth_sessions`, four operational workflow/retrieval/model/Eval tables and `security_events`. The audit row records both auth and worker mutators. The migration installs the `_authority_tenant_lineage_guard` before domain-governance triggers on all 29 rows for both inserts and updates. It checks the row tenant plus secondary course, learner, Task, Episode, Event, Source, Evidence, File, Attempt, Observation, Review, Retry, Outcome, Component, Version, Evaluation, Workflow, provenance, typed-result, auth Identity/User/membership and audit tenant/actor/session references that apply to each table. Existing governance and immutability triggers remain in place after this authority boundary.

Checkpoint authority is separate:

- `langgraph_checkpoint.checkpoint_migrations`: global migration metadata, read-only to checkpoint runtime;
- `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`: forced RLS; `thread_id` must begin with the active institution UUID and `:`.

## Enforcement boundaries

- Every current protected API handler enters `withApiActor`, verifies the DB-backed session and fresh actor authority, then starts a database transaction and sets `foundry.institution_id`, `foundry.user_id`, `foundry.session_id`, roles and course IDs with `set_config(..., true)`.
- Learner, Teacher, Foundry and Engineering data-bearing pages use the corresponding workspace wrapper.
- Existing nested command transactions reuse the request transaction; thrown command errors still abort that outer transaction and tenant settings cannot escape through a pooled connection.
- Production code cannot construct an actor through `getActor` without verified session authority. The only non-human alternative supplied by RW-02 is the separately typed and audited service context.
- Workflow thread IDs are institution-prefixed in every environment. A supplied or resumed thread ID without the actor institution prefix is rejected.
- `foundry_product_runtime`, `foundry_auth_bootstrap`, `foundry_checkpoint_runtime` and `foundry_worker` are NOSUPERUSER and NOBYPASSRLS. `PUBLIC` schema/table/sequence access is revoked.
- The SECURITY DEFINER mutation guard does not use `current_user` or a custom GUC as caller identity. It considers an exact configured PostgreSQL runtime group first; when `role=none`, it resolves `session_user` and runtime membership through `pg_roles`/`pg_has_role` under `search_path=pg_catalog`. A non-owner/non-superuser caller on the `role=none` path must resolve to exactly one product, auth or worker runtime group; zero or multiple memberships fail closed. An explicit runtime group selected with `SET ROLE` is honored and does not independently re-count the session login's other memberships. The required one-login/one-group provisioning contract is therefore a deployment assumption. A table owner or superuser remains an explicit separate migration boundary.
- Product runtime can read only the non-secret user columns needed by protected product paths. Worker has no user-table read grant; its other reads are explicitly limited to current workflow, Retrieval and model-run records plus the tenant references their RLS policies consume. Both roles are denied direct `password_hash` reads. Password verification remains auth-only.
- Auth authority can read identity/membership data, issue/update/revoke sessions and insert only authentication/authorization audit classes. It cannot create arbitrary OIDC identity bindings. Unauthenticated access, stale/revoked sessions, wrong-role navigation and sign-out revocation create redacted durable audit events on the tested paths.
- Worker authority is allowlisted by principal+purpose+institution, is transaction-local, emits a service audit record and cannot write canonical Product State.

## Evidence ledger

### AUTOMATED

Latest results on 2026-07-19:

| Check | Result | Scope |
|---|---:|---|
| `npm run lint` | PASS | repository ESLint, zero warnings |
| `npm run check` | PASS | TypeScript no-emit check |
| `npm test` | PASS | 28 files, 115 tests |
| `npm run test:integration` | PASS | 6 files, 42 PostgreSQL integration tests |
| `npm run build` | PASS | production-configured Next.js build, 12 generated pages/routes collected |
| `git diff --check` | PASS | no whitespace errors |

Focused coverage includes production auth configuration fail-closed behavior, Credentials production exclusion, immutable issuer+subject lookup, email non-authority, ambiguous or foreign tenant-claim denial, session issue/verify/rotation/expiry/revocation, interrupted-state survival across replacement-session reauthentication/resume, real audited service-facade execution and rollback, absence of exported raw worker access, password-verifier privilege denial, full migration catalog/RLS/writable-lineage parity, dynamic discovery of every current protected route, exact role startup URL construction, tenant-scoped Engineering checkpoint inspection and existing route/migration contracts.

The integration suite also retains RW-01 replay/recovery and Component rollback cases. Those results are relevant to `SEC-12` and are bound to reviewed implementation checkpoint `ff4d43210155a7fb7ce517544d64e1a61958dc98`; the ledger-only follow-up does not alter tested behavior. This internal checkpoint does not upgrade the row or claim complete security-injection coverage.

Automated success is implementation evidence only. It is not product, security, privacy, provider, preview or production acceptance.

### DIRECT_DATABASE

Latest isolated PostgreSQL result:

```text
PASS
catalogRows=38 policy-required rows
tenantNegativeTables=35
workerNegativeTables=35
globalReadOnlyTables=2
checkpointNegativeTables=3
sameTenantPositiveTables=6
writableLineageCatalogRows=29
directWritableLineageProbeTables=29
validAuthSessionPositive=true
authSessionCrossTenantDenials=1
roleNoneAuthSessionDenials=3
resetRoleAuthSessionDenials=1
ambiguousRuntimeMembershipDenials=1
authAuditPositiveEvents=2
authAuditLineageDenials=1
workerReadableTables=12
passwordVerifierRoleDenials=2
productionLoginContracts=4
harnessLoginRolesCleaned=true
runtimeRoleStartupAssumptions=4
runtimeRoles=foundry_auth_bootstrap,foundry_checkpoint_runtime,foundry_product_runtime,foundry_worker
auditedServiceInvocation=true
deniedServiceWorkRolledBack=true
```

The harness joins the authority catalog to `pg_namespace` and `pg_class`, rejects any missing table/RLS/FORCE/policy, and runs under all four exact runtime roles. It unions table- and column-level mutation grants for product, worker and auth, compares the derived actual role set to the executable writable-lineage catalog, and requires one authority trigger plus one rollback-safe A/B negative probe for all 29 distinct rows before reporting PASS. It verifies every group role is NOLOGIN, NOSUPERUSER and NOBYPASSRLS and owns no governed product, operational or checkpoint table. For all 35 non-global policy-required application tables, product-runtime reads with no tenant context or a foreign tenant context return no rows or lack the read grant; update/delete probes must affect zero rows. The same 35-table negative matrix runs under the worker role, which has no canonical Product State write grant and no user-table read grant. Product runtime can read a non-secret user identifier, while product and worker direct `password_hash` selects both fail with permission denial. Auth bootstrap cannot insert identity bindings.

Two real tenant lineages are seeded through Course, Task, Episode, Source, Evidence, File, Attempt, Observation, Review, Retry, Component and Version references. Same-tenant product, indirect-lineage, operational and checkpoint reads succeed while the corresponding cross-tenant reads fail. Every runtime-writable table receives a direct negative attempt against a foreign tenant-bearing reference or tenant label. The exact PM-reported `component_deliveries` shape is replayed by cloning a visible tenant-A delivery while substituting tenant B's real `course_id`; it now fails with `ComponentDelivery tenant lineage mismatch` and rolls back. All three checkpoint tables contain institution-prefixed A/B fixtures and expose only the active tenant. The two global reference tables are directly confirmed read-only.

The worker proof uses the real application facade. One authorized call runs as `foundry_worker` with the exact transaction-local institution, principal and purpose and leaves one durable `SERVICE_INVOCATION`. Ungranted scope never calls the callback. A canonical Product State write and a cross-tenant audit write both fail and roll their attempted invocation records back. A nonexistent-institution audit failure also prevents callback execution. No manual audit insert is counted as facade evidence.

The auth-runtime direct proof inserts and updates a valid tenant-A session only when its active Identity maps to the same active user and that user has an active tenant-A membership. The exact PM shape—tenant-A Identity/user with tenant-B institution—fails with `AuthSession tenant lineage mismatch` and rolls back under normal `SET ROLE`. It also fails through three distinct `role=none` paths: exact `SET SESSION AUTHORIZATION foundry_auth_bootstrap`, a disposable inheriting auth login, and the same inheriting login after `SET ROLE` followed by `RESET ROLE`. A disposable login granted both auth and worker runtime groups is denied before the same-tenant insert with `PostgreSQL session principal has multiple RW-02 runtime roles`. Auth audit accepts a nullable pre-tenant denial event and a fully tenant-consistent actor/session event, while the same tenant-A actor/session labeled tenant B fails with `Auth audit tenant lineage mismatch`. Existing issue, verify, rotate, revoke, sign-out and replacement-session recovery paths remain covered by integration/browser evidence.

This is local PostgreSQL evidence. It is not evidence that a managed database has been provisioned, migrated, role-granted, backed up or operationally accepted.

### LOCAL_BROWSER

Latest Playwright result: **19 passed, 3 intentional mobile skips, 0 failed** from 22 scheduled cases.

The desktop OIDC case goes through the actual Auth.js provider redirect and callback using a test-only local HTTPS OIDC simulator. It proves discovery, authorization code exchange, exact redirect matching, PKCE, state, nonce, immutable subject mapping despite non-authoritative email, DB session issuance and protected learner navigation. The actual app server runs through four exact role-scoped startup URLs. Other cases prove unauthenticated page/API fail-closed behavior plus a durable denial audit, DB revocation invalidating an existing browser token plus stale-session audit, actual Auth.js sign-out revoking its DB session plus audit, desktop/mobile role-surface isolation, wrong-role data-free denial plus audit, and the existing full desktop product flows under the new request transaction boundary. OIDC is intentionally exercised once on desktop; the two expensive full product flows remain desktop-only as before.

The simulator is test code only, has no runtime import and adds no production dependency or insecure runtime flag. This is **not live-provider evidence**.

### LIVE_PROVIDER_NOT_RUN

No external OIDC provider was configured or called. Provider procurement, issuer/client provisioning, minor/education privacy terms, account recovery, MFA, key rotation, logout interoperability and incident procedures remain unevidenced under `DEC-008`.

### PREVIEW_NOT_RUN

No preview was requested, approved or used. No workflow side effect or deployment was triggered.

### HUMAN_NOT_RUN

No human security review, privacy review, accessibility review, tenant-administrator validation or provider-operator validation was performed.

### PRODUCTION_NOT_RUN

No production migration, database-role grant, identity binding, provider callback, session operation, tenant probe, backup/restore, monitoring validation, deployment or cutover was performed.

### PRODUCT_OWNER_NOT_ACCEPTED

Independent PM review accepts this work only for publication as a Draft internal implementation checkpoint. Tests and local evidence do not authorize Product Owner production acceptance, merge, preview, deployment or cutover.

## Retained failure evidence

Failures were retained and repaired rather than hidden or favorably resampled:

1. Dependency installation initially hit sandbox network/permission denial; the identical installation completed only with the approved external access boundary.
2. A seed attempt without `SYNTHETIC_SHOWCASE_MODE=true` failed closed as designed; the guarded local seed then passed.
3. The first direct-database harness let a permission error abort its transaction; it was rewritten to inspect grants and perform schema-correct catalog joins before direct probes.
4. The first browser attempt found Chromium absent; the local test browser was installed before rerun.
5. The E2E reset initially left private policy schemas behind; the isolated reset now drops both private schemas explicitly.
6. The first request-transaction browser run exposed missing postgres.js parser options on the reserved transaction connection; the scoped Drizzle client now receives the root parser options.
7. Early OIDC simulator runs retained missing nonce/security-parameter and callback redirect-origin mismatches; the final contract uses HTTPS plus PKCE, state, nonce and exact origin matching.
8. The local E2E reset guard stopped a run without `E2E_RESET_ALLOWED=true`, and a subsequent command used the wrong isolated-cluster login role; neither safety failure was bypassed silently.
9. The successful OIDC exchange then exposed Auth.js normalizing its internal OAuth user ID away from the Foundry DB user ID; RW-02 now carries the DB-bound principal separately and does not create an identity from callback claims.
10. The first full suite after request scoping exposed an unsupported nested `begin` call. Existing command transactions now reuse the stronger request transaction and the complete suite passed on rerun.
11. Independent PM review returned R1–R5 rather than accepting the first implementation: runtime role startup was only assumed, Engineering checkpoint inspection was unscoped, denial/sign-out audit evidence was incomplete, authority rows were misdescribed, route coverage was static, and the direct database harness lacked real two-tenant positive/cross-lineage cases. Each finding is preserved in the rework history and addressed by the reviewed implementation checkpoint; the final PM decision is Draft-only acceptance at the reduced internal-checkpoint bar.
12. The first full integration run after checkpoint-role rework retained 1 failed of 40 plus 25 unhandled checkpoint RLS write errors. Direct integration checkpointers were not tenant-scoped and several supplied thread IDs lacked institution prefixes. The code and tests were corrected before the later 41/41 run.
13. One integration invocation omitted the isolated database variables, so three cases failed and 37 skipped before governed behavior ran. It is not counted as product evidence; the explicit seven-URL local invocation later passed 41/41.
14. One browser invocation omitted `E2E_RESET_ALLOWED=true`; the guard refused the reset before mutation. The explicitly authorized disposable-database rerun later passed 19 with 3 declared skips.
15. Independent PM rework review reproduced a blocking secondary-lineage breach: a tenant-A `component_deliveries` insert carrying tenant B's real `course_id` returned `INSERT 0 1` before the PM rolled the transaction back. The old table policy checked only `institution_id`. RW-02 now rejects that exact shape with `ComponentDelivery tenant lineage mismatch`; the original accepted write remains retained failure evidence rather than being reclassified as a pass.
16. The same review found that `db/client.ts` exported raw worker SQL access, the direct harness manually inserted a service-looking event rather than calling the application facade, and product/worker roles could read `users.password_hash`. Raw worker exports were removed, the facade now privately owns the worker connection and the direct proof calls it, and column privileges plus direct denials establish the narrower password boundary.
17. The first browser compatibility run after the comprehensive lineage guard failed because a valid create-Task idempotency reservation referred to the result before that result existed. The typed idempotency helper now permits a future reservation only while no result row exists and enforces tenant ownership once it does. The next run found an ambiguous PL/pgSQL `task_id` variable in the Workflow guard; local variables were renamed. The later clean final migration run passed 19 cases with 3 declared skips.
18. Direct-harness rework retained several non-passing iterations: the local connection was initially sandbox-denied; the tenant-B Component fixture exposed JSON parameter encoding and governed-lineage fixture defects; the privilege inventory compared incompatible PostgreSQL array types; and accepted-base domain triggers initially fired before the comprehensive authority trigger. The fixture encoding and catalog cast were corrected, and the authority trigger is intentionally named to run before domain-governance triggers. A later attempt reached the real service facade but lacked the checkpoint URL required by the shared database resolver. The then-reported 28-row result was later proven incomplete by PM auth-session review and is retained only as historical failed evidence, not current completeness evidence.
19. The first final-order direct run reached all product/operational lineage probes, including the exact delivery denial, but stopped before service evidence because of that missing checkpoint URL. After binding every facade resolver URL to the same guarded disposable database, the complete direct result passed. The stopped run is not reported as a partial success.
20. Final privilege review found the worker still inherited broad table reads from the initial grant even though its mutations were narrow. The final migration removes that blanket read, grants only current workflow/Retrieval/model/security reads plus their RLS tenant references, and gives worker no user-table access. The complete clean migration, browser, direct-database and integration evidence was rerun after this tightening.
21. Independent PM rollback-only review then found a second blocking breach after that handoff: as `foundry_auth_bootstrap`, a new `auth_sessions` row combining the tenant-A learner/Identity with a temporary tenant-B institution returned `INSERT 0 1`; the selected row showed A-user to B-institution before rollback. The 28-row writable catalog had omitted auth mutation and its RLS policy allowed every auth row, so the evidence claim that every runtime mutator was inventoried was false. The catalog now derives product, worker and auth table/column mutation grants, adds `auth_sessions`, records auth plus worker audit mutation, and the exact A/B session shape fails with the named auth-session lineage denial. The accepted pre-fix insert remains failure evidence.
22. Independent PM review then bypassed that corrected 29-row guard by setting session authorization to `foundry_auth_bootstrap`: PostgreSQL reported `current_user=foundry_auth_bootstrap`, `session_user=foundry_auth_bootstrap`, `role=none`, and the tenant-A Identity/user plus tenant-B session again returned `INSERT 0 1` before rollback. The SECURITY DEFINER trigger had trusted only `current_setting('role')` and returned early for `none`; a non-owner INHERIT login could retain group privileges after `RESET ROLE` and take the same path. The guard now resolves exact configured role, session principal and catalog membership, rejects ambiguous membership, and keeps only explicit owner/superuser migration bypass. The direct matrix preserves the PM shape across normal role, exact session authorization, inheriting-login and post-RESET ROLE paths.
23. The clean browser regeneration after this correction had two guard-stopped invocations before mutation: the first omitted the disposable database URL and the second omitted the required local showcase credential. The explicit guarded-database invocation then reset, migrated and passed 19 cases with 3 declared skips. The stopped attempts are not counted as behavior evidence.

These retained iterations are development evidence. They do not establish absence of undiscovered defects.

## Rollback boundary

Code rollback is one revert of the bounded RW-02 commit after the PM assigns it. Database rollback requires an authorized operator and is not represented as a tested automatic down migration:

1. stop new RW-02 session issuance and worker/checkpoint traffic;
2. preserve database backups and security-event evidence;
3. revoke/delete dependent environment login grants and drain/revoke active RW-02 sessions;
4. use the migration owners to remove checkpoint policies/private helpers and product RLS policies/private catalog;
5. remove `security_events`, `auth_sessions` and `auth_identities` only after evidence-retention and foreign-key review;
6. remove the NOLOGIN roles only after all memberships/dependencies are cleared;
7. restore the previous application/database configuration as one coordinated rollback.

This boundary is independently revertible from RW-00 and RW-01. The operational rollback has **NOT BEEN REHEARSED** and requires separate authorization; this Draft does not grant destructive production authority.

## Remaining blockers and non-claims

- this is an internal implementation checkpoint, not production-ready tenant isolation;
- catalog-backed caller resolution is evidenced only for the enumerated local PostgreSQL role paths; the explicit `SET ROLE` path honors the selected runtime group without independently re-counting the session login's other memberships, so the one-login/one-group constraint remains a deployment assumption; managed ownership, login provisioning, role chains, connection/session behavior and unexamined privileged bypasses remain deferred to authorized operational and security review;
- live provider selection/configuration and `DEC-008` acceptance remain open;
- managed database login-role provisioning, migration, direct tenant probes, backup/restore and monitoring remain not run;
- no human or Product Owner acceptance exists;
- no preview/production approval, merge, deploy or cutover authority exists;
- no RW-03 schema expansion or wider identity/context/evidence claim exists;
- no claim is made that the full 113-row product evidence ledger is implemented;
- no claim is made that tests alone complete RW-02.
