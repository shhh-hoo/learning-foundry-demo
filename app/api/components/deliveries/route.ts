import { z } from "zod";
import { deliverActiveComponentSupport } from "@/application/commands";
import { requireApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";

const Delivery = z.object({ observationId: z.string().uuid(), idempotencyKey: z.string().min(8) }).strict();

export async function POST(request: Request) {
  try {
    return Response.json(await deliverActiveComponentSupport(await requireApiActor(), Delivery.parse(await request.json())), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
