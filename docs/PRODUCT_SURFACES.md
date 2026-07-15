# Product surfaces

Learning Foundry separates four contexts that previously competed on one screen.

## Learner Workspace

`?view=learner` contains only Chat, Library and Schedule. It exposes curriculum source, learning tool and a student-readable detected issue behind “Why this answer?”. It does not expose candidates, evidence IDs, hashes, schemas, publication controls or engineering limitations.

## Foundry Studio

`?view=studio` contains Pattern Inbox, Candidate, Component Contract Checks, Expert Review and Registry. It owns evidence-backed component improvement and governance, but contains no learner Chat, Library or Schedule and no demo narration.

## Engineering Inspector

`?view=inspector` contains Agent Traces, AgentEval Reports, Learner Diagnosis, Component Contract Checks, Runtime Validation, Component Registry and Boundaries. It is the only Learning Foundry surface that intentionally exposes identifiers, tool metadata, hashes, schemas and runtime boundaries.

## Demo Shell

`?view=demo` is outside the products. It embeds the real routes, identifies persona and time, explains received events and gates the guided story without mutating product state.

Legacy query links remain compatible: `?view=experience` maps to Learner Workspace and `?view=governance` maps to Foundry Studio.
