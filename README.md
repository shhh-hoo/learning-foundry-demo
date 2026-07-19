# Learning Foundry · full-framework rewrite

Exact commit `b6f023fe995e44e714bf5da2c2096128e1def9fe` is the immutable
audited Next.js App Router, LangGraph JS and PostgreSQL implementation
checkpoint. This descendant branch leaves that checkpoint's product behavior
unchanged and contains only separately reviewable governance-guidance changes.
The audited checkpoint is historical implementation evidence, not an accepted
rewrite, completed product or cutover claim.

Current documentation authority:
`learning-foundry-docs@c77132314e385308c9a49fd0b5af5ed720d420a3`.
The companion RW-00 documentation Draft retains the exact-head audit under
`evidence/implementation/pr-22/`, including the 42-to-113 transition map. That
Draft and this implementation-guidance change remain separately reviewable and
revertible. Neither grants Legacy deletion, canonical Product State migration,
preview approval, merge, release, production or cutover authority.

## State and authority

- `foundry_product` stores canonical Product State.
- `foundry_operational` stores workflow, retrieval and Eval inspection records.
- `langgraph_checkpoint` is the separate LangGraph checkpoint store. Production requires `CHECKPOINT_DATABASE_URL` and `PRODUCT_DATABASE_URL` to use distinct database roles or targets; they may use the same managed PostgreSQL database when repository/schema boundaries and permissions remain separate. Local and test environments may fall back to `DATABASE_URL`.
- Authenticated actor provenance—not a caller-supplied string—authorizes TeacherReview, LearningOutcome and PublicationDecision commands.
- `RETRY` is the only activity type exposed in Checkpoint A.

The real-intelligence work package adds governed PDF/image intake, PDF.js page extraction, persisted provider embeddings with exact cosine retrieval, PostgreSQL full-text search, reciprocal-rank fusion, configured Cohere reranking, grounded model synthesis, and configured OpenAI image/handwriting interpretation. Each adapter reports `EXECUTED`, `UNAVAILABLE`, or `FAILED`; missing keys never synthesize success. This exact-vector implementation does not claim a production-scale ANN index. Four deterministic Chemistry calculation adapters live under the Chemistry Reference Pack rather than Core.

Uploaded bytes are stored through the server-only `FileStorage` port and never in Product State rows. Local verification uses `.local-data/uploads` (or `FILE_STORAGE_LOCAL_ROOT`); production startup fails without an explicit storage root until a managed storage adapter is selected. Extracted text, content hashes, ownership, rights decisions, locators, and ingestion status remain governed Product State.

The audited checkpoint contains a partial Component lifecycle: a structured
editor, reviewed-signal eligibility, versioned system checks, deterministic
Capability fixture execution, an authenticated expert publication interrupt,
immutable approve/reject decisions, successor versions, rollback and
version-pinned support delivery. It does not implement the complete Component
Platform contract. Blank creation, Component import, learner preview, reviewer
collaboration, Registry/selection, Outcome linkage and maintenance controls are
among the retained audit gaps. Rights/citation checks are recorded as
`NOT_REQUIRED`, never `PASSED`, when a narrow deterministic scaffold declares no
Evidence. This is historical product-visible evidence, not human validation,
product completion or public-preview authorization.

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

External telemetry, product/pedagogy/learning-effectiveness Eval, managed object storage, production ANN/vector infrastructure, and a production authentication provider remain unavailable or not configured. No public preview is authorized.

Managed database roles and RLS (or an equivalent database-enforced tenant policy) are **NOT_CONFIGURED**. Application authorization remains mandatory, but is not a claim of database-level tenant enforcement. Background or automatic recovery for a crashed `RESUMING` workflow is **NOT_IMPLEMENTED**. On request, an authorized actor may reclaim an expired resume lease using the current interrupt version; fresh leases remain protected from concurrent resume. This bounded reclaim path grants no preview or production authorization. Missing database-enforced tenant policy and missing automatic recovery remain public-preview blockers.

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
