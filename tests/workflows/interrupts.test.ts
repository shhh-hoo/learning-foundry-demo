import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { buildTeacherReviewGraph } from "@/workflows/teacher-review";

describe("LangGraph native interrupts", () => {
  it("pauses before creating a human TeacherReview", async () => {
    const graph = buildTeacherReviewGraph(new MemorySaver());
    const result = await graph.invoke({
      observationId: "90000000-0000-4000-8000-000000000002",
      taskId: "80000000-0000-4000-8000-000000000001",
      attemptId: "90000000-0000-4000-8000-000000000001",
      summary: "Direct review required",
      failureCode: null,
    }, { configurable: { thread_id: "unit:teacher-interrupt" } });
    const interrupt = (result as unknown as { __interrupt__?: Array<{ value?: { type?: string } }> }).__interrupt__?.[0]?.value;
    expect(interrupt?.type).toBe("TEACHER_REVIEW_REQUIRED");
    expect(result.reviewId).toBeUndefined();
  });
});
