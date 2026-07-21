import Link from "next/link";
import Image from "next/image";
import { withWorkspaceActor } from "@/application/identity";
import { getAuthorizedEvidenceCatalog, getLearnerCapabilitiesForCourse, getLearnerWorkspace, getTaskDetail } from "@/application/queries";
import { AttemptForm, CancelFollowupForm, CapabilityResolutionButton, CloseTaskButton, CreateTaskForm, FollowupAttemptForm, ImageAttemptForm, ImmutableFollowupContract, LearnerWebComponentAssetForm, MaterialUploadForm, MessageForm, type FollowupContractView } from "@/components/ClientActions";
import { Badge, Card, Empty, SurfaceHeader, Timeline } from "@/components/ui";
import { runtimeDeliveryPresentation } from "@/domain/asset-runtime";

export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function webChoices(value: unknown): Array<{ id: string; label: string }> {
  return Array.isArray(value) ? value.flatMap((choice) => {
    const item = asRecord(choice);
    return typeof item?.id === "string" && typeof item.label === "string" ? [{ id: item.id, label: item.label }] : [];
  }) : [];
}

function learnerContract(activityType: string, row: {
  transferDeclaration: Record<string, unknown> | null;
  transferChangedDimensions: string[] | null;
  transferContractVersion: string | null;
  retentionContractVersion: string | null;
  retentionDueAt: Date | null;
  retentionDeclaredDelaySeconds: number | null;
  retentionInterveningExposure: Record<string, unknown> | null;
  retentionContentEquivalence: Record<string, unknown> | null;
  retentionAssistancePolicy: Record<string, unknown> | null;
} | undefined): FollowupContractView | null {
  if (activityType === "RETRY") return { activityType };
  if (activityType === "TRANSFER") {
    const declaration = asRecord(row?.transferDeclaration);
    const source = asRecord(declaration?.source);
    const target = asRecord(declaration?.target);
    if (row?.transferContractVersion !== "CAP06_V1" || !declaration || !source || !target
      || typeof declaration.materialDifferenceRationale !== "string"
      || declaration.evidenceLimit !== "TARGET_AUTHENTICATED_TEACHER_DECLARATION_NOT_MACHINE_PROVEN") return null;
    return {
      activityType,
      transfer: {
        source,
        target,
        materialDifferenceRationale: declaration.materialDifferenceRationale,
        evidenceLimit: declaration.evidenceLimit,
        changedDimensions: row?.transferChangedDimensions ?? undefined,
      },
    };
  }
  if (activityType === "RETENTION" && row?.retentionContractVersion === "CAP06_V1"
    && row.retentionDueAt && row.retentionDeclaredDelaySeconds
    && row.retentionInterveningExposure && row.retentionContentEquivalence && row.retentionAssistancePolicy) {
    return {
      activityType,
      retention: {
        dueAt: row.retentionDueAt.toISOString(),
        declaredDelaySeconds: row.retentionDeclaredDelaySeconds,
        interveningExposure: row.retentionInterveningExposure,
        contentEquivalence: row.retentionContentEquivalence,
        assistancePolicy: row.retentionAssistancePolicy,
      },
    };
  }
  return null;
}

function terminalFact(activity: {
  cancellationState: Record<string, unknown> | null;
  failureState: Record<string, unknown> | null;
}) {
  const fact = activity.cancellationState ?? activity.failureState;
  if (!fact) return null;
  return {
    code: typeof fact.code === "string" ? fact.code : undefined,
    reason: typeof fact.reason === "string" ? fact.reason : undefined,
    recordedAt: typeof fact.recordedAt === "string" ? fact.recordedAt : undefined,
  };
}

export default async function LearnerPage({ searchParams }: { searchParams: Promise<{ task?: string }> }) {
  return withWorkspaceActor(["LEARNER", "ADMIN"], "Learner Workspace", async (actor) => {
  const workspace = await getLearnerWorkspace(actor);
  const requested = (await searchParams).task;
  const activeTask = workspace.tasks.find((task) => task.id === requested) ?? workspace.tasks[0];
  const detail = activeTask ? await getTaskDetail(actor, activeTask.id) : null;
  const evidenceCatalog = activeTask ? await getAuthorizedEvidenceCatalog(actor, activeTask.id) : [];
  const learnerCapabilities = activeTask ? await getLearnerCapabilitiesForCourse(actor, activeTask.courseId) : [];
  const visibleEpisode = detail?.episodes.find((episode) => episode.status === "ACTIVE") ?? detail?.episodes.at(-1);
  const writableEpisode = detail?.task.status === "OPEN"
    ? detail.episodes.find((episode) => episode.status === "ACTIVE" && episode.purpose === "GENERAL")
    : undefined;
  return <>
    <SurfaceHeader eyebrow="Learner Workspace" title="Learn from a governed evidence chain" description="Tasks, scoped Context, source Evidence, Attempts, and reviewed Retry / Transfer / Retention remain linked in Product State." />
    <div className="showcase-banner"><Badge tone="warn">Synthetic seed is labeled</Badge> Learner uploads are real stored files. Provider-backed synthesis, embeddings, reranking, and image interpretation report their actual configured/executed/unavailable status.</div>
    <div className="workspace-grid">
      <Card eyebrow="Tasks" title="Learning Tasks"><div className="stack">{workspace.tasks.map((task) => <Link className="list-row" key={task.id} href={`/learner?task=${task.id}`}><span><strong>{task.title}</strong><small>{task.goal}</small></span><Badge tone={task.status === "OPEN" ? "good" : "neutral"}>{task.status}</Badge></Link>)}{workspace.tasks.length === 0 ? <Empty>No Tasks yet.</Empty> : null}</div>{workspace.courses[0] ? <CreateTaskForm courseId={workspace.courses[0].id}/> : <Empty>No authorized course enrollment is available.</Empty>}</Card>
      <div className="stack wide-column">{detail && visibleEpisode ? <>
        <Card eyebrow="Active Task" title={detail.task.title}><p>{detail.task.goal}</p><div className="header-actions"><Badge>{detail.task.status}</Badge>{detail.task.status === "OPEN" ? <CloseTaskButton taskId={detail.task.id}/> : null}</div></Card>
        <Card eyebrow="Conversation" title="Database-backed Episode"><Timeline items={detail.events.map((event) => ({ id: event.id, label: event.actorType, content: event.content, meta: `${event.kind} · ${event.createdAt.toLocaleString()}`, sourceRefs: event.sourceRefs, evidenceRefs: event.evidenceRefs }))}/>{writableEpisode ? <MessageForm taskId={detail.task.id} episodeId={writableEpisode.id}/> : null}</Card>
        <Card eyebrow="Context Compiler" title="Scoped Context">{detail.contexts[0] ? <><p>Compiler {detail.contexts[0].compilerVersion} · lifecycle and budget enforcement</p><div className="header-actions"><Badge tone="good">Token budget · ENFORCED</Badge><Badge tone="good">Modality budget · ENFORCED</Badge></div><p>{detail.contexts[0].selectedTokenCount} of {detail.contexts[0].tokenBudget} model tokens selected with {detail.contexts[0].tokenizer}. Items over budget, stale, superseded, or outside the Task are explicitly excluded.</p><pre>{JSON.stringify({ modalityBudget: detail.contexts[0].modalityBudget, modalityUsage: detail.contexts[0].modalityUsage, selected: detail.contexts[0].selectedItems, excluded: detail.contexts[0].excludedItems }, null, 2)}</pre></> : <Empty>No Context compilation has run for this Task.</Empty>}</Card>
        <Card eyebrow="Learning material intake" title="Upload governed PDF or image">{writableEpisode ? <MaterialUploadForm taskId={detail.task.id} episodeId={writableEpisode.id}/> : <Empty>Generic uploads require an active general Episode.</Empty>}{detail.assets.filter((asset) => asset.purpose === "LEARNING_MATERIAL").map((asset) => {
          const source = detail.sources.find((item) => item.id === asset.sourceId);
          return <article className="evidence-card" key={asset.id}><strong>{asset.originalName}</strong><div className="header-actions"><Badge tone={asset.ingestionStatus === "EXTRACTED" ? "good" : asset.ingestionStatus === "FAILED" ? "bad" : "warn"}>Ingestion · {asset.ingestionStatus}</Badge><Badge tone={source?.rightsAuthorizationStatus === "APPROVED" ? "good" : source?.rightsAuthorizationStatus === "DENIED" ? "bad" : "warn"}>Rights · {source?.rightsAuthorizationStatus ?? "REVIEW_REQUIRED"}</Badge></div><p>{asset.failureMessage ?? "Stored outside Product State; extracted content remains unavailable for delivery until rights approval."}</p></article>;
        })}</Card>
        <Card eyebrow="Authorized delivery" title="Authorized Evidence catalog"><p>These LEARNING-purpose sources are authorized for this Task/course. They are not necessarily used by an answer; answer-level sourceRefs and evidenceRefs appear with each conversation event.</p>{evidenceCatalog.map(({ evidence, source }) => <article className="evidence-card" key={evidence.id}><strong>{evidence.title}</strong><p>{evidence.content}</p>{evidence.structuredContent ? <pre>{JSON.stringify(evidence.structuredContent, null, 2)}</pre> : null}<small>{source.title} · v{source.version} · {evidence.locator} · {source.rights} · embedding {evidence.embeddingStatus}</small></article>)}{evidenceCatalog.length === 0 ? <Empty>No Evidence has explicit authorized LEARNING delivery and course/Reference Pack alignment for this Task.</Empty> : null}</Card>
        <Card eyebrow="Attempt" title="Capture learner reasoning">{writableEpisode ? <><AttemptForm taskId={detail.task.id} episodeId={writableEpisode.id} capabilities={learnerCapabilities}/><h3>Image or handwritten Attempt</h3><ImageAttemptForm taskId={detail.task.id} episodeId={writableEpisode.id}/></> : <Empty>Generic Attempts require an active general Episode.</Empty>}{detail.attempts.map((attempt) => {
          const asset = detail.assets.find((item) => item.id === attempt.fileAssetId);
          const observation = detail.observations.find((item) => item.attemptId === attempt.id);
          return <article className="evidence-card" key={attempt.id}><strong>{attempt.prompt}</strong><p>{attempt.response}</p>{asset ? <><a href={`/api/files/${asset.id}`} target="_blank" rel="noreferrer">Open original {asset.originalName}</a>{asset.mediaType.startsWith("image/") ? <Image unoptimized src={`/api/files/${asset.id}`} alt={`Original learner Attempt: ${asset.originalName}`} width={640} height={480} style={{ width: "100%", height: "auto" }}/> : null}<small>Multimodal interpretation · {asset.interpretationStatus}</small></> : null}<Badge tone="warn">{observation?.status ?? "REVIEW_PENDING"}</Badge>{observation && detail.task.status === "OPEN" ? <CapabilityResolutionButton taskId={detail.task.id} episodeId={attempt.episodeId} diagnosticObservationId={observation.id}/> : null}</article>;
        })}</Card>
        <Card eyebrow="Exact ComponentAsset runtime" title="Capability supplied from this Task's persisted gap">
          {detail.webComponentActivities.slice(0, 1).map(({ proposal, capability, capabilityVersion, component, componentVersion, activityPlan, delivery }) => {
            const content = asRecord(componentVersion.content) ?? {};
            const output = asRecord(delivery?.normalizedOutput);
            const runtimeError = asRecord(delivery?.normalizedError);
            const presentation = runtimeDeliveryPresentation(delivery);
            const succeeded = presentation.completionEvidenceAllowed;
            const failed = presentation.mode === "FAILED";
            const retryable = presentation.retryAllowed;
            return <article className="evidence-card" data-testid="learner-web-component-activity" key={proposal.id}>
              <div className="header-actions"><strong>{component.title}</strong><Badge tone="good">{capability.name}@{capabilityVersion.version}</Badge><Badge tone={succeeded ? "good" : failed ? "bad" : "info"}>{delivery?.status ?? "READY"}</Badge></div>
              <p>{String(content.instructions ?? "")}</p>
              {!delivery ? <LearnerWebComponentAssetForm taskId={proposal.taskId} episodeId={proposal.episodeId} activityPlanProposalId={proposal.id} prompt={String(content.prompt ?? component.title)} choices={webChoices(content.choices)}/> : succeeded ? <section className="stack compact" data-testid="learner-web-component-runtime-success" role="status" aria-live="polite" aria-atomic="true">
                <p><strong>{String(output?.feedback ?? "The exact runtime finished without feedback text.")}</strong></p>
                <small>RuntimeDelivery {delivery.id} · ActivityPlan {activityPlan?.id} · CapabilityVersion {capabilityVersion.id} · ComponentAssetVersion {componentVersion.id}</small>
              </section> : failed ? <section data-testid="learner-web-component-runtime-failure" className="stack compact" role="status" aria-live="polite" aria-atomic="true"><p><strong>{String(runtimeError?.code ?? delivery.status)}:</strong> {String(runtimeError?.message ?? "The exact runtime did not complete.")}</p><small>RuntimeDelivery {delivery.id} · attempt {delivery.attemptNumber} of 2 · failure evidence retained</small>{retryable ? <LearnerWebComponentAssetForm taskId={proposal.taskId} episodeId={proposal.episodeId} activityPlanProposalId={proposal.id} retryOfDeliveryId={delivery.id} prompt={String(content.prompt ?? component.title)} choices={webChoices(content.choices)}/> : <small>{runtimeError?.retryable === true ? "The bounded retry limit has been reached." : "This failure is not retryable; ask the teacher or expert to inspect the exact runtime evidence."}</small>}</section> : <p role="status" aria-live="polite">The exact RuntimeDelivery is {delivery.status}; no completion evidence is claimed.</p>}
              <small>{succeeded ? "Successful completion records a RuntimeDelivery, LearnerAttempt and LearningEvents through CAP-04." : "Runtime status and normalized failure evidence are shown without a completion claim."} No delivery creates a Diagnosis, TeacherReview or LearningOutcome.</small>
            </article>;
          })}
          {detail.webComponentActivities.length === 0 ? <Empty>No confirmed gap-supplied exact ComponentAsset is READY for this Task.</Empty> : null}
        </Card>
        <Card eyebrow="Governed follow-up" title="Retry · Transfer · Retention">{detail.retries.filter((activity) => Boolean(activity.idempotencyKey)).map((activity) => {
          const run = workspace.pendingWorkflows.find((candidate) => candidate.taskId === detail.task.id && candidate.productLinks.activityId === activity.id);
          const planned = detail.followupPlans.find((plan) => plan.activityId === activity.id);
          const contract = learnerContract(activity.activityType, detail.followupContracts.find((item) => item.activityId === activity.id));
          const currentCapability = learnerCapabilities.find((capability) => capability.publicKey === planned?.capabilityKey);
          const exactCapability = learnerCapabilities.filter((capability) => capability.publicKey === planned?.capabilityKey
            && capability.capabilityVersionId === planned?.capabilityVersionId);
          const unavailableReason = planned
            ? currentCapability
              ? `The exact planned CapabilityVersion ${planned.capabilityVersionId} is no longer active; current version ${currentCapability.capabilityVersionId} is not substituted.`
              : `The exact planned CapabilityVersion ${planned.capabilityVersionId} is unavailable for this course.`
            : "The exact governed ActivityPlan is unavailable; submission is disabled.";
          const fact = terminalFact(activity);
          const resultReview = activity.resultReviewId ? detail.reviews.find((review) => review.id === activity.resultReviewId) : undefined;
          return <article className="evidence-card" data-testid="governed-followup-history" key={activity.id}>
            <div className="header-actions"><strong>{activity.activityType}</strong><Badge tone={activity.status === "REVIEWED" ? "good" : activity.status === "FAILED_FINAL" || activity.status === "CANCELLED" || activity.status === "ESCALATED" ? "warn" : "info"}>{activity.status}</Badge></div>
            {!run ? <p>{activity.prompt}</p> : null}
            {!run && contract ? <ImmutableFollowupContract contract={contract}/> : null}
            {!contract ? <Empty>Follow-up contract integrity is incomplete; execution and review are disabled.</Empty> : null}
            {run && contract ? <FollowupAttemptForm threadId={run.threadId} expectedVersion={run.interruptVersion} prompt={activity.prompt} contract={contract} scheduledFor={activity.scheduledFor?.toISOString()} capabilities={exactCapability} unavailableReason={unavailableReason}/> : null}
            {run && new Set(["ASSIGNED", "FAILED_RECOVERABLE"]).has(activity.status) ? <CancelFollowupForm activityId={activity.id}/> : null}
            {fact ? <p><strong>{fact.code ?? activity.status}:</strong> {fact.reason ?? "No terminal reason was recorded."}{fact.recordedAt ? ` · ${new Date(fact.recordedAt).toLocaleString()}` : ""}</p> : null}
            {resultReview ? <section data-testid="followup-result-review-history"><strong>Result TeacherReview · {resultReview.decision}</strong><p>{resultReview.teachingSupport}</p><small>{resultReview.createdAt.toLocaleString()} · Review {resultReview.id}</small></section> : null}
            {new Set(["REVIEWED", "ESCALATED"]).has(activity.status) ? <small>This is a reviewed follow-up result only. CAP-06 creates no LearningOutcome, mastery decision, or effectiveness claim.</small> : null}
          </article>;
        })}{detail.retries.every((activity) => !activity.idempotencyKey) ? <Empty>No governed follow-up has been assigned.</Empty> : null}<small>Each activity uses a successor Episode and creates a new exact Plan, RuntimeDelivery, Attempt, Diagnosis Proposal, and TeacherReview chain. No mastery or effectiveness claim is made here.</small></Card>
        <Card eyebrow="Published teaching support" title="Delivered Components">{detail.componentSupport.map(({ delivery, component, version }) => {
          const support = delivery.supportSnapshot;
          return <article className="evidence-card" data-testid="learner-component-support" key={delivery.id}><div className="header-actions"><strong>{String(support.title ?? component.title)}</strong><Badge tone="good">v{version.version}</Badge></div><p>{String(support.teachingSupport ?? "")}</p><p><strong>Scaffold:</strong> {String(support.scaffoldHint ?? "")}</p><p><strong>Worked example:</strong> {String(support.workedExample ?? "")}</p><p><strong>Your action:</strong> {String(support.learnerAction ?? "")}</p><small>Delivered {delivery.createdAt.toLocaleString()} · Component {component.id} · immutable version {version.id}</small></article>;
        })}{detail.componentSupport.length === 0 ? <Empty>No published Component support has been delivered for this Task.</Empty> : null}</Card>
        <Card eyebrow="Library · Study reminders · History" title="Learning continuity"><h3>Library</h3>{workspace.library.map((item) => <p key={item.id}>{item.title} — {item.reason}</p>)}{workspace.library.length === 0 ? <Empty>No saved resources.</Empty> : null}<h3>Study reminders</h3>{workspace.schedule.map((item) => <p key={item.id}><Badge>STUDY REVIEW</Badge> {item.dueAt.toLocaleString()} · {item.status}</p>)}{workspace.schedule.length === 0 ? <Empty>No Study Review reminder.</Empty> : null}<h3>Historical Outcomes</h3>{detail.outcomes.map((outcome) => <article key={outcome.id}><strong>{outcome.status}</strong><p>{outcome.narrative}</p><small>Human Review {outcome.resultReviewId}</small></article>)}{detail.outcomes.length === 0 ? <Empty>No prior governed Outcome recorded. CAP-06 follow-up reviews do not create one.</Empty> : null}</Card>
      </> : <Card><Empty>Select or create a Learning Task.</Empty></Card>}</div>
    </div>
  </>;
  });
}
