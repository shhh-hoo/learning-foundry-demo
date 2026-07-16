# Data-origin policy

Product runtime records may use only `USER_INPUT`, `PRESET_INPUT`, `MODEL_OUTPUT`, `TOOL_OUTPUT`, `SYSTEM_EVENT`, `HUMAN_ACTION` and `HUMAN_REVIEW`.

Examples are read-only `EXAMPLE_ONLY`. Test and AgentEval data are confined to tests, fixtures and `agent-eval`; production modules may not import those directories. Presets prefill text only. A model response, tool call, diagnosis, Library write, Schedule write, pattern, candidate, review and Registry record must each be caused by its real runtime or human action.

The current resource entries are `CURATED_LOCAL_RESOURCE`: curated local learning-resource metadata, not retrieved syllabus documents. `config/resources/learning-resources.json` keeps a separate extension point for future authoritative syllabus-document retrieval.

AgentTrace, Learner Diagnosis and AgentEval evidence is file-backed under `.local-data/`. `runPurpose` and separate physical directories prevent AgentEval cases from entering Product Pattern, Candidate or statistics. Browser localStorage contains UI session state only and is not authoritative for these records. UI reset, Product evidence clearing and AgentEval evidence clearing are intentionally separate operations.

Field completeness is not evidence provenance. A Diagnosis context is accepted only when its `problemContextEvidence` quotes can be exactly located in the current user message and its equation, numbers, units, target and answer requirement agree with those quotes.
