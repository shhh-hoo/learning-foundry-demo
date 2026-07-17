# Product surfaces

Learning Foundry separates five contexts that previously competed on one screen.

## Learner Workspace

`?view=learner` contains only Chat, Library and Schedule. It exposes curriculum source, learning tool and a student-readable detected issue behind “Why this answer?”. It does not expose candidates, evidence IDs, hashes, schemas, publication controls or engineering limitations.

## External Component Catalog

`?view=components` contains reviewed external learning resources and license-gated candidates. A component is launchable only when its integration mode, deployment scope, license, privacy and Evidence status are approved. Link launches create local showcase launch records only; they never create Learning Outcomes. PhET, Desmos, GeoGebra and unreviewed H5P packages remain unavailable until their specific integration and deployment terms are approved.

## Foundry Studio

`?view=studio` contains a configurable repeated-diagnosis signal, Candidate with a minimal governed Hint Editor, Component Contract Checks, Expert Review and Registry. The signal is a simple `componentId + failureCode` heuristic, not mature automated Learning Pattern Analysis. The Hint Editor is not a complete Component Studio: it edits one governed hint and records base version, changed field, before/after values, teacher rationale and resolvable Agent/Diagnosis provenance. Contract checks run against the modified draft, and publication requires a semantic diff from the base.

## Engineering Inspector

`?view=inspector` contains separately selectable Product and AgentEval Agent Traces/Diagnoses, AgentEval Reports, Component Contract Checks, Runtime Validation, Component Registry and system boundaries. It is the only Learning Foundry surface that intentionally exposes identifiers, tool metadata, hashes, schemas and runtime boundaries.

## Demo Shell

`?view=demo` is outside the products. It embeds the real routes, identifies persona and time, explains received events and gates the guided story without mutating product state.

Legacy query links remain compatible: `?view=experience` maps to Learner Workspace and `?view=governance` maps to Foundry Studio.
