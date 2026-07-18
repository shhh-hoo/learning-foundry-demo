import { z } from "zod";
import { createComponentCandidate } from "@/application/commands";
import { requireApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";

const Candidate = z.object({
  observationId: z.string().uuid(),
  key: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(3),
  purpose: z.string().min(10),
  capabilityKey: z.string().regex(/^[a-z0-9-]+$/),
  referencePackKey: z.string().min(1),
  content: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(8),
});

export async function POST(request: Request) {
  try {
    return Response.json(await createComponentCandidate(await requireApiActor(), Candidate.parse(await request.json())), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
