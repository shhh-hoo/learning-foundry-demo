# Natural Learner Attempt acceptance

Date: 2026-07-18

Branch: `rewrite/full-framework`
Starting head: `5fe63c96373413daff89fd0358c154f7c985fdce`

## Historical status

This is a dated work-package record for the exact starting head above. It is historical implementation and test evidence, not current product authority or current requirement acceptance.

Its former “complete Learning Loop” and “Component Asset Loop” wording described the suite name and scope used at that time. It does not establish current `CAP-*`, Showcase, human-governance, live-provider, preview or Product Owner acceptance.

Current product authority is:

```text
shhh-hoo/learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1
```

The independent exact-head audit remains bound to:

```text
b6f023fe995e44e714bf5da2c2096128e1def9fe
```

No old `COMP-*` or former 113-row evidence maps mechanically to current `CAP-*` completion.

## Product outcome at the recorded checkpoint

The Learner Workspace accepted a normal-language problem plus the learner's working. Learners did not need to enter internal Capability IDs, schemas, contracts or JSON. They could optionally select a learner-facing activity hint or explicitly open manual calculation fields.

For an automatic Attempt, one bounded model call could extract only explicit calculation values. Foundry then re-resolved the active Capability inside the Task course, validated the extracted fields through the Reference Pack, executed the deterministic calculation and kept the resulting Observation subject to Teacher Review. The model could not create a diagnostic claim, formal Review or Learning Outcome.

When interpretation was unavailable, ambiguous, unsupported, malformed or invalid, the original Attempt was still captured and Foundry created a teacher-review-required unavailable Observation. There was no second model call.

## Frozen live acceptance record

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

The repair made the generic field contract explicit and added deterministic normalization that may only split an explicit numeric value from an allowed unit. It could not invent, convert, grade or diagnose content. Non-matches were normalized to `capabilityPublicKey: null` and empty fields.

### Cohort 3 — contract repair

The same three frozen cases were each called once:

| Case | Result | Reference Pack validation | Tokens |
|---|---|---:|---:|
| Explicit molar concentration | `MATCHED` | passed | 1,986 |
| Explicit titration with learner-facing hint | `MATCHED` | passed | 2,098 |
| Insufficient information | `AMBIGUOUS` | not applicable; safe exit | 1,942 |

Final frozen result at that checkpoint: **3/3 accepted, zero resampling**.

Across all cohorts, 11 provider calls were retained: 6 failed acceptance before the complete repair, 2 diagnostic calls exposed the mismatch and 3 passed after the repair.

## Historical verification record

- TypeScript, lint, production build and zero-Legacy scan passed.
- Unit, workflow and security suite passed: 24 files, 95 tests.
- PostgreSQL integration suite passed twice after the complete repair: 31/31 on each run.
- Additive migration and Component-version upgrade rehearsal passed.
- The final historical browser suite passed: 12 passed, 2 intentional mobile skips, 0 failed and 0 flaky.

The browser suite's then-named “complete Learning Loop” and “Component Asset Loop” scopes are exact-head test facts, not current CAP-era or Showcase acceptance.

## Limits

This historical record shows that the checkpoint could translate two representative natural Chemistry calculation Attempts into deterministic active-Pack inputs and safely stop on insufficient information.

It does not prove:

- broad Chemistry coverage;
- current capability-resolution quality;
- current Diagnosis or pedagogy quality;
- teacher-governance validation;
- Transfer or Retention;
- learning effectiveness;
- current live-provider validation;
- preview validation;
- current requirement acceptance;
- merge or cutover readiness.
