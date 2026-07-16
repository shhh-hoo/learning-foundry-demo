# Route Policy Requirements

The first live Product traces and 18-case AgentEval showed that prompt-only tool routing is insufficient. The application layer must validate the route.

## Route classes

### `COURSE_EXPLANATION`

Required before `ANSWERED`:

```text
search_learning_resources succeeded
at least one curriculum or Teacher Note source selected
public sourceRefs contain source IDs, not tool-result IDs
```

### `LEARNER_DIAGNOSIS_COMPLETE`

Required before `ANSWERED`:

```text
problem context provenance passed
learner-working provenance passed
capability discovered from registry
run_learner_diagnosis succeeded
diagnosisTraceId resolves
final explanation is faithful to the Diagnosis result
```

### `LEARNER_DIAGNOSIS_INCOMPLETE`

Required behaviour:

```text
status = NEEDS_MORE_EVIDENCE
no successful Learner Diagnosis
name the missing evidence
```

### `CAPABILITY_GAP`

Required behaviour:

```text
list_capabilities first
evaluate supported limitations
record_capability_gap only after registry evidence exists
status = CAPABILITY_GAP or NEEDS_MORE_EVIDENCE
```

## Reference separation

Use different fields:

```text
sourceRefs
→ curriculum, Teacher Note and case source IDs suitable for learner display

evidenceRefs
→ AgentTrace, Diagnosis trace, capability and internal tool-result IDs
```

## Conversation isolation

Manual scenarios and AgentEval cases must use independent conversation IDs unless cross-turn memory is the explicit subject of the case.

## Runtime rejection

Reject a final `ANSWERED` response when a required route obligation is unsatisfied. The rejection should create an auditable route-policy failure, not silently convert the result into success.
