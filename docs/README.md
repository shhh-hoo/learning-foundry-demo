# Local implementation documentation

This directory contains implementation notes, dated acceptance records, migration records, failure matrices, screenshots and historical work-package evidence.

It is **not** the product source of truth.

## Current product authority

```text
shhh-hoo/learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1
```

Repository implementation instructions are in [`../AGENTS.md`](../AGENTS.md).

## Authority order

```text
accepted learning-foundry-docs authority
> AGENTS.md repository instructions
> current implementation PR/work-package contract
> exact-head test and browser evidence
> dated local acceptance or migration record
> historical Legacy documentation
```

A local file title containing `ACCEPTANCE`, `COMPLETE`, `READY`, `FINAL`, `CONTRACT` or `VALIDATION` does not grant current requirement acceptance by itself.

## Product invariant

Learning Foundry is an AI Learning Orchestration Platform.

A `ComponentAsset` is an executable, interactive or orchestratable learning tool or experience. It is not an article, PDF, page or generic CMS record.

The former CMS-like `COMP-*` contract and 113-row ledger are superseded. Current requirement namespaces are:

```text
REL
LEARN
TEACH
OUTCOME
CTX
EVID
CAP
DATA
SEC
EVAL
OPS
```

## How to read local documents

### Current implementation evidence

A local document may support an implementation claim only when it identifies:

- exact commit SHA;
- branch or PR;
- commands and environment;
- actor and tenant;
- real user path;
- database/workflow evidence;
- failures and skipped paths;
- provider/config/date where applicable;
- explicit limitations and non-claims.

### Historical evidence

Documents tied to older SHAs, old Wave programs, Legacy runtime, former `COMP-*`, Asset Loop or old product wording remain historical evidence only.

Their useful contents may include:

- failure cases;
- test fixtures;
- provider incompatibilities;
- migration hazards;
- deterministic capability behavior;
- runtime and security lessons;
- screenshots and reproduction steps.

Historical status never promotes old product meaning into current authority.

### Deleted documents

Many old local implementation contracts were deleted on `rewrite/full-framework`. Git history is the correct place to retrieve them. Do not restore them as active guidance merely for convenience.

## Prohibited interpretation

Do not use local implementation documents to reintroduce:

- generic article/page authoring;
- giant manual Component Editor requirements;
- CMS-style field/block editorial workflow;
- independent content publication backend;
- old `COMP-01`–`COMP-20` acceptance;
- one aggregate “complete Asset Loop” claim;
- Legacy runtime or shadow/parity authority;
- test-count-based completion.

## Updating local evidence

When implementation changes:

1. keep prior exact-head records immutable or clearly historical;
2. create a successor evidence record rather than rewriting history;
3. map new evidence only to current requirement IDs;
4. keep automated, browser, human, live-provider and preview evidence separate;
5. do not claim Product Owner acceptance without an explicit release-level decision.
