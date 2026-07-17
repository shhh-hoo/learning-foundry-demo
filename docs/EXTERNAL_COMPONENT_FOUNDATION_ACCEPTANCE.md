# External Component Foundation Acceptance

## Authority

- Docs authority: `learning-foundry-docs@260747722e8040972deceed3290bce237676f225`
- Doc 17: §§14–14.1, 16D, 17–18 and 20
- Implementation lane: External Learning Components
- Authority change: Git-reviewed external governance only
- Provider approval: none
- Learning Outcome authority: none
- Canonical Product State change: none
- Legacy deletion authority: `NOT GRANTED`

## Implemented slice

The product route `?view=components` renders a provider-neutral external
learning catalog. The registry and application Module remain separate from
native diagnostic Components and browser `ExperienceState`.

The Git-reviewed authority is:

```text
config/external-learning-components/
├── resources.json
├── review-decisions.jsonl
└── schema.json
```

The committed candidates are discovery snapshots only:

| Resource | Committed status | Launch authority |
|---|---|---|
| PhET Balancing Chemical Equations | `REVIEW_REQUIRED` | none |
| ChemCollective Virtual Lab | `REVIEW_REQUIRED` | none |
| H5P Course Presentation example | `DISCOVERED` | none |

No provider or provider-wide terms were approved. Each resource continues
to require resource- and deployment-specific rights, privacy, tracking and
accessibility evidence.

## Governance behavior

`review-decisions.jsonl` is an append-only decision log. A valid decision
records the resource version, reviewer, timestamp, terms URL, Evidence
reference and hash, deployment scope, four review gates, status and an
optional superseded-decision reference. Current state derives from the
latest valid record; approval and revocation history is never rewritten.

The production log is currently empty because no current candidate has a
complete review. Synthetic test records exercise the approved-link path
without granting a real provider authority.

## Launch Evidence

An approved, deployment-matched link follows:

```text
append LAUNCH_REQUESTED
→ request a new browser window
→ append WINDOW_CREATED or POPUP_BLOCKED
```

Browser telemetry is schema-validated, duplicate-rejecting and fail-closed
on corrupt history. It is local, tamperable, noncanonical operational
Evidence. It has no update, delete, reset or governance method.

`WINDOW_CREATED` means only that the browser returned a window handle. It
does not prove provider load, engagement, completion, correctness or
learning. Every record is `outcomeEligible: false`.

## Deliberate non-scope

- provider or commercial approval;
- iframe, package, API, LTI or xAPI integration;
- sending learner profile, Task, Attempt or Diagnosis data;
- writes to Review, Diagnosis, LearningOutcome or native publication;
- Postgres external-review migration;
- native Component conversion;
- automatic engagement or Outcome claims.

Git remains external-review authority throughout the two Waves. Moving
dynamic review decisions to Postgres requires a separate authority change
after canonical Product State exists.

## Validation

Focused tests cover schema validation, truthful disabled defaults,
append-only decision derivation, revocation, deployment scope, launch order,
popup blocking, duplicate rejection, corrupt-history fail-closed behavior,
Outcome ineligibility and catalog visibility.

Universal validation results are recorded in the pull request. No live
provider launch is required or authorized for this foundation.

## Rollback

Revert the catalog route, external Modules, registry snapshots and tests.
Existing browser launch telemetry, if any later exists, should be exported
or retained rather than silently deleted. No canonical Product State
rollback is involved.
