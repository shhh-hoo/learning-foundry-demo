# 9701 Calculation Corpus v0.1

**Scope:** Cambridge International AS & A Level Chemistry 9701, 2025–2027

**Distribution:** `SCHOOL_INTERNAL`
**Purpose:** Retrieval, structured calculation cases, Learner Diagnosis, Agent routing and AgentEval.

This pack starts the real corpus without placing the original PDFs or verbatim textbook chunks in a public repository.

## Product truth

The syllabus is the authority for current scope. The calculation textbook is a secondary pedagogical reference. Teacher Notes and structured cases are governed school-authored assets.

The first product route is not “answer any chemistry question.” It is:

```text
complete problem evidence
→ identify calculation family
→ retrieve the relevant governed resource
→ choose a supported calculation strategy
→ run deterministic or bounded validation
→ diagnose the first pedagogical issue
→ preserve an auditable trace
```

## Included

- `01_COVERAGE_MATRIX.md`: current 9701 calculation-family map.
- `02_SOURCE_MANIFEST.json`: source authority and distribution rules.
- `03_CALCULATION_FAMILIES.json`: machine-readable family registry.
- `04_RETRIEVAL_CHUNK_SCHEMA.json`: schema for private indexed chunks and public original notes.
- `05_CALCULATION_CASE_SCHEMA.json`: schema for governed calculation cases.
- `06_INGESTION_PLAN.md`: implementation path from PDFs to searchable corpus.
- `07_ROUTE_POLICY_REQUIREMENTS.md`: application-level route rules derived from the first live AgentEval.
- `08_CODEX_IMPLEMENTATION_BRIEF.md`: bounded implementation brief.
- `teacher-notes/`: first original retrieval resources.
- `cases/`: first original structured cases.
- `agent-eval/`: retrieval and routing eval blueprints.

## Source placement

Expected local-only source directory:

```text
private-sources/
├── 9701-2025-2027-syllabus.pdf
└── Chem_Calculation_Book_Almost_Everything.pdf
```

Add `private-sources/` and generated private indexes to `.gitignore`.

## Current priority

P0 families establish the A-Level Chemistry Calculation Trainer narrative:

```text
molar mass / amount
→ reacting mass
→ limiting reagent
→ purity or yield
→ gas/solution/titration evidence
→ multi-stage strategy selection
→ units and significant figures
```

Kp remains engineering-only legacy regression unless deliberately reintroduced as a governed product capability.
