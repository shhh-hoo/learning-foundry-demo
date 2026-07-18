# PR #5 AgentEval Contract Hardening acceptance

Date: 2026-07-16

Branch: historical AgentEval contract-hardening branch

## Automated checks

```text
npm test       PASS — 144/144
npm run check  PASS
npm run build  PASS
git diff --check PASS
```

These checks protect the versioned `1.2.0` behavioral baseline, the formal suite-layer and assessment-dimension taxonomy, selection-aware reporting, and the separation of supported-input generalization from capability-boundary compliance.

## Live checkpoint

Run: `agenteval-2026-07-16T15-08-57-425Z-01f5cc59`

Selection: `CHECKPOINT`

Result: 6/6 passed against the configured DeepSeek gateway and real tools. The six executions resolve to six distinct `sourceCaseId` values; the capability-gap checkpoint retains its `list_capabilities` obligation.

## Live 1.2.0 baseline

Run: `agenteval-2026-07-16T15-09-45-559Z-34120e6c`

Selection: `BASELINE`, value `1.2.0`

Result: 18/18 passed against the configured DeepSeek gateway and real tools.

Key report evidence:

```text
CORE_CONTRACT       planned 16 · executed 16 · passed 16 · COMPLETE · rate 1
RETRIEVAL dimension planned 45 · executed 5  · passed 5  · PARTIAL  · rate null
GENERALIZATION      planned 55 · executed 0  · passed 0  · NOT_RUN  · rate null
LEARNING_LOOP       planned 0  · executed 0  · passed 0  · NOT_RUN  · rate null
supported input     planned 49 · executed 0  · passed 0  · NOT_RUN  · rate null
boundary compliance planned 6  · executed 0  · passed 0  · NOT_RUN  · rate null
```

The report therefore does not reinterpret the five baseline retrieval cases as complete retrieval-dimension coverage and does not let capability-boundary cases increase supported-input generalization.

## Scope boundary

No product route, retrieval scorer, tool executor or Trainer runtime changed in this hardening. The full 73-case suite was not required to pass and was not run as part of this acceptance. Agent retrieval grounding cases are not a retrieval-engine ranking benchmark; Recall@K, MRR, nDCG, rank diagnostics and reranker deltas remain future work.
