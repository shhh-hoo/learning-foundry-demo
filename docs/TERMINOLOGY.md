# Terminology

Use these exact product terms:

- AgentEval
- Learner Diagnosis
- Component Contract Checks
- Expert Review
- Runtime Validation
- Automated Tests
- Configurable repeated-diagnosis signal
- Publication Gate
- Outcome Measurement

`npm run policy:audit` rejects obsolete standalone shorthand and the previous long-form quality term, plus the old Foundry/Learner/Trainer/Runtime phrases.

Do not present the current `componentId + failureCode` heuristic as mature automated Learning Pattern Analysis. Candidate currently contains a minimal governed Hint Editor, not a complete Component Studio.

## Canonical records and derived representations

Use the classification below when discussing Core or Product State. A
canonical envelope can contain a derived field; that does not make the
derived value canonical.

| Record or field | Classification |
|---|---|
| Learning Task identity, status and linkage | canonical |
| Learning Episode identity, status and linkage | canonical |
| Learning Episode summary | derived representation |
| Conversation Event | append-only canonical interaction record |
| Learner Attempt | canonical |
| Human Review or Decision | append-only canonical governance record |
| Diagnostic Observation identity, provenance and correction chain | canonical envelope |
| Model or deterministic diagnosis payload | versioned derived representation |
| Runtime, Retrieval and Agent Trace | derived operational Evidence |

`sourceRefs` and `evidenceRefs` remain different reference classes. A
runtime-local trace ID cannot be substituted for either class without the
governed lineage that connects it to the relevant record.
