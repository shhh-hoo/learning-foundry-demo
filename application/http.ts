import { DomainInvariantError } from "@/domain/invariants";

export function errorResponse(error: unknown): Response {
  if (error instanceof DomainInvariantError) {
    const status = error.code === "UNAUTHENTICATED" ? 401 : error.code.includes("FORBIDDEN") || error.code.includes("DENIED") || error.code === "TENANT_ISOLATION" ? 403 : 422;
    return Response.json({ error: error.message, code: error.code }, { status });
  }
  console.error(error);
  return Response.json({ error: "Unexpected server error", code: "INTERNAL_ERROR" }, { status: 500 });
}
