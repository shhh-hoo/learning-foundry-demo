# Product surfaces

Learning Foundry separates four contexts that previously competed on one screen.

## Learner Workspace

`?view=learner` contains only Chat, Library and Schedule. It exposes curriculum source, learning tool and a student-readable detected issue behind “Why this answer?”. It does not expose candidates, evidence IDs, hashes, schemas, publication controls or engineering limitations.

## Foundry Studio

`?view=studio` contains Pattern Inbox, Candidate Review, Component Studio, Foundry Evaluation, Expert Review and Published Registry. It owns evidence-backed component improvement and governance, but contains no learner Chat, Library or Schedule and no demo narration.

## Engineering Inspector

`?view=inspector` contains Events, Learner Trace, Pattern Evidence, Component Diff, Evaluation, Registry, Runtime and Boundaries. It is the only Learning Foundry surface that intentionally exposes identifiers, event payloads, hashes, schemas, runtime metadata and seeded/local-only limitations.

## Demo Shell

`?view=demo` is outside the products. It embeds the real routes, identifies persona and time, explains received events and gates the guided story without mutating product state.

Legacy query links remain compatible: `?view=experience` maps to Learner Workspace and `?view=governance` maps to Foundry Studio.
