import Link from "next/link";
import { requireActor } from "@/application/identity";
import { Badge, Card, SurfaceHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DeniedPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  await requireActor();
  const workspace = (await searchParams).workspace ?? "requested workspace";
  return <>
    <SurfaceHeader eyebrow="Authorization" title="Access denied" description="Your authenticated role does not authorize this workspace." />
    <Card eyebrow="No workspace data loaded" title={workspace}>
      <Badge tone="bad">ROLE_DENIED</Badge>
      <p>No workspace query was executed and no workspace data is shown.</p>
      <Link className="button-link" href="/">Return to your authorized workspace</Link>
    </Card>
  </>;
}
