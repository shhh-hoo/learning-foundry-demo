import Link from "next/link";
import Image from "next/image";
import { withWorkspaceActor } from "@/application/identity";
import { getAuthorizedEvidenceCatalog, getLearnerCapabilitiesForCourse, getLearnerWorkspace, getTaskDetail } from "@/application/queries";
import { AttemptForm, CloseTaskButton, CreateTaskForm, ImageAttemptForm, MaterialUploadForm, MessageForm, RetryAttemptForm } from "@/components/ClientActions";
import { Badge, Card, Empty, SurfaceHeader, Timeline } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LearnerPage({ searchParams }: { searchParams: Promise<{ task?: string }> }) {
  return withWorkspaceActor(["LEARNER", "ADMIN"], "Learner Workspace", async (actor) => {
  const workspace = await getLearnerWorkspace(actor);
  const requested = (await searchParams).task;
  const activeTask = workspace.tasks.find((task) => task.id === requested) ?? workspace.tasks[0];
  const detail = activeTask ? await getTaskDetail(actor, activeTask.id) : null;
  const evidenceCatalog = activeTask ? await getAuthorizedEvidenceCatalog(actor, activeTask.id) : [];
  const learnerCapabilities = activeTask ? await getLearnerCapabilitiesForCourse(actor, activeTask.courseId) : [];
  const activeEpisode = detail?.episodes.find((episode) => episode.status === "ACTIVE") ?? detail?.episodes.at(-1);
  return <>
    <SurfaceHeader eyebrow="Learner Workspace" title="Learn from a governed evidence chain" description="Tasks, scoped Context, source Evidence, Attempts, reviewed Retry and Outcomes remain linked in Product State." />
    <div className="showcase-banner"><Badge tone="warn">Synthetic seed is labeled</Badge> Learner uploads are real stored files. Provider-backed synthesis, embeddings, reranking, and image interpretation report their actual configured/executed/unavailable status.</div>
    <div className="workspace-grid">
      <Card eyebrow="Tasks" title="Learning Tasks"><div className="stack">{workspace.tasks.map((task) => <Link className="list-row" key={task.id} href={`/learner?task=${task.id}`}><span><strong>{task.title}</strong><small>{task.goal}</small></span><Badge tone={task.status === "OPEN" ? "good" : "neutral"}>{task.status}</Badge></Link>)}{workspace.tasks.length === 0 ? <Empty>No Tasks yet.</Empty> : null}</div>{workspace.courses[0] ? <CreateTaskForm courseId={workspace.courses[0].id}/> : <Empty>No authorized course enrollment is available.</Empty>}</Card>
      <div className="stack wide-column">{detail && activeEpisode ? <>
        <Card eyebrow="Active Task" title={detail.task.title}><p>{detail.task.goal}</p><div className="header-actions"><Badge>{detail.task.status}</Badge>{detail.task.status === "OPEN" ? <CloseTaskButton taskId={detail.task.id}/> : null}</div></Card>
        <Card eyebrow="Conversation" title="Database-backed Episode"><Timeline items={detail.events.map((event) => ({ id: event.id, label: event.actorType, content: event.content, meta: `${event.kind} · ${event.createdAt.toLocaleString()}`, sourceRefs: event.sourceRefs, evidenceRefs: event.evidenceRefs }))}/>{detail.task.status === "OPEN" ? <MessageForm taskId={detail.task.id} episodeId={activeEpisode.id}/> : null}</Card>
        <Card eyebrow="Context Compiler" title="Scoped Context">{detail.contexts[0] ? <><p>Compiler {detail.contexts[0].compilerVersion} · lifecycle and budget enforcement</p><div className="header-actions"><Badge tone="good">Token budget · ENFORCED</Badge><Badge tone="good">Modality budget · ENFORCED</Badge></div><p>{detail.contexts[0].selectedTokenCount} of {detail.contexts[0].tokenBudget} model tokens selected with {detail.contexts[0].tokenizer}. Items over budget, stale, superseded, or outside the Task are explicitly excluded.</p><pre>{JSON.stringify({ modalityBudget: detail.contexts[0].modalityBudget, modalityUsage: detail.contexts[0].modalityUsage, selected: detail.contexts[0].selectedItems, excluded: detail.contexts[0].excludedItems }, null, 2)}</pre></> : <Empty>No Context compilation has run for this Task.</Empty>}</Card>
        <Card eyebrow="Learning material intake" title="Upload governed PDF or image"><MaterialUploadForm taskId={detail.task.id} episodeId={activeEpisode.id}/>{detail.assets.filter((asset) => asset.purpose === "LEARNING_MATERIAL").map((asset) => {
          const source = detail.sources.find((item) => item.id === asset.sourceId);
          return <article className="evidence-card" key={asset.id}><strong>{asset.originalName}</strong><div className="header-actions"><Badge tone={asset.ingestionStatus === "EXTRACTED" ? "good" : asset.ingestionStatus === "FAILED" ? "bad" : "warn"}>Ingestion · {asset.ingestionStatus}</Badge><Badge tone={source?.rightsAuthorizationStatus === "APPROVED" ? "good" : source?.rightsAuthorizationStatus === "DENIED" ? "bad" : "warn"}>Rights · {source?.rightsAuthorizationStatus ?? "REVIEW_REQUIRED"}</Badge></div><p>{asset.failureMessage ?? "Stored outside Product State; extracted content remains unavailable for delivery until rights approval."}</p></article>;
        })}</Card>
        <Card eyebrow="Authorized delivery" title="Authorized Evidence catalog"><p>These LEARNING-purpose sources are authorized for this Task/course. They are not necessarily used by an answer; answer-level sourceRefs and evidenceRefs appear with each conversation event.</p>{evidenceCatalog.map(({ evidence, source }) => <article className="evidence-card" key={evidence.id}><strong>{evidence.title}</strong><p>{evidence.content}</p>{evidence.structuredContent ? <pre>{JSON.stringify(evidence.structuredContent, null, 2)}</pre> : null}<small>{source.title} · v{source.version} · {evidence.locator} · {source.rights} · embedding {evidence.embeddingStatus}</small></article>)}{evidenceCatalog.length === 0 ? <Empty>No Evidence has explicit authorized LEARNING delivery and course/Reference Pack alignment for this Task.</Empty> : null}</Card>
        <Card eyebrow="Attempt" title="Capture learner reasoning"><AttemptForm taskId={detail.task.id} episodeId={activeEpisode.id} capabilities={learnerCapabilities}/><h3>Image or handwritten Attempt</h3><ImageAttemptForm taskId={detail.task.id} episodeId={activeEpisode.id}/>{detail.attempts.map((attempt) => {
          const asset = detail.assets.find((item) => item.id === attempt.fileAssetId);
          return <article className="evidence-card" key={attempt.id}><strong>{attempt.prompt}</strong><p>{attempt.response}</p>{asset ? <><a href={`/api/files/${asset.id}`} target="_blank" rel="noreferrer">Open original {asset.originalName}</a>{asset.mediaType.startsWith("image/") ? <Image unoptimized src={`/api/files/${asset.id}`} alt={`Original learner Attempt: ${asset.originalName}`} width={640} height={480} style={{ width: "100%", height: "auto" }}/> : null}<small>Multimodal interpretation · {asset.interpretationStatus}</small></> : null}<Badge tone="warn">{detail.observations.find((item) => item.attemptId === attempt.id)?.status ?? "REVIEW_PENDING"}</Badge></article>;
        })}</Card>
        <Card eyebrow="Retry" title="Assigned and waiting">{workspace.pendingWorkflows.filter((run) => run.taskId === detail.task.id).map((run) => <RetryAttemptForm key={run.id} threadId={run.threadId} expectedVersion={run.interruptVersion} prompt={detail.retries.find((retry) => retry.id === run.productLinks.retryId)?.prompt ?? "Complete the reviewed Retry."}/>)}{detail.retries.length === 0 ? <Empty>No reviewed Retry assigned yet.</Empty> : null}</Card>
        <Card eyebrow="Published teaching support" title="Delivered Components">{detail.componentSupport.map(({ delivery, component, version }) => {
          const support = delivery.supportSnapshot;
          return <article className="evidence-card" data-testid="learner-component-support" key={delivery.id}><div className="header-actions"><strong>{String(support.title ?? component.title)}</strong><Badge tone="good">v{version.version}</Badge></div><p>{String(support.teachingSupport ?? "")}</p><p><strong>Scaffold:</strong> {String(support.scaffoldHint ?? "")}</p><p><strong>Worked example:</strong> {String(support.workedExample ?? "")}</p><p><strong>Your action:</strong> {String(support.learnerAction ?? "")}</p><small>Delivered {delivery.createdAt.toLocaleString()} · Component {component.id} · immutable version {version.id}</small></article>;
        })}{detail.componentSupport.length === 0 ? <Empty>No published Component support has been delivered for this Task.</Empty> : null}</Card>
        <Card eyebrow="Library · Study reminders · History" title="Learning continuity"><h3>Library</h3>{workspace.library.map((item) => <p key={item.id}>{item.title} — {item.reason}</p>)}{workspace.library.length === 0 ? <Empty>No saved resources.</Empty> : null}<h3>Study reminders</h3>{workspace.schedule.map((item) => <p key={item.id}><Badge>STUDY REVIEW</Badge> {item.dueAt.toLocaleString()} · {item.status}</p>)}{workspace.schedule.length === 0 ? <Empty>No Study Review reminder.</Empty> : null}<h3>Outcomes</h3>{detail.outcomes.map((outcome) => <article key={outcome.id}><strong>{outcome.status}</strong><p>{outcome.narrative}</p><small>Human Review {outcome.resultReviewId}</small></article>)}{detail.outcomes.length === 0 ? <Empty>No governed Outcome recorded.</Empty> : null}</Card>
      </> : <Card><Empty>Select or create a Learning Task.</Empty></Card>}</div>
    </div>
  </>;
  });
}
