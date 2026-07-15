# Expert review and publishing

Lifecycle:

```text
EMPTY → DRAFT → EVALUATION_FAILED | READY_FOR_REVIEW
READY_FOR_REVIEW → APPROVED → PUBLISHED → REVISION_DRAFT
```

Rules enforced by `ComponentLifecycle`:

- a failed or absent evaluation cannot be approved;
- an unapproved component cannot be published;
- editing invalidates evaluation;
- editing an approved component removes approval;
- publication creates a deeply frozen snapshot;
- a revision never overwrites a published version.

Version increments are major for schema-breaking change, minor for content change, and patch for compatible metadata change. The static demo records reviewer and publisher identities as authored demo metadata; it does not authenticate those identities.

