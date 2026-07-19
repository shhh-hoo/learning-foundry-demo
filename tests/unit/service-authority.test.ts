import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveServiceGrant } from "@/application/service-authority";

describe("tenant-scoped service authority", () => {
  it("requires an exact principal, purpose and institution allowlist match", () => {
    const institutionId = randomUUID();
    const raw = JSON.stringify([{ principal: "retrieval-worker", purposes: ["EMBED_EVIDENCE"], institutionIds: [institutionId] }]);
    expect(resolveServiceGrant({ principal: "retrieval-worker", purpose: "EMBED_EVIDENCE", institutionId }, raw)).toMatchObject({ principal: "retrieval-worker" });
    expect(() => resolveServiceGrant({ principal: "retrieval-worker", purpose: "PUBLISH_COMPONENT", institutionId }, raw)).toThrow(/not allowlisted/);
    expect(() => resolveServiceGrant({ principal: "retrieval-worker", purpose: "EMBED_EVIDENCE", institutionId: randomUUID() }, raw)).toThrow(/not allowlisted/);
  });

  it("fails closed when no grants exist", () => {
    expect(() => resolveServiceGrant({ principal: "worker", purpose: "RUN", institutionId: randomUUID() }, undefined)).toThrow(/No service authority grants/);
  });
});
