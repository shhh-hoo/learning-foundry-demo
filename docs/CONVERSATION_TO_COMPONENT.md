# Conversation to Component

The vertical slice preserves an explicit chain:

```text
conversation-mgo-001
→ evidence-mgo-ratio-001
→ candidate-ratio-transfer-001
→ stoichiometric-product-mass@1.1.0 draft
→ Foundry evaluation
→ expert approval
→ immutable publication
```

`LearningConversation`, `DiagnosticEvidenceArtifact`, `ComponentCandidate`, and schedule/artifact types live in `src/experience/types.ts`. Orchestration lives outside React in `src/experience/orchestration.ts`.

## Contract boundary

The published component provenance union is intentionally unchanged. `CONVERSATION_DERIVED` is draft-only Foundry metadata containing the candidate ID, source conversation IDs, and source evidence IDs. The component remains `EXPERT_AUTHORED` because learner evidence proposes a change but does not author or approve a published contract.

Promotion clones the published `1.0.0` component into a `1.1.0` draft, strengthens its governed ratio hint, removes review/publication metadata, and sets evaluation to `NOT RUN`. Approval stays disabled until the existing `evaluateComponent` authority passes. Publication continues through `publishApprovedComponent`.

This avoids duplicating standard data, published content, failure-code definitions, component lifecycle, evaluation, or publication logic.
