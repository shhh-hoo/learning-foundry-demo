# Product Experience Layer

The Product Experience is available at `?view=experience`. It is a deterministic product simulation connecting four visible spaces:

- Chat retrieves the CAIE 9701 Stoichiometry standard, selects the published mass component, and calls the existing runtime preview adapter.
- Library groups trusted resources, published components, diagnostic evidence, correction artifacts, and candidates.
- Schedule creates one immediate review route and one delayed transfer retry three days later.
- Component Lifecycle turns three matching actual local Agent runs into a teacher-reviewable pattern.

The orchestration is deliberately bounded. It does not call an LLM or accept arbitrary chemistry questions. Its response is grounded in `FORMULA / WRONG_STOICHIOMETRIC_RATIO`, the failure code returned by `evaluatePreviewAttempt` for the selected published component.

Session state is saved in browser `localStorage`. Start, refresh/resume, complete/reopen, and Reset demo are supported. No secret, authentication data, production identity, or multi-user state is stored.

The three similar cases are labelled “Seeded demonstration evidence · Not production analytics.” They make the lifecycle understandable without implying a real student database or cross-user measurement.
