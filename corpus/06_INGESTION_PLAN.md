# Ingestion and Retrieval Plan

## 1. Source registration

Register each document before extracting content:

```text
documentId
sourceType
authority
version
exam years
distribution scope
public-export policy
content hash
```

The ingestion process must fail closed when a source has no distribution classification.

## 2. Structure-first extraction

### Syllabus

Chunk by:

```text
topic
subtopic
learning outcome number
practical section
mathematical requirement
data-table section
```

Never mix two learning outcomes merely because they are on the same page.

### Calculation textbook

Chunk by:

```text
chapter
section heading
worked example
hint/caution box
end-of-chapter checklist
revision problem
answer reference
```

Preserve the distinction between explanation, worked example, problem and answer.

## 3. Private and public indexes

```text
private index
├── official syllabus chunks
└── secondary-reference chunks

public-safe index
├── original Teacher Notes
├── original structured cases
└── source metadata and page references
```

The application must choose the index from the deployment policy. Do not rely on the LLM to enforce distribution rights.

## 4. Retrieval fields

Every indexed chunk should support filters for:

```text
examBoard = CAIE
syllabusCode = 9701
syllabusVersion = 2025-2027
level
topic
calculationFamilyId
learningOutcomeId
sourceType
distributionScope
```

## 5. Retrieval v0

Use metadata filtering plus a lexical ranker before adding embeddings.

Recommended local chain:

```text
query classification
→ board/version/family filters
→ lexical top 20
→ deterministic source-type weighting
→ final top 5
→ persisted retrieval trace
```

Suggested weighting:

```text
exact learningOutcomeId match      +8
exact calculationFamilyId match    +6
official syllabus source           +4 for scope questions
teacher note source                 +4 for explanation/how-to questions
structured case source              +4 for worked-example questions
title exact phrase                  +3
```

## 6. Retrieval trace

Persist:

```text
query
conversation evidence
route
filters
index version/hash
candidate chunk IDs
raw lexical scores
source-type boosts
selected chunk IDs
rejected chunk IDs and reasons
```

## 7. Corpus production workflow

```text
source registered
→ extracted
→ chunked
→ teacher reviews page/section mapping
→ private index built
→ original Teacher Note drafted
→ Teacher Note reviewed
→ structured cases authored
→ retrieval eval added
→ release to school internal environment
```

## 8. Definition of done for the first slice

A query about balanced coefficients must retrieve:

1. the current syllabus outcome governing the mole/stoichiometry domain;
2. `TN-001`;
3. no unrelated titration note in the top three.

A complete MgO learner attempt must:

1. retrieve the route note;
2. discover the governed MASS capability;
3. invoke Learner Diagnosis;
4. create a resolvable Diagnosis trace.

An incomplete attempt must not invoke Learner Diagnosis.
