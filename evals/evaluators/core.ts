import { MemorySaver } from "@langchain/langgraph";
import { compileContext } from "@/domain/context";
import { ComponentContract } from "@/domain/component";
import { buildTeacherReviewGraph } from "@/workflows/teacher-review";

export type EvalResult = { id: string; passed: boolean; details: Record<string, unknown> };

export async function evaluateFrameworkContractCase(testCase: Record<string, unknown>): Promise<EvalResult> {
  const id = String(testCase.id);
  if (testCase.type === "CONTEXT") {
    const compiled = compileContext(testCase as never);
    const selected = compiled.selectedItems.map((item) => item.id);
    const excluded = Object.fromEntries(compiled.excludedItems.map((item) => [item.id, item.reason]));
    const passed = JSON.stringify(selected) === JSON.stringify(testCase.expectedSelected) && JSON.stringify(excluded) === JSON.stringify(testCase.expectedExcluded);
    return { id, passed, details: { selected, excluded, compilerVersion: compiled.compilerVersion } };
  }
  if (testCase.type === "COMPONENT") {
    const result = ComponentContract.safeParse(testCase.contract);
    const passed = result.success === testCase.expectedValid;
    return { id, passed, details: { valid: result.success } };
  }
  if (testCase.type === "GRAPH_INTERRUPT") {
    const graph = buildTeacherReviewGraph(new MemorySaver());
    const result = await graph.invoke({
      observationId: "90000000-0000-4000-8000-000000000002",
      taskId: "80000000-0000-4000-8000-000000000001",
      attemptId: "90000000-0000-4000-8000-000000000001",
      summary: "Requires human review",
      failureCode: "MASS_RATIO_INSTEAD_OF_MOLE_RATIO",
    }, { configurable: { thread_id: `eval:${id}` } });
    const actual = ((result as unknown as { __interrupt__?: Array<{ value?: { type?: string } }> }).__interrupt__?.[0]?.value)?.type;
    return { id, passed: actual === testCase.expectedInterrupt, details: { interrupt: actual } };
  }
  return { id, passed: false, details: { error: "Unknown Eval case type" } };
}
