export const WORKFLOW_CATALOG = [
  { kind: "LEARNER_TASK", title: "Learner task and product action routing", nodes: ["classify_product_action", "explanation_subgraph", "diagnosis_subgraph", "library_action", "schedule_action"], interrupts: [] },
  { kind: "EXPLANATION", title: "Evidence-grounded explanation", nodes: ["compile_context", "retrieve_evidence", "synthesize", "persist_response"], interrupts: [] },
  { kind: "DIAGNOSIS", title: "Bounded Attempt interpretation and deterministic calculation check", nodes: ["compile_context", "prepare_attempt", "capture_attempt", "execute_capability"], interrupts: [] },
  { kind: "ASSET_RUNTIME", title: "Exact ActivityPlan Asset Stage runtime", nodes: ["run_exact_asset_stage"], interrupts: [] },
  { kind: "TEACHER_REVIEW", title: "Teacher Review", nodes: ["teacher_interrupt"], interrupts: ["TEACHER_REVIEW_REQUIRED"] },
  { kind: "RETRY_OUTCOME", title: "Retry and governed Outcome", nodes: ["assign_activity", "learner_retry_interrupt", "teacher_result_interrupt"], interrupts: ["LEARNER_RETRY_REQUIRED", "RETRY_RESULT_REVIEW_REQUIRED"] },
  { kind: "COMPONENT_LIFECYCLE", title: "Component evaluation and expert publication", nodes: ["system_evaluation", "expert_publication_interrupt"], interrupts: ["EXPERT_PUBLICATION_REVIEW_REQUIRED"] },
] as const;
