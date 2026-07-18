export const WORKFLOW_CATALOG = [
  { kind: "LEARNER_TASK", title: "Learner task and product action routing", nodes: ["classify_product_action", "explanation_subgraph", "diagnosis_subgraph", "library_action", "schedule_action"], interrupts: [] },
  { kind: "EXPLANATION", title: "Evidence-grounded explanation", nodes: ["compile_context", "retrieve_evidence", "synthesize", "persist_response"], interrupts: [] },
  { kind: "DIAGNOSIS", title: "Attempt capture and explicit unavailable capability boundary", nodes: ["capture_attempt", "record_capability_unavailable", "persist_review_required_observation"], interrupts: [] },
  { kind: "TEACHER_REVIEW", title: "Teacher Review", nodes: ["teacher_interrupt"], interrupts: ["TEACHER_REVIEW_REQUIRED"] },
  { kind: "RETRY_OUTCOME", title: "Retry and governed Outcome", nodes: ["assign_activity", "learner_retry_interrupt", "teacher_result_interrupt"], interrupts: ["LEARNER_RETRY_REQUIRED", "RETRY_RESULT_REVIEW_REQUIRED"] },
  { kind: "COMPONENT_LIFECYCLE", title: "Component structural preflight", nodes: ["structural_preflight"], interrupts: [] },
] as const;
