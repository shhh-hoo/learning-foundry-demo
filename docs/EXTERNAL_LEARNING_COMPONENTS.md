# External Learning Components

Learning Foundry can catalog and launch reviewed public learning resources without treating them as native Foundry Components or Learning Outcomes.

## Surface

Open:

```text
http://127.0.0.1:4173/?view=components
```

The current registry is:

```text
config/external-learning-components/registry.json
```

It is validated at runtime and in tests against the versioned `ExternalLearningComponent` contract.

## What the first catalog contains

### Launchable in the current non-commercial public-showcase scope

- ChemCollective — Stoichiometry and Solution Preparation;
- ChemCollective — Standardization of NaOH with KHP;
- ChemCollective — Determining Stoichiometric Coefficients.

These are external links only. Foundry does not copy, modify, repackage or claim ownership of the activity content.

### Visible but unavailable pending review

- PhET Balancing Chemical Equations;
- PhET Molarity;
- PhET pH Scale;
- Desmos Graphing Calculator API candidate;
- GeoGebra Classic;
- H5P reviewed-package intake.

A URL, provider name or open-source technology does not grant production, commercial, embed, modification or learner-data authority.

## Launch Evidence

A permitted launch writes a local showcase record under:

```text
learning-foundry:external-component-launches:v1
```

The record contains component identity, version, provider, integration mode, timestamp and `USER_ACTION` provenance.

Every launch record is explicitly:

```text
evidenceClass: SHOWCASE_EXTERNAL_LAUNCH
outcomeEligible: false
```

Opening a resource does not prove completion, understanding, transfer, retention or any other Learning Outcome.

## Acceptance rules

A component is launchable only when:

- its status is an approved status matching its integration mode;
- privacy handling is approved;
- the required HTTPS URL, package reference or API provider exists;
- the deployment scope matches the rights decision;
- the component does not claim Learning Outcome eligibility.

The registry rejects:

- non-HTTPS external launch URLs;
- duplicate component identity/version pairs;
- approved launch status without privacy approval;
- link-only approval attached to an embed or package mode;
- Outcome eligibility without a validated completion signal;
- any initial external component that claims canonical Outcome writes.

## Relationship to native Foundry Components

External components are provider-owned resources. Native `DiagnosticLearningComponent` snapshots remain Foundry-governed, versioned, content-hashed and published through the existing Expert Review lifecycle.

An external activity may later produce governed Evidence through a separately reviewed xAPI, LTI, provider API or custom adapter. That Evidence must still pass identity, provenance, privacy, permission and pedagogical interpretation before it can contribute to a Learning Outcome.

## Non-claims

This foundation does not provide:

- commercial-use approval for PhET, GeoGebra or Desmos;
- a reviewed H5P package;
- iframe or API integration;
- provider completion verification;
- canonical Product State storage;
- automatic Teacher Review;
- automatic Learning Outcome;
- automatic publication as a native Foundry Component.
