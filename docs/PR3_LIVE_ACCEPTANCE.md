# PR #3 live acceptance evidence

Date: 2026-07-16

Branch: `codex/product-surfaces-and-demo-shell`

Product contract: `learning-foundry-docs@1e08d035b13fd3a51e5ef48710e93fed6e9833ac`

Trainer integration: `standard-trainer-demo@8f6e96159dcef484e5a1796c8d6f2ae282ab5849`

## Delivery boundary

The server-side corpus delivery policy is version `1.0.0`, approved by Shijia Hu for bounded `PRODUCT` and `AGENT_EVAL` delivery to DeepSeek. Its content hash is `8b3f8d46acf6ea52330d7b9397b5d33d74631f89d28e87e479e03fdfb830f22c`.

Policy enforcement fails closed for unapproved provider, purpose, source type, or distribution scope; caps delivery at five results and 100 words per excerpt; rejects raw PDF bytes, full documents, local paths, API keys, and Authorization headers; and persists only policy and retrieval metadata rather than delivered excerpts.

## Commands and local checks

The following commands completed against the real local system:

```text
npm run check                         PASS
npm test                              PASS — 113/113
npm run build                         PASS
npm run policy:audit                  PASS
npm run corpus:ingest                 PASS
npm run corpus:inspect                PASS — 934 chunks
npm run corpus:export:public          PASS
npm run demo:local                    PASS — ports 4173–4177
npm run agenteval:checkpoint          PASS — 6/6
npm run agenteval:live                COMPLETE — 7/18
npm run agenteval:report              PASS — suite 1.1.0
```

Corpus index `v0.1-6f7e2a2945ca` contains 373 official-syllabus chunks, 555 secondary-reference chunks, and six Teacher Note chunks. Both PDFs, the private index, and the generated public-safe export remain ignored and untracked. The public-safe export contains no private chunks.

## Six-case checkpoint

Run: `agenteval-2026-07-16T10-54-00-593Z-fdc9dd0e`

Result: 6/6 passed; required-tool, forbidden-tool compliance, Diagnosis fidelity, and source grounding were all 1.0; estimated cost was USD 0.0022615824 with 100% pricing coverage.

| Case | AgentTrace | Diagnosis |
|---|---|---|
| A course explanation | `agent-trace-d50f4a04-5dec-45e3-b474-7dd12916dfc9` | — |
| B incomplete working | `agent-trace-510c6878-927b-4e73-9770-67329148536a` | — |
| C complete MgO diagnosis | `agent-trace-e6f22001-9e16-43c8-b353-1af71b60e3f3` | `trainer-trace-7cb842bd-8365-4bfd-b20a-1c3ba420f74e` |
| D multi-stage incomplete evidence | `agent-trace-cd649bc9-e96c-48e7-8d69-49b9d16e431b` | — |
| diagnosis-01 | `agent-trace-eb952f77-da67-4e0f-a42d-6d8e20f941d8` | `trainer-trace-b70d5909-e41f-4355-9f26-70694d726276` |
| diagnosis-02 | `agent-trace-25e39539-1844-4a45-ad14-71ab2ae0e8ed` | `trainer-trace-796fc093-3ffe-4656-a478-903de94bf7c7` |

The checkpoint RetrievalTrace is `retrieval-trace-7b3171ff-ab35-4b06-aa92-1b67836cb58e`.

## Manual PRODUCT diagnosis

Fresh conversation: `manual-product-new-task-20260716T185500-codex`

AgentTrace: `agent-trace-40d68043-6dc4-49bb-9d51-124f23cf3f62`

Diagnosis: `trainer-trace-cf8e0c1c-2bbe-4e7e-a1e8-2f0d9d192948`

The run used `runPurpose=PRODUCT`, route `LEARNER_DIAGNOSIS_COMPLETE`, and successful tool order `list_capabilities → get_capability → run_learner_diagnosis`. The persisted Diagnosis resolves by ID, appears in the PRODUCT list, and reports `WRONG_STOICHIOMETRIC_RATIO`. The same conversation ID returns no records from the AGENT_EVAL namespace. Source and evidence reference classes remain separated.

## Full AgentEval baseline

Run: `agenteval-2026-07-16T10-55-34-288Z-4a3da608`

Suite: `1.1.0`

Result: 7/18 passed

- Required-tool metric: 8/15 (0.5333)
- Forbidden-tool compliance: 12/14 (0.8571)
- Diagnosis fidelity: 3/5 (0.6)
- Source grounding: 2/5 (0.4)
- Known estimated cost: USD 0.0050773184
- Pricing coverage: 16/18 (0.8889)

Remaining failures are retained as an honest baseline: `retrieval-03` route policy, `retrieval-04` provider response validation, `retrieval-05` source references, `diagnosis-01` problem-context grading, `diagnosis-05` and `diagnosis-06` Diagnosis fidelity, `gap-01` through `gap-04` required tools, and `adversarial-02` required tools. These cases were outside the six-case checkpoint repair boundary and were not hidden or converted to fixtures.

## Evidence locations and safety

Sanitized local evidence is preserved under `.local-data/acceptance/2026-07-16-pr3/` and is intentionally gitignored. It contains checkpoint and full run/report files, the six checkpoint AgentTrace records, three checkpoint Diagnosis records, the checkpoint RetrievalTrace, the manual PRODUCT AgentTrace and Diagnosis, corpus inspection metadata, and the policy version/hash.

No API key, Authorization header, hidden reasoning, raw PDF, private generated chunk, or full school-internal source corpus is committed. PR #3 should remain draft pending owner audit of the full-suite limitations above.
