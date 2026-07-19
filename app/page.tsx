import { redirect } from "next/navigation";
import { requireActor } from "@/application/identity";

export const dynamic = "force-dynamic";

export default async function Home() {
  const actor = await requireActor();
  if (actor.roles.includes("LEARNER")) redirect("/learner");
  if (actor.roles.includes("TEACHER")) redirect("/teacher");
  if (actor.roles.includes("EXPERT")) redirect("/foundry");
  redirect("/engineering");
}
