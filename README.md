# Learning Foundry · full-framework rewrite

This branch contains the Next.js App Router, LangGraph JS and PostgreSQL replacement baseline. It is an internal engineering checkpoint, not a completed product or cutover claim.

## State and authority

- `foundry_product` stores canonical Product State.
- `foundry_operational` stores workflow, retrieval and Eval inspection records.
- `langgraph_checkpoint` is the separate LangGraph checkpoint store. Production requires `CHECKPOINT_DATABASE_URL` and `PRODUCT_DATABASE_URL` to use distinct database roles or targets; they may use the same managed PostgreSQL database when repository/schema boundaries and permissions remain separate. Local and test environments may fall back to `DATABASE_URL`.
- Authenticated actor provenance—not a caller-supplied string—authorizes TeacherReview, LearningOutcome and PublicationDecision commands.
- `RETRY` is the only activity type exposed in Checkpoint A.

PostgreSQL full-text search is an honest lexical candidate retriever. Mature hybrid retrieval, a real reranker, multimodal retrieval, external telemetry and Standard Trainer are unavailable until real integrations are evaluated and configured.

Managed database roles and RLS (or an equivalent database-enforced tenant policy) are **NOT_CONFIGURED**. Application authorization remains mandatory, but is not a claim of database-level tenant enforcement. Automated recovery for a crashed `RESUMING` workflow is **NOT_IMPLEMENTED**; stale claims are reported to Engineering and remain fail-closed. Both gaps block any public preview.

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
```

Synthetic credentials authentication is disabled unless `SYNTHETIC_SHOWCASE_MODE=true`. The showcase password has no repository default and must be supplied through the environment.
