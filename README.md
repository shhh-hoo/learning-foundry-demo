# Learning Foundry · full-framework rewrite

Exact commit `b6f023fe995e44e714bf5da2c2096128e1def9fe` is the immutable
audited Next.js App Router, LangGraph JS and PostgreSQL implementation
checkpoint. This descendant branch leaves that checkpoint's product behavior
unchanged and contains only separately reviewable governance-guidance changes.
The audited checkpoint is historical implementation evidence, not an accepted
rewrite, completed product or cutover claim.

Current documentation authority:
`learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`.
The retained PR #22 audit remains exact-head evidence only. Its observations
and old requirement interpretation are historical; the superseded 113-row
ledger and `COMP-*` evidence do not map mechanically to current `CAP-*`
requirements. This implementation-guidance change is separately reviewable and
revertible. It grants no Legacy deletion, canonical Product State migration,
preview approval, merge, release, production or cutover authority.

## State and authority

- `foundry_product` stores canonical Product State.
- `foundry_operational` stores workflow, retrieval and Eval inspection records.
- `langgraph_checkpoint` is the separate LangGraph checkpoint store. Production requires `CHECKPOINT_DATABASE_URL` and `PRODUCT_DATABASE_URL` to use distinct database roles or targets; they may use the same managed PostgreSQL database when repository/schema boundaries and permissions remain separate. Local and test environments may fall back to `DATABASE_URL`.
- Authenticated actor provenance—not a caller-supplied string—authorizes TeacherReview, LearningOutcome and PublicationDecision commands.
- `RETRY` is the only activity type exposed in Checkpoint A.

The real-intelligence work package adds governed PDF/image intake, PDF.js page extraction, persisted provider embeddings with exact cosine retrieval, PostgreSQL full-text search, reciprocal-rank fusion, configured Cohere reranking, grounded model synthesis, and configured OpenAI image/handwriting interpretation. Each adapter reports `EXECUTED`, `UNAVAILABLE`, or `FAILED`; missing keys never synthesize success. This exact-vector implementation does not claim a production-scale ANN index. Four deterministic Chemistry calculation adapters live under the Chemistry Reference Pack rather than Core.

Uploaded bytes are stored through the server-only `FileStorage` port and never in Product State rows. Local verification uses `.local-data/uploads` (or `FILE_STORAGE_LOCAL_ROOT`); production startup fails without an explicit storage root until a managed storage adapter is selected. Extracted text, content hashes, ownership, rights decisions, locators, and ingestion status remain governed Product State.

The audited checkpoint contains partial capability-supply primitives: exact
versions, versioned system checks, deterministic Capability fixture execution,
an authenticated expert decision interrupt, immutable decisions, successor
versions, rollback and version-pinned support delivery. It also contains
Component-oriented editor and review structures created under superseded CMS
authority. Those structures are salvage candidates, not current requirements.
No old `COMP-*` result establishes `CAP-*` completion. Rights/citation checks
recorded as `NOT_REQUIRED` remain historical facts, never inferred passes. This
is exact-head evidence, not human validation, product completion or
public-preview authorization.

Optional live integrations:

- `OPENAI_API_KEY`: embeddings and image/handwriting interpretation; also synthesis when `FOUNDRY_SYNTHESIS_PROVIDER=OPENAI`.
- `COHERE_API_KEY`: Cohere reranking (`COHERE_RERANK_MODEL`, default `rerank-v3.5`).
- `DEEPSEEK_API_KEY`: grounded synthesis when `FOUNDRY_SYNTHESIS_PROVIDER=DEEPSEEK` or when it is the first configured synthesis provider.
- `FILE_STORAGE_LOCAL_ROOT`: explicit local object root; required in production until managed object storage is configured.

Workflow starts and resumes use request-scoped cancellation plus a bounded
deadline (30 seconds by default, capped at 120 seconds). LangGraph, chat and
vision calls receive native abort signals. The installed LangChain OpenAI
embeddings and Cohere rerank wrappers do not expose per-call signals, so those
two boundaries enforce pre/post deadline guards but cannot cooperatively stop an
already in-flight wrapper call. They must not be reported as cooperatively
cancelled; the workflow still stops before subsequent canonical writes.

External telemetry, product/pedagogy/learning-effectiveness Eval, managed object storage, production ANN/vector infrastructure, and a live production identity-provider configuration remain unavailable or not configured. No public preview is authorized.

The unmerged RW-02 Draft adds a generic production OIDC contract, DB-backed
session rotation/revocation, transaction-local tenant context, forced RLS for
every cataloged Product State and operational table, institution-prefixed
checkpoint enforcement, and least-privilege auth/product/checkpoint/worker
roles. Local automated, direct-database, and HTTPS OIDC-simulator evidence is
recorded in `docs/RW-02-EVIDENCE.md`. It is not live-provider, managed-database,
preview, human, production, or Product Owner acceptance evidence.

Production OIDC requires `AUTH_OIDC_ISSUER`, `AUTH_OIDC_CLIENT_ID`,
`AUTH_OIDC_CLIENT_SECRET`, `AUTH_SECRET`, and an operator-provisioned immutable
issuer+subject binding. Production database separation requires
`PRODUCT_DATABASE_URL`, `CHECKPOINT_DATABASE_URL`, `AUTH_DATABASE_URL`,
`WORKER_DATABASE_URL`, `MIGRATION_DATABASE_URL`, and
`CHECKPOINT_MIGRATION_DATABASE_URL`, each using its documented distinct login
role or target. Production runtime pools merge an exact group-role startup
setting into those URLs and fail if the login lacks the matching grant; owner
migration URLs are not reused by application pools. Each operator-provisioned
application login must be LOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS,
non-owning, and a direct member of exactly one matching runtime group; startup
must still SET that exact group role. The mutation guard resolves PostgreSQL
role/session membership from the catalogs. When `role=none`, a non-owner caller
with zero or multiple runtime authorities fails closed. An explicit runtime
group selected at connection startup is honored; that path therefore relies on
the operator provisioning each login with exactly one direct runtime-group
membership.
The migration creates NOLOGIN group roles; it does not create credentials or
grant a deploy environment access.

These controls remain **DRAFT / NOT DEPLOYED / NOT LIVE-CONFIGURED** until a
separate authorized deployment provisions the roles, applies the migrations,
configures an approved provider, and supplies evidence. Background or automatic
recovery for a crashed `RESUMING` workflow is **NOT_IMPLEMENTED**. On request,
an authorized actor may reclaim an expired resume lease using the current
interrupt version; fresh leases remain protected from concurrent resume. This
bounded reclaim path and the RW-02 Draft grant no preview or production
authorization.

RW-02 is an **internal implementation checkpoint, not production-ready tenant
isolation**. Its catalog-backed role resolution and tenant probes cover the
enumerated local PostgreSQL paths only. Managed-database ownership, login
provisioning, role-chain configuration, deployment/session behavior and any
unexamined privileged bypass remain deferred to authorized operational and
security review. In particular, the explicit `SET ROLE` path does not
independently re-count the session login's other memberships, so the documented
one-group login constraint is a deployment assumption, not a locally proven
managed-environment guarantee. Local tests do not approve those assumptions.

Dependency audit status: Next.js 16.2.10 currently installs nested PostCSS 8.4.31, which remains affected by moderate advisory `GHSA-qx2v-qp2m-jg93`. A package override was tested and removed because Next continued to resolve its pinned nested version and npm correctly marked the forced tree invalid. The other current moderate findings are in the `drizzle-kit` / `@esbuild-kit` / `esbuild` development-tooling chain; npm's proposed remediation is an incompatible downgrade and is not applied. There are currently no high or critical audit findings. The runtime PostCSS advisory remains an explicit preview blocker pending a compatible upstream resolution.

## Local verification

```bash
npm ci
npm run check
npm run lint
npm test
npm run build
npm run legacy:scan
```

Database verification requires an isolated PostgreSQL database:

```bash
export DATABASE_URL=postgresql://...
npm run db:migrate
npm run db:checkpoint
SYNTHETIC_SHOWCASE_MODE=true SHOWCASE_PASSWORD='<unique local secret>' npm run db:seed
npm run test:integration
npm run test:integration:rerun
```

The historical-checkpoint upgrade rehearsal uses a separately named guarded
local database. It constructs the exact old `{observationId}`-only Component
shape before applying that checkpoint's Component migration, then verifies its
authenticated Review backfill and audit quarantine of non-bindable pre-Eval
shells. The retained audit flags deletion in this migration as a separate
schema/data authority risk; a passing rehearsal does not authorize migration:

```bash
UPGRADE_REHEARSAL_ALLOWED=true \
UPGRADE_REHEARSAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/learning_foundry_upgrade_rehearsal \
npm run test:migration-upgrade
```

Synthetic credentials authentication is disabled unless `SYNTHETIC_SHOWCASE_MODE=true`. The showcase password has no repository default and must be supplied through the environment.
