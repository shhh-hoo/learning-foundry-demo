# Local Showcase

This is the supported Product Owner / reviewer path for trying the current stacked Learning Foundry product locally.

It is an isolated synthetic showcase. It is not a public preview, school Pilot, production deployment or learning-effectiveness claim.

## Requirements

- Node.js 20.9 or newer;
- npm;
- Docker Desktop or another working Docker Engine with `docker compose`;
- macOS, Linux or Windows with ports 3100, 3202 and 55432 available by default.

No model API key is required for the core synthetic showcase. Missing DeepSeek, OpenAI and Cohere keys remain visibly unavailable rather than being simulated.

## Start

From the repository root:

```bash
npm run showcase
```

The launcher:

1. creates `.env.showcase.local` with local-only random secrets and one generated showcase password;
2. starts a dedicated PostgreSQL 16 container and persistent volume;
3. installs the lockfile dependencies with `npm ci` when `node_modules` is absent;
4. applies Product State and LangGraph checkpoint migrations;
5. seeds isolated synthetic learner, teacher, expert and engineer accounts;
6. pre-provisions and verifies the four synthetic authentication identities;
7. starts the separate Component Executor on port 3202;
8. starts Next.js on port 3100;
9. waits for both health endpoints;
10. prints the login details and opens the sign-in page where a desktop opener is available.

The default URL is:

```text
http://127.0.0.1:3100/sign-in
```

Set `SHOWCASE_NO_OPEN=true` to prevent automatic browser opening.

## Accounts

Institution:

```text
checkpoint-showcase
```

The generated password is printed by the launcher and stored only in the ignored `.env.showcase.local` file.

Accounts:

```text
learner@showcase.invalid
teacher@showcase.invalid
expert@showcase.invalid
engineer@showcase.invalid
```

Use separate browser profiles or private windows to keep several roles signed in at once.

## Suggested Product Owner walkthrough

### Learner

1. Open the seeded Task `Inspect my calculation reasoning`.
2. Inspect the Task-scoped Context and Evidence cards.
3. Find the seeded Attempt and run Capability Resolution.
4. After the expert completes the gap-supply flow, reload and run the exact Web ComponentAsset.
5. Inspect the runtime feedback, immutable version lineage and failure/retry states.

### Expert / Capability Workshop

1. Open the current `ADAPT / BLOCKED` gap.
2. Create the bounded Web ComponentAsset proposal.
3. Run versioned checks.
4. Run the exact learner preview with one selected input.
5. Record the authenticated confirmation for that exact version.
6. Verify `REGISTERED · EXACT VERSION · READY` before returning to the learner.
7. After an incorrect learner Attempt, inspect or create the Asset Optimization Proposal.

### Teacher

1. Create an assignment for the seeded learner.
2. Inspect exact RuntimeDelivery, Attempt, LearningEvents, Context, Diagnosis and Resolution lineage.
3. Record a bounded capability requirement or exclusion.
4. Review the resulting Routing Optimization signal and record the append-only next action.
5. Inspect governed Retry / Transfer / Retention controls without treating them as LearningOutcome.

### Engineer

Inspect:

- service availability;
- LangGraph workflow and interrupt inventory;
- expired resume claims;
- retrieval/provider status;
- framework contract checks;
- Component evaluation and exact-version history;
- checkpoint storage.

## Data lifecycle

Stop the foreground Next.js and Component Executor processes with Ctrl+C. PostgreSQL data is preserved.

Show container status:

```bash
npm run showcase:status
```

Reset only the dedicated Product State/checkpoint schemas and local showcase uploads, then start again:

```bash
npm run showcase:reset
```

Stop the dedicated PostgreSQL container:

```bash
npm run showcase:stop
```

Delete the dedicated PostgreSQL volume, uploads and generated credentials:

```bash
npm run showcase:destroy
```

`showcase:reset` and `showcase:destroy` never target an arbitrary database. The Compose project uses the dedicated database `learning_foundry_showcase`.

## Port overrides

Set these variables before the first run if the defaults are occupied:

```bash
SHOWCASE_POSTGRES_PORT=55433 \
SHOWCASE_APP_PORT=3101 \
SHOWCASE_EXECUTOR_PORT=3203 \
npm run showcase
```

The first run stores those values in `.env.showcase.local`. To change them later, run `npm run showcase:destroy`, then start again with new overrides.

## Troubleshooting

### `SYNTHETIC_IDENTITY_DENIED` or “Synthetic identity must be pre-provisioned”

This indicates that the database contains showcase users but not their authentication identity bindings. Update to the latest PR #40 branch and rerun the seed path:

```bash
git fetch origin agent/local-showcase-one-command
git reset --hard origin/agent/local-showcase-one-command
npm run showcase
```

The current launcher provisions and verifies all four identities during `db:seed`. Existing Product State may be retained; destroying the database is not required.

To repair identities explicitly while the generated showcase environment exists:

```bash
set -a
source .env.showcase.local
set +a
npm run showcase:auth-check
```

### Docker is unavailable

Start Docker Desktop and confirm:

```bash
docker info
docker compose version
```

### A port is already used

Stop the conflicting process, or destroy and regenerate the showcase environment with port overrides.

### The browser does not open

Open the printed URL manually. Automatic opening is best-effort only.

### Startup stops during migrations or seed

The launcher fails immediately and retains the actual command output. Run:

```bash
npm run showcase:destroy
npm run showcase
```

If it still fails, preserve the terminal output; do not claim the local showcase is working.

### Provider features show unavailable

That is expected without API keys. The core deterministic orchestration, Web ComponentAsset, teacher governance and evidence paths do not require model credentials.

## Boundaries

This launcher does not:

- deploy an online preview;
- configure a live institutional identity provider;
- provision managed PostgreSQL or Object Storage;
- establish production tenant isolation;
- create human-validation or learning-effectiveness evidence;
- merge any stacked Draft PR;
- authorize release or cutover.
