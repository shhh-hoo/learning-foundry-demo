import { DomainInvariantError } from "@/domain/invariants";

export function errorResponse(error: unknown): Response {
  if (error instanceof DomainInvariantError) {
    const status = error.code === "UNAUTHENTICATED" ? 401 : error.code.includes("FORBIDDEN") || error.code.includes("DENIED") || error.code === "TENANT_ISOLATION" ? 403 : 422;
    return Response.json({ error: error.message, code: error.code }, { status });
  }
  console.error(error);
  return Response.json({ error: "Unexpected server error", code: "INTERNAL_ERROR" }, { status: 500 });
}

/** Call only after the protected database operation has returned and committed. */
export function requireWorkflowHttpSuccess(result: unknown): void {
  const workflow = result as { status?: unknown; failure?: unknown; failureCode?: unknown };
  if (workflow.status !== "FAILED" && workflow.status !== "CANCELLED") return;
  throw new DomainInvariantError(
    typeof workflow.failure === "string" ? workflow.failure : "The governed workflow ended without a deliverable result",
    typeof workflow.failureCode === "string"
      ? workflow.failureCode
      : workflow.status === "CANCELLED" ? "FOLLOWUP_CANCELLED" : "FOLLOWUP_FAILED",
  );
}
