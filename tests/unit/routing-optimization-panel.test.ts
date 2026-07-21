// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RoutingOptimizationPanel } from "@/components/RoutingOptimizationPanel";

afterEach(cleanup);

describe("RoutingOptimizationPanel", () => {
  it("preserves a historical decision while independently marking its source stale", () => {
    const workspace = {
      candidates: [],
      proposals: [{
        proposal_id: "proposal-1",
        task_title: "Questioned route",
        selected_capability_key: "chemistry.concentration",
        selected_capability_version: "1.0.0",
        rationale: "One teacher exclusion supports bounded review only.",
        teacher_reason: "Exclude this selected route next cycle.",
        proposed_change: { description: "Review a policy successor without changing the current route." },
        evidence_snapshot: {},
        evidence_refs: [],
        evidence_hash: "evidence-hash",
        limitations: ["CURRENT_POLICY_REMAINS_ACTIVE"],
        rule_key: "cap08b.teacher-exclusion-selected-route-review",
        rule_version: "1.0.0",
        confidence: 0.55,
        context_compilation_id: "context-1",
        context_snapshot_hash: "context-hash",
        context_selected_items: [],
        context_excluded_items: [],
        diagnostic_observation_id: "diagnosis-1",
        diagnosis_summary: "Diagnosis proposal",
        capability_resolution_id: "resolution-1",
        policy_version: "capability-resolution.v1",
        selection_rationale: "Selected exact eligible candidate.",
        candidate_set: [],
        selected_capability_version_id: "version-1",
        selected_capability_version_content_hash: "version-hash",
        activity_plan_id: "plan-1",
        runtime_delivery_id: "delivery-1",
        learner_attempt_id: "attempt-1",
        teacher_intervention_id: "intervention-1",
        decision_id: "decision-1",
        decision_action: "REQUEST_POLICY_REVIEW",
        decision_rationale: "Preserve history and review only a future policy successor.",
        decision_actor_name: "Teacher One",
        decision_decided_by: "teacher-1",
        decision_created_at: "2026-07-21T00:00:00.000Z",
        source_current: false,
      }],
    } as unknown as ComponentProps<typeof RoutingOptimizationPanel>["workspace"];
    render(RoutingOptimizationPanel({ workspace }));

    expect(screen.getByTestId("routing-optimization-decision").textContent).toContain("REQUEST_POLICY_REVIEW");
    expect(screen.getByText("STALE SOURCE · INSPECTION ONLY")).not.toBeNull();
    expect(screen.getByTestId("routing-optimization-stale-source").textContent).toContain("historical decision remain append-only and inspectable");
    expect(screen.queryByTestId("routing-optimization-decision-form")).toBeNull();
  });
});
