import { describe, expect, it } from "vitest";
import { citedEvidence } from "@/application/model";
import type { Citation } from "@/domain/model";

const citations: Citation[] = [1, 2].map((index) => ({
  evidenceUnitId: `70000000-0000-4000-8000-00000000000${index}`,
  sourceId: `60000000-0000-4000-8000-00000000000${index}`,
  sourceVersion: "v1",
  locator: `page:${index}`,
  label: `Source ${index}`,
}));

describe("model citation integrity", () => {
  it("returns only Evidence actually cited by the answer", () => {
    expect(citedEvidence("The first claim is supported [2], again [2].", citations)).toEqual({ citations: [citations[1]], valid: true });
  });

  it("fails closed for absent or invented citation numbers", () => {
    expect(citedEvidence("An uncited answer.", citations)).toEqual({ citations: [], valid: false });
    expect(citedEvidence("An invented source [3].", citations)).toEqual({ citations: [], valid: false });
  });
});
