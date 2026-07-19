# CAP-era stack reconciliation checkpoint

Date: 2026-07-19

Status: **DRAFT GUIDANCE-ONLY CHECKPOINT — NO PRODUCT BEHAVIOR OR CAP COMPLETION CLAIM**

## Current authority

`learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`

Learning Foundry is an AI Learning Orchestration Platform. Capability supply is
subordinate to Context, Diagnosis, Capability Resolution, runtime orchestration,
learner interaction, teacher intervention, Evidence and governed Outcome.

## Exact source lineage

This branch starts exactly from retained PR #26 evidence head:

`b981f88cf2bf93fc9d1c0b1e7cdf34ef6c74984d`

It carries the current implementation guidance from RW-00 authority-sync
checkpoint:

`4e2ecd9fa0f566332c44411155192f00bcec52de`

Preserved stack checkpoints:

- PR #22 audit head: `b6f023fe995e44e714bf5da2c2096128e1def9fe`;
- original RW-00 checkpoint: `1edbbc1a72fd7c675e234834bcf56d627faf9b17`;
- RW-01 replay/recovery: `78fe22ffe167f59cbb0b872478263d36044319d8`;
- RW-02 implementation/evidence: `ff4d43210155a7fb7ce517544d64e1a61958dc98` / `a85c64a07361dc9a90b82f681edd27e5931c7452`;
- RW-03 implementation/evidence: `df678ed7de439744b6b6f19c73900d499bc90048` / `b981f88cf2bf93fc9d1c0b1e7cdf34ef6c74984d`.

No historical branch or checkpoint is rewritten by this package.

## PR #27 quarantine

PR #27 is explicitly excluded from this branch and from the next-package base:

- base: `b981f88cf2bf93fc9d1c0b1e7cdf34ef6c74984d`;
- implementation checkpoint: `9040fbe34d6c5de96a859af6cbea5e42d4578e4a`;
- evidence head: `1ef952823b1687936e2b23f33e8f9f5588a613c8`;
- disposition: historical Draft / REWORK / do not merge as a unit.

Valid exact-version, check-binding, tenant, disable and rollback primitives from
PR #27 require later selective reimplementation after the current capability and
executable ComponentAsset runtime contracts exist. Its migration, commands,
field/block comments, editorial change requests and publishing-workbench
semantics are not imported here.

## Reconciled dependency order

1. Context Compiler over canonical ContextItems, carryover and Evidence;
2. Diagnosis and Capability Resolution with candidates, exclusions and no-match;
3. ActivityPlan and executable ComponentAsset runtime delivery;
4. learner interaction and teacher intervention;
5. reviewed Retry, Transfer, Retention and Outcome;
6. gap-driven reuse, parameterization, composition, adaptation or generation;
7. capability checks, confirmation, scoped availability, disable and rollback;
8. asset, routing and learning-strategy optimization, Eval and Showcase evidence.

Context Compiler implementation is not part of this package.

## Evidence boundary

- `AGENTS.md` and `docs/NATURAL_ATTEMPT_ACCEPTANCE.md` carry the applicable
  RW-00 `4e2ecd9` guidance without product-behavior changes.
- `README.md` retains the RW-01 through RW-03 operational guidance while adopting
  the current authority and CAP/CMS evidence boundary.
- RW-02 and RW-03 evidence remain exact-checkpoint historical records and are
  labelled with the authority under which they were gathered.
- Old `COMP-*`, CMS or publication evidence cannot establish current `CAP-*`
  completion.
- No runtime, schema, migration, API, UI, test, dependency or configuration file
  changes in this package.
- No merge, preview, deployment, production or cutover authority is granted.
