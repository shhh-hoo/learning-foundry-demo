import { requireWorkspaceActor } from "@/application/identity";
import { getTeacherWorkspace } from "@/application/queries";
import { CandidateForm, RetryForm, RetryResultReviewForm, ReviewForm } from "@/components/ClientActions";
import { Badge, Card, Empty, SurfaceHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TeacherPage() {
  const actor = await requireWorkspaceActor(["TEACHER", "ADMIN"], "Teacher Workspace");
  const workspace = await getTeacherWorkspace(actor);
  return <>
    <SurfaceHeader eyebrow="Teacher Workspace" title="Inspect, correct and resume" description="Every Review is an authenticated human command over a course-scoped Attempt and Observation." />
    <div className="showcase-banner"><Badge tone="warn">Synthetic showcase data</Badge> CAPABILITY_UNAVAILABLE observations are review-required states, not automated Diagnoses.</div>
    <div className="stack">{workspace.queue.map((row) => {
      const observationId = String(row.observation_id);
      const reviewId = row.review_id ? String(row.review_id) : null;
      const reviewDecision = row.review_decision ? String(row.review_decision) : null;
      const waitingThread = row.waiting_thread_id ? String(row.waiting_thread_id) : null;
      return <Card key={observationId} eyebrow={String(row.learner_name)} title={String(row.task_title)}>
        <div className="metric-grid"><div><small>Attempt</small><p>{String(row.prompt)}</p><strong>{String(row.response)}</strong></div><div><small>Observation</small><p>{String(row.summary)}</p><Badge tone="warn">{String(row.observation_source)}</Badge></div><div><small>Source refs</small><pre>{JSON.stringify(row.source_refs, null, 2)}</pre></div></div>
        {reviewDecision === "ESCALATE" ? <div data-testid="terminal-escalation"><Badge tone="bad">ESCALATED · terminal</Badge><p>This human Review requires specialist resolution. Retry and Component candidate actions are unavailable for this Observation.</p></div> : waitingThread ? <ReviewForm threadId={waitingThread} expectedVersion={Number(row.waiting_interrupt_version)}/> : reviewId ? <><RetryForm observationId={observationId} reviewId={reviewId}/><CandidateForm observationId={observationId}/></> : <Badge tone="bad">No resumable Review workflow</Badge>}
      </Card>;
    })}{workspace.queue.length === 0 ? <Empty>No course-scoped observations.</Empty> : null}</div>
    <div className="workspace-grid"><Card eyebrow="Reviewed capability signals" title="Course-scoped failure codes">{workspace.patterns.map((pattern) => <p key={String(pattern.pattern)}><strong>{String(pattern.pattern)}</strong> · {String(pattern.count)} reviewed capability observations · {String(pattern.learners)} learners</p>)}{workspace.patterns.length === 0 ? <Empty>No reviewed CAPABILITY observation with a failure code is available. Unavailable, unreviewed and null-code observations are not aggregated.</Empty> : null}</Card><Card eyebrow="Retry results" title="Human Review before Outcome">{workspace.pendingWorkflows.filter((run) => run.interruptType === "RETRY_RESULT_REVIEW_REQUIRED").map((run) => <RetryResultReviewForm key={run.id} threadId={run.threadId} expectedVersion={run.interruptVersion}/>)}{workspace.pendingWorkflows.every((run) => run.interruptType !== "RETRY_RESULT_REVIEW_REQUIRED") ? <Empty>No retry result is waiting for Review.</Empty> : null}</Card></div>
  </>;
}
