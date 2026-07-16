# Runtime-boundary acceptance

Docs authority: `learning-foundry-docs@e6ec2408d18fc6850e92c996b36712dbd5be9df5`

Implementation baseline: `learning-foundry-demo@107bd9335430a28aacfc856a76e54a17d11792e4`

## Architectural problem addressed

The current Chemistry reference path was operational, but its server entrypoints directly assembled DeepSeek orchestration, lexical corpus retrieval, Standard Trainer calls, live AgentEval gateway calls, file trace persistence and the local Component Registry. Replacing commodity infrastructure would therefore have required editing policy-bearing callers.

This milestone establishes the smallest current-code-backed seams without changing runtime authority or product behavior. It does not select or integrate a candidate framework.

## Characterization retained

Existing focused tests continue to cover:

1. initial route and orthogonal obligations;
2. ordered capability resolution;
3. required and forbidden tool behavior;
4. `sourceRefs` / `evidenceRefs` separation;
5. unsupported-claim rejection;
6. problem-context provenance;
7. PRODUCT / AGENT_EVAL physical separation;
8. lexical corpus-search response shape;
9. diagnostic Component publication and content-hash validation;
10. AgentEval baseline selection and drift detection.

This change adds explicit characterization for the full lexical response contract and local Registry version/reset behavior.

## Boundaries and current adapters

| Responsibility | Contract | Current adapter | Rewired entrypoint |
|---|---|---|---|
| Agent / workflow execution | `AgentExecution` | `legacyDeepSeekAgentExecution` | `scripts/agent-gateway-server.ts` through `createAgentGateway` |
| Evidence Search | existing `CorpusSearchService` | `LegacyLexicalEvidenceSearch` | Agent gateway corpus construction |
| Learning Capability Runtime | `LearningCapabilityRuntime` | `LegacyTrainerCapabilityRuntime` | `createAgentToolExecutor` Diagnosis execution |
| AgentEval target transport | `AgentEvalTarget` | `LegacyGatewayAgentEvalTarget` | `scripts/agenteval-live.ts` |
| trace persistence | `AgentTraceStore` | `FileAgentTraceStore` | purpose-separated Agent gateway trace repositories |
| diagnostic Component persistence | `DiagnosticComponentRepository` | `LocalShowcaseComponentRepository` | `scripts/demo-registry-server.ts` |

The existing `AgentModelClient` remains the narrow model-provider contract; no duplicate provider abstraction was added. Agent and workflow execution remain one boundary because the current code does not justify separate lifecycles.

## Foundry policy deliberately retained

Adapters do not own:

- route classification, obligations or required tool order;
- source/evidence reference validation and unsupported-claim rejection;
- problem-context and learner-working provenance;
- corpus delivery policy;
- diagnostic Component schema, publication-status and content-hash acceptance;
- AgentEval cases, taxonomy, eligibility, graders or report policy.

`AgentEvalTarget` is only the transport seam for target health and one `AGENT_EVAL` Agent run. Suite selection, checkpoint/baseline/layer/dimension selection, the case loop, grading, eligibility, persistence and report semantics remain in `scripts/agenteval-live.ts` and the existing AgentEval modules. This milestone does not claim a stable external suite-runner boundary.

The provider-neutral trace contract and persisted observable-message types live in `src/agent/trace-store.ts`; provider identity is a string and the contract does not import the DeepSeek adapter. `ModelMessage` remains a DeepSeek adapter extension, while `FileAgentTraceStore` accepts the neutral observable shape.

The diagnostic Component repository is asynchronous so a durable or remote implementation can satisfy the same contract. The local repository stores already accepted snapshots. The server awaits the Foundry-owned `acceptPublishedDiagnosticComponent` check and repository operations; the prior `accept` method remains as an asynchronous compatibility delegate.

`LearningCapabilityRuntime` treats `capabilityId` and `capabilityVersion` as authoritative. The Legacy Trainer payload is constructed from that governed identity, and any conflicting identity already present in `input` fails before the Trainer is called.

## Authorized AgentEval correction

- planned cases `= 0` report `UNPLANNED`;
- planned cases `> 0` and executed cases `= 0` report `NOT_RUN`;
- incomplete planned coverage reports `PARTIAL`;
- eligible complete coverage reports `COMPLETE`;
- explicit empty layer or dimension selection exits non-zero before provider health checks;
- checkpoint and baseline subsets cannot report complete full-suite coverage;
- a completed full unfiltered run may retain zero-planned categories as `UNPLANNED` without failing for that reason.

No Learning Loop or Reference Pack cases were invented.

## Remaining Chemistry coupling

`CorpusSearchService`, its filters/results, corpus ingestion and delivery evidence still contain CAIE 9701 and Calculation Family fields. `DiagnosticComponentRepository`, the current capability registry, Standard Trainer adapter, attempt canonicalization, components and domain graders remain Chemistry Reference Pack implementations. These names and records are reported honestly; this PR does not claim domain-neutral Core extraction.

## Validation

Automated validation completed:

- `npm test` — 28 files, 158 tests passed;
- `npm run check` — passed;
- `npm run build` — passed;
- `git diff --check` — passed;
- focused boundary and AgentEval tests — passed.

Live AgentEval checkpoint and baseline:

`NOT RUN — required live environment unavailable`

The real DeepSeek key and model were not configured. Fixture tests are not reported as live validation.

## Scope, rollback and authority

Product behavior is unchanged for conforming capability calls. In addition to the authorized AgentEval empty-selection and coverage-state correction, contradictory capability identities now fail before transport as required by the governed contract. The other changes are boundary typing, naming and asynchronous call-site corrections. No production dependency or candidate framework was added. No Legacy implementation was deleted.

Rollback is a single revert of this Program PR: current adapters and compatibility exports remain intact, and no data migration or canonical Product State write occurred.

Candidate framework authority: **NOT GRANTED**.

Legacy deletion authority: **NOT GRANTED**.

Next infrastructure milestone: candidate shadow-runtime parity under the same Foundry-owned contracts, after the required broader program ordering is satisfied.
