# Demo event protocol

Every event uses protocol version `1.0.0` and carries `eventId`, `sessionId`, `type`, `occurredAt`, `actor` and a typed payload. Learning Foundry emits:

- `LEARNER_ATTEMPT_SUBMITTED`
- `CAPABILITY_SELECTED`
- `LEARNER_DIAGNOSIS_COMPLETED`
- `EVIDENCE_PERSISTED`
- `RETRY_SCHEDULED`
- `PATTERN_THRESHOLD_REACHED`
- `CANDIDATE_CREATED`
- `CANDIDATE_EVALUATED`
- `COMPONENT_APPROVED`
- `COMPONENT_PUBLISHED`
- `REGISTRY_COMPONENT_ACCEPTED`

Standard Trainer emits `RUNTIME_COMPONENT_SELECTED` and `RUNTIME_DIAGNOSIS_COMPLETED` in embedded mode. Messages use an explicit parent origin. Demo Shell checks the iframe source window, exact origin, message source label and runtime event shape before accepting an event; unknown types are ignored.
