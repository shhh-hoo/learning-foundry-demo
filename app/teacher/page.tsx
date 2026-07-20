import Image from "next/image";
import { withWorkspaceActor } from "@/application/identity";
import { getTeacherWorkspace } from "@/application/queries";
import { CandidateForm, ComponentDeliveryForm, FollowupResultReviewForm, GovernedFollowupForm, ImmutableFollowupContract, ReviewForm, SourceRightsForm, TeacherAssignmentForm, TeacherInterventionForm, type FollowupContractView, type TeacherCapabilityOption } from "@/components/ClientActions";
import { Badge, Card, Empty, SurfaceHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function teacherContract(row: Awaited<ReturnType<typeof getTeacherWorkspace>>["retries"][number] | undefined): FollowupContractView | null {
  if (!row) return null;
  if (row.retry.activityType === "RETRY") return { activityType: "RETRY" };
  if (row.retry.activityType === "TRANSFER" && row.transfer?.contractVersion === "CAP06_V1") {
    const declaration = asRecord(row.transfer.declaration);
    const source = asRecord(declaration?.source);
    const target = asRecord(declaration?.target);
    if (!declaration || !source || !target || typeof declaration.materialDifferenceRationale !== "string"
      || declaration.evidenceLimit !== "TARGET_AUTHENTICATED_TEACHER_DECLARATION_NOT_MACHINE_PROVEN") return null;
    return {
      activityType: "TRANSFER",
      transfer: {
        source,
        target,
        materialDifferenceRationale: declaration.materialDifferenceRationale,
        evidenceLimit: declaration.evidenceLimit,
        changedDimensions: row.transfer.changedDimensions,
      },
    };
  }
  if (row.retry.activityType === "RETENTION" && row.retention?.contractVersion === "CAP06_V1") {
    return {
      activityType: "RETENTION",
      retention: {
        dueAt: row.retention.dueAt.toISOString(),
        declaredDelaySeconds: row.retention.declaredDelaySeconds,
        interveningExposure: row.retention.interveningExposure,
        contentEquivalence: row.retention.contentEquivalence,
        assistancePolicy: row.retention.assistancePolicy,
      },
    };
  }
  return null;
}

function terminalFact(activity: Awaited<ReturnType<typeof getTeacherWorkspace>>["retries"][number]["retry"]) {
  const fact = activity.cancellationState ?? activity.failureState;
  if (!fact) return null;
  return {
    code: typeof fact.code === "string" ? fact.code : undefined,
    reason: typeof fact.reason === "string" ? fact.reason : undefined,
    recordedAt: typeof fact.recordedAt === "string" ? fact.recordedAt : undefined,
  };
}

export default async function TeacherPage() {
  return withWorkspaceActor(["TEACHER", "ADMIN"], "Teacher Workspace", async (actor) => {
  const workspace = await getTeacherWorkspace(actor);
  const assignmentCourses = workspace.assignmentCourses.map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name) }));
  const assignmentLearners = workspace.assignmentLearners.map((row) => ({ id: String(row.id), courseId: String(row.course_id), name: String(row.name) }));
  const assignmentCapabilities: TeacherCapabilityOption[] = workspace.assignmentCapabilities.map((row) => ({ id: String(row.id), courseId: String(row.course_id), key: String(row.key), name: String(row.name) }));
  const teacherCommandCourseIds = new Set(assignmentCourses.map((course) => course.id));
  return <>
    <SurfaceHeader eyebrow="Teacher Workspace" title="Assign, inspect and intervene" description="Teacher commands are authenticated, course-scoped and distinct from system proposals." />
    <div className="showcase-banner"><Badge tone="warn">Synthetic showcase data</Badge> CAPABILITY_UNAVAILABLE observations are review-required states, not automated Diagnoses.</div>
    <div className="workspace-grid">
      <Card eyebrow="CAP-05 · Teacher only" title="Assign a learner Task">
        {workspace.teacherCommandEnabled && assignmentCourses.length ? <TeacherAssignmentForm courses={assignmentCourses} learners={assignmentLearners} capabilities={assignmentCapabilities}/> : <Empty>Assignment commands require current institution and course TEACHER authority. Admin visibility does not confer this human command.</Empty>}
      </Card>
      <Card eyebrow="Immutable assignment audit" title="Your recent assignments">
        {workspace.assignments.map((row) => <article className="evidence-card" key={String(row.id)}><strong>{String(row.title)} · {String(row.learner_name)}</strong><p>{String(row.goal)}</p><small>{String(row.status)} · {new Date(String(row.created_at)).toLocaleString()} · Task {String(row.task_id)}</small><details><summary>Instructions, completion and actor provenance</summary><pre>{JSON.stringify({ instructions: row.instructions, completionRule: row.completion_rule, dueAt: row.due_at, actorProvenance: row.actor_provenance }, null, 2)}</pre></details></article>)}
        {workspace.assignments.length === 0 ? <Empty>No TeacherAssignment has been recorded by this teacher.</Empty> : null}
      </Card>
    </div>
    <Card eyebrow="Exact completed runtime trail" title="RuntimeDelivery, Attempt, ordered LearningEvents and planning lineage">
      <div className="showcase-banner"><Badge tone="warn">Not human validation</Badge> Automated and seeded records remain distinguishable from authenticated teacher actions.</div>
      <div className="stack">{workspace.runtimeInspections.map((row) => {
        const deliveryId = String(row.runtime_delivery_id);
        const courseCapabilities = assignmentCapabilities.filter((capability) => capability.courseId === String(row.course_id));
        const events = Array.isArray(row.learning_events) ? row.learning_events as Array<Record<string, unknown>> : [];
        const interventions = Array.isArray(row.interventions) ? row.interventions as Array<Record<string, unknown>> : [];
        const eligible = workspace.teacherCommandEnabled && teacherCommandCourseIds.has(String(row.course_id)) && Boolean(row.is_latest_delivery) && row.task_status === "OPEN" && row.episode_status === "ACTIVE" && !row.superseded_by_id;
        return <article className="evidence-card" data-testid="teacher-runtime-inspection" key={deliveryId}>
          <div className="header-actions"><strong>{String(row.task_title)} · {String(row.learner_name)}</strong><Badge tone={row.runtime_status === "SUCCEEDED" ? "good" : "warn"}>{String(row.runtime_status)}</Badge></div>
          <div className="metric-grid"><div><small>Exact runtime</small><p>{String(row.capability_name)} · {String(row.capability_key)} · v{String(row.capability_version)}</p><small>Delivery {deliveryId}<br/>Version {String(row.capability_version_id)}</small></div><div><small>Runtime Attempt</small><p>{String(row.prompt)}</p><strong>{String(row.response)}</strong><small>Attempt {String(row.attempt_id)}</small></div><div><small>Current planning Diagnosis proposal</small><p>{String(row.diagnosis_summary)}</p><Badge tone="info">{String(row.diagnosis_status)}</Badge><small>Diagnosis {String(row.diagnosis_id)}</small></div></div>
          <h3>Ordered LearningEvents</h3>
          {events.map((event) => <div key={String(event.id)}><strong>{String(event.sequence)} · {String(event.eventType)}</strong><pre>{JSON.stringify({ payload: event.payload, evidenceRefs: event.evidenceRefs, actorType: event.actorType, actorUserId: event.actorUserId, createdAt: event.createdAt }, null, 2)}</pre></div>)}
          {events.length === 0 ? <Empty>No ordered LearningEvent is attached; this trail is incomplete.</Empty> : null}
          <details><summary>Exact Evidence and provenance lineage</summary><pre>{JSON.stringify({
            runtime: { requestHash: row.request_hash, outputHash: row.output_hash, normalizedOutput: row.normalized_output, normalizedError: row.normalized_error, runtimeContractHash: row.runtime_contract_hash },
            attempt: { sourceRefs: row.source_refs, assistanceProvenance: row.assistance_provenance, contentHash: row.attempt_content_hash },
            activityPlan: { id: row.activity_plan_id, inputHash: row.activity_plan_input_hash, evidenceProvenance: row.evidence_provenance },
            diagnosis: { id: row.diagnosis_id, inputLineage: row.diagnosis_input_lineage, outputLineage: row.diagnosis_output_lineage, structuredResult: row.diagnosis_result },
            context: { id: row.context_compilation_id, snapshotHash: row.context_snapshot_hash },
            resolution: { id: row.capability_resolution_id, decision: row.resolution_decision, rationale: row.selection_rationale },
            exactVersion: { id: row.capability_version_id, contentHash: row.capability_version_content_hash },
          }, null, 2)}</pre></details>
          <h3>Explicit human interventions</h3>
          {interventions.map((intervention) => <pre key={String(intervention.id)}>{JSON.stringify(intervention, null, 2)}</pre>)}
          {eligible ? <TeacherInterventionForm runtimeDeliveryId={deliveryId} capabilities={courseCapabilities}/> : <small>New intervention unavailable: this requires current TEACHER authority and the latest terminal delivery on an open Task/active Episode with a current planning Diagnosis.</small>}
        </article>;
      })}{workspace.runtimeInspections.length === 0 ? <Empty>No terminal RuntimeDelivery with exact Attempt and planning lineage is available in an authorized course.</Empty> : null}</div>
    </Card>
    <div className="stack">{workspace.queue.map((row) => {
      const observationId = String(row.observation_id);
      const reviewId = row.review_id ? String(row.review_id) : null;
      const reviewDecision = row.review_decision ? String(row.review_decision) : null;
      const waitingThread = row.waiting_thread_id ? String(row.waiting_thread_id) : null;
      const fileAssetId = row.file_asset_id ? String(row.file_asset_id) : null;
      const fileMediaType = row.file_media_type ? String(row.file_media_type) : null;
      const transferSource = {
        context: String(row.task_title).trim().slice(0, 120),
        representation: row.modality ? String(row.modality) : fileAssetId ? "MULTIMODAL" : "TEXT",
        itemFamily: String(row.capability_key ?? ""),
        problemStructure: String(row.implementation_key ?? ""),
      };
      const activeSupport = workspace.componentSupport.find((support) => String(support.observation_id) === observationId);
      const supportContent = activeSupport?.content && typeof activeSupport.content === "object" ? activeSupport.content as Record<string, unknown> : null;
      return <Card key={observationId} eyebrow={String(row.learner_name)} title={String(row.task_title)}>
        <div className="metric-grid"><div><small>Attempt</small><p>{String(row.prompt)}</p><strong>{String(row.response)}</strong></div><div><small>Observation</small><p>{String(row.summary)}</p><Badge tone="warn">{String(row.observation_source)}</Badge></div><div><small>Source refs</small><pre>{JSON.stringify(row.source_refs, null, 2)}</pre></div></div>
        {fileAssetId ? <article className="evidence-card"><strong>Original learner upload</strong><p><a href={`/api/files/${fileAssetId}`} target="_blank" rel="noreferrer">Open {String(row.file_name)}</a></p>{fileMediaType?.startsWith("image/") ? <Image unoptimized src={`/api/files/${fileAssetId}`} alt={`Original learner Attempt: ${String(row.file_name)}`} width={640} height={480} style={{ width: "100%", height: "auto" }}/> : null}<div className="metric-grid"><div><small>Extraction / transcription</small><p>{String(row.file_extraction_text ?? "Unavailable")}</p></div><div><small>Derived model interpretation</small><p>{String(row.file_interpretation ?? "Unavailable")}</p><Badge tone={row.file_interpretation_status === "AVAILABLE" ? "good" : "warn"}>{String(row.file_interpretation_status)}</Badge></div></div><small>The original upload and derived interpretation are separate. The interpretation is not a TeacherReview or deterministic Diagnosis.</small></article> : null}
        {activeSupport ? <article className="evidence-card" data-testid="active-component-support"><div className="header-actions"><strong>Active published Component · {String(activeSupport.component_title)}</strong><Badge tone="good">v{String(activeSupport.component_version)}</Badge></div><p>{String(supportContent?.teachingSupport ?? "")}</p><p><strong>Scaffold:</strong> {String(supportContent?.scaffoldHint ?? "")}</p>{activeSupport.delivery_id ? <small>Delivered to the learner at {String(activeSupport.delivered_at)}. Historical delivery remains pinned to this version.</small> : <ComponentDeliveryForm observationId={observationId}/>}</article> : reviewId && reviewDecision !== "ESCALATE" ? <Empty>No active published Component matches this reviewed failure signal.</Empty> : null}
        {reviewDecision === "ESCALATE" ? <div data-testid="terminal-escalation"><Badge tone="bad">ESCALATED · terminal</Badge><p>This human Review requires specialist resolution. Follow-up, Component candidate and Component delivery actions are unavailable for this Observation.</p></div> : waitingThread ? <ReviewForm threadId={waitingThread} expectedVersion={Number(row.waiting_interrupt_version)}/> : reviewId && String(row.observation_source) === "CAPABILITY" ? <>{teacherCommandCourseIds.has(String(row.course_id)) ? <GovernedFollowupForm observationId={observationId} reviewId={reviewId} transferSource={transferSource}/> : <small>Governed follow-up assignment is unavailable: current TEACHER authority for this exact course is required. Admin visibility remains read-only.</small>}<CandidateForm observationId={observationId}/></> : reviewId ? <small>Governed follow-up and Component candidate actions require an exact reviewed Capability Diagnosis.</small> : <Badge tone="bad">No resumable Review workflow</Badge>}
      </Card>;
    })}{workspace.queue.length === 0 ? <Empty>No course-scoped observations.</Empty> : null}</div>
    <div className="workspace-grid"><Card eyebrow="Reviewed capability signals" title="Course-scoped failure codes">{workspace.patterns.map((pattern) => <p key={String(pattern.pattern)}><strong>{String(pattern.pattern)}</strong> · {String(pattern.count)} reviewed capability observations · {String(pattern.learners)} learners</p>)}{workspace.patterns.length === 0 ? <Empty>No reviewed CAPABILITY observation with a failure code is available. Unavailable, unreviewed and null-code observations are not aggregated.</Empty> : null}</Card><Card eyebrow="Follow-up results" title="Human Review without Outcome">{workspace.pendingWorkflows.filter((run) => run.interruptType === "FOLLOWUP_RESULT_REVIEW_REQUIRED").map((run) => {
      const activity = workspace.retries.find(({ retry }) => retry.id === run.productLinks.activityId);
      const contract = teacherContract(activity);
      return !contract
        ? <div className="evidence-card" data-testid="followup-contract-integrity-error" key={run.id}><Badge tone="bad">CONTRACT INTEGRITY REQUIRED</Badge><p>The exact governed activity or immutable type-specific contract is missing. Review is disabled rather than treated as Retry.</p></div>
        : activity?.retry.courseId && teacherCommandCourseIds.has(activity.retry.courseId)
          ? <FollowupResultReviewForm key={run.id} threadId={run.threadId} expectedVersion={run.interruptVersion} contract={contract}/>
          : <div className="evidence-card" data-testid="followup-review-authority-unavailable" key={run.id}><ImmutableFollowupContract contract={contract}/><p>Result Review is unavailable: current TEACHER authority for this exact course is required. Admin visibility remains read-only.</p></div>;
    })}{workspace.pendingWorkflows.every((run) => run.interruptType !== "FOLLOWUP_RESULT_REVIEW_REQUIRED") ? <Empty>No Retry, Transfer, or Retention result is waiting for Review.</Empty> : null}</Card></div>
    <Card eyebrow="Governed follow-up history" title="Durable status, contracts and human Reviews"><div className="stack">{workspace.retries.filter(({ retry }) => Boolean(retry.idempotencyKey) && new Set(["REVIEWED", "ESCALATED", "FAILED_FINAL", "CANCELLED"]).has(retry.status)).map((activity) => {
      const contract = teacherContract(activity);
      const fact = terminalFact(activity.retry);
      return <article className="evidence-card" data-testid="teacher-followup-history" key={activity.retry.id}>
        <div className="header-actions"><strong>{activity.task.title} · {activity.retry.activityType}</strong><Badge tone={activity.retry.status === "REVIEWED" ? "good" : "warn"}>{activity.retry.status}</Badge></div>
        <p>{activity.retry.prompt}</p>
        {contract ? <ImmutableFollowupContract contract={contract}/> : <Badge tone="bad">CONTRACT INTEGRITY REQUIRED</Badge>}
        {fact ? <p><strong>{fact.code ?? activity.retry.status}:</strong> {fact.reason ?? "No terminal reason was recorded."}{fact.recordedAt ? ` · ${new Date(fact.recordedAt).toLocaleString()}` : ""}</p> : null}
        {activity.resultReview ? <section data-testid="teacher-followup-result-review-history"><strong>Result TeacherReview · {activity.resultReview.decision}</strong><p>{activity.resultReview.teachingSupport}</p><small>{activity.resultReview.createdAt.toLocaleString()} · Review {activity.resultReview.id}</small></section> : null}
        {new Set(["REVIEWED", "ESCALATED"]).has(activity.retry.status) ? <small>This is a reviewed follow-up result only. CAP-06 creates no LearningOutcome, mastery decision, or effectiveness claim.</small> : null}
      </article>;
    })}{workspace.retries.every(({ retry }) => !retry.idempotencyKey || !new Set(["REVIEWED", "ESCALATED", "FAILED_FINAL", "CANCELLED"]).has(retry.status)) ? <Empty>No terminal governed follow-up history is available.</Empty> : null}</div></Card>
    <Card eyebrow="Source governance" title="Uploaded learning-material rights and ingestion">{workspace.sourceReviews.map(({ source, asset, task }) => <article className="evidence-card" key={source.id}><strong>{source.title}</strong><p>{task.title} · {asset.originalName}</p><div className="header-actions"><Badge tone={asset.ingestionStatus === "EXTRACTED" ? "good" : asset.ingestionStatus === "FAILED" ? "bad" : "warn"}>Ingestion · {asset.ingestionStatus}</Badge><Badge tone={source.rightsAuthorizationStatus === "APPROVED" ? "good" : source.rightsAuthorizationStatus === "DENIED" ? "bad" : "warn"}>Rights · {source.rightsAuthorizationStatus}</Badge></div><a href={`/api/files/${asset.id}`} target="_blank" rel="noreferrer">Inspect original upload</a>{asset.mediaType.startsWith("image/") ? <><div className="metric-grid"><div><small>Model-derived visible-content transcription</small><p>{asset.extractionText ?? "Unavailable"}</p></div><div><small>Separate model interpretation</small><p>{asset.interpretation ?? "Unavailable"}</p><Badge tone={asset.interpretationStatus === "AVAILABLE" ? "good" : "warn"}>{asset.interpretationStatus}</Badge></div></div><small>The original image remains the cited Source. Rights approval can materialize its transcription as Evidence; interpretation is excluded.</small></> : <p>{asset.failureMessage ?? asset.extractionText?.slice(0, 500) ?? "No extracted content is available."}</p>}{source.rightsAuthorizationStatus === "REVIEW_REQUIRED" ? <SourceRightsForm sourceId={source.id} currentRights={source.rights}/> : <small>Terminal authenticated human rights decision recorded.</small>}</article>)}{workspace.sourceReviews.length === 0 ? <Empty>No uploaded course material is awaiting or carrying a rights decision.</Empty> : null}</Card>
  </>;
  });
}
