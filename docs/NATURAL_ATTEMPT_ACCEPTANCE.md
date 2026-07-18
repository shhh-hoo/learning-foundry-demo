# Natural Learner Attempt acceptance

Date: 2026-07-18

Branch: `rewrite/full-framework`
Starting head: `5fe63c96373413daff89fd0358c154f7c985fdce`

## Product outcome

The Learner Workspace now accepts a normal-language problem plus the learner's working. Learners do not need to enter internal Capability IDs, schemas, contracts, or JSON. They may optionally select a learner-facing activity hint or explicitly open manual calculation fields.

For an automatic Attempt, one bounded model call may extract only explicit calculation values. Foundry then re-resolves the active Capability inside the Task course, validates the extracted fields through the Reference Pack, executes the deterministic calculation, and keeps the resulting Observation subject to Teacher Review. The model cannot create a diagnostic claim, formal Review, or Learning Outcome.

When interpretation is unavailable, ambiguous, unsupported, malformed, or invalid, the original Attempt is still captured and Foundry creates a teacher-review-required unavailable Observation. There is no second model call.

## Frozen live acceptance

Provider: DeepSeek

Model: `deepseek-v4-flash`

Cases: fixed before execution

Replacement attempts: none
Favourable resampling: none

### Cohort 1 — pre-repair

Three of three calls failed with:

`400 Thinking mode does not support this tool_choice`

This established that DeepSeek's default thinking mode was incompatible with the forced tool choice used for structured extraction.

### Cohort 2 — transport repair only

Thinking was explicitly disabled for this extraction call. All three provider calls completed, but product acceptance remained 0/3:

- the two supported calculations returned units inside numeric value fields and did not satisfy the Reference Pack input contract;
- the insufficient-information case returned no parsed object.

These failures were retained. They established that transport compatibility alone did not produce a valid product boundary.

### Diagnostic cohort

Two diagnostic calls, with no resampling, exposed the exact mismatch:

- `amount: "0.250 mol"` and `volume: "500 cm3"` were returned instead of separate value and unit keys;
- a non-match could return the literal string `"null"` and stray values.

The repair made the generic field contract explicit and added deterministic normalization that may only split an explicit numeric value from an allowed unit. It cannot invent, convert, grade, or diagnose content. Non-matches are normalized to `capabilityPublicKey: null` and empty fields.

### Cohort 3 — contract repair

The same three frozen cases were each called once:

| Case | Result | Reference Pack validation | Tokens |
|---|---|---:|---:|
| Explicit molar concentration | `MATCHED` | passed | 1,986 |
| Explicit titration with learner-facing hint | `MATCHED` | passed | 2,098 |
| Insufficient information | `AMBIGUOUS` | not applicable; safe exit | 1,942 |

Final frozen result: **3/3 accepted, zero resampling**.

Across all cohorts, 11 provider calls were retained: 6 failed acceptance before the complete repair, 2 diagnostic calls exposed the mismatch, and 3 passed after the repair.

## Verification

- TypeScript, lint, production build, and zero-Legacy scan passed.
- Unit, workflow, and security suite passed: 24 files, 95 tests.
- PostgreSQL integration suite passed twice after the complete repair: 31/31 on each run.
- Additive migration and Component-version upgrade rehearsal passed.
- Final full browser acceptance passed: 12 passed, 2 intentional mobile skips, 0 failed, 0 flaky. It covered the complete Learning Loop, Component Asset Loop, real PDF/image intake, and desktop/mobile role isolation.

## Limits

This acceptance proves that the product can safely translate two representative natural Chemistry calculation Attempts into deterministic active-Pack inputs and can safely stop on insufficient information. It does not prove broad Chemistry coverage, diagnosis quality across all learner wording, pedagogy quality, or learning effectiveness.
