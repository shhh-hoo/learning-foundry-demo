"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";

function useAction() {
  const router = useRouter();
  const [transitionPending, startTransition] = useTransition();
  const [requestPending, setRequestPending] = useState(false);
  const requestInFlight = useRef(false);
  const [message, setMessage] = useState("");
  const run = async (url: string, body: Record<string, unknown>, method = "POST") => {
    if (requestInFlight.current) throw new Error("This request is already in progress");
    requestInFlight.current = true;
    setRequestPending(true);
    setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) { startTransition(() => router.refresh()); throw new Error(data.error ?? "Request failed"); }
      setMessage("Saved");
      startTransition(() => router.refresh());
      return data;
    } finally {
      requestInFlight.current = false;
      setRequestPending(false);
    }
  };
  return { run, pending: requestPending || transitionPending, message, setMessage };
}

function useMultipartAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const run = async (url: string, body: FormData) => {
    setMessage("");
    const response = await fetch(url, { method: "POST", body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Request failed");
    setMessage("Saved");
    startTransition(() => router.refresh());
    return data;
  };
  return { run, pending, message, setMessage };
}

function randomKey(prefix: string) { return `${prefix}:${crypto.randomUUID()}`; }

function useStableCommandKey(prefix: string) {
  const key = useRef<string | null>(null);
  if (key.current == null) key.current = randomKey(prefix);
  return {
    current: () => key.current!,
    regenerate: () => { key.current = randomKey(prefix); },
  };
}

const subscribeHydration = () => () => undefined;
const clientHydrated = () => true;
const serverNotHydrated = () => false;

function useHydrated() {
  return useSyncExternalStore(subscribeHydration, clientHydrated, serverNotHydrated);
}

export function CreateTaskForm({ courseId }: { courseId: string }) {
  const action = useAction();
  return <form className="stack" data-testid="create-task-form" onSubmit={async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try { await action.run("/api/tasks", { courseId, title: form.get("title"), goal: form.get("goal"), idempotencyKey: randomKey("task") }); formElement.reset(); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to create Task"); }
  }}>
    <label>Task title<input name="title" required minLength={3} placeholder="What are you working on?" /></label>
    <label>Learning goal<textarea name="goal" required minLength={5} placeholder="Describe what successful learning should look like." /></label>
    <button disabled={action.pending}>Create Learning Task</button><FormStatus value={action.message}/>
  </form>;
}

export function CloseTaskButton({ taskId }: { taskId: string }) {
  const action = useAction();
  return <button className="ghost" disabled={action.pending} onClick={async () => {
    try { await action.run(`/api/tasks/${taskId}/close`, {}); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to close Task"); }
  }}>Close Task</button>;
}

export function MessageForm({ taskId, episodeId }: { taskId: string; episodeId: string }) {
  const action = useAction();
  const [intent, setIntent] = useState<"EXPLAIN" | "LIBRARY" | "STUDY_REVIEW">("EXPLAIN");
  return <form className="stack" data-testid="message-form" onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const scheduledFor = form.get("scheduledFor");
    try { await action.run(`/api/tasks/${taskId}/messages`, { episodeId, message: form.get("message"), action: intent, scheduledFor: scheduledFor ? new Date(String(scheduledFor)).toISOString() : undefined, idempotencyKey: randomKey("message") }); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to run action"); }
  }}>
    <label>Ask with active Task context<textarea name="message" required placeholder="Ask for an Evidence-grounded explanation or resource." /></label>
    <div className="segmented" aria-label="Product action">
      {(["EXPLAIN", "LIBRARY", "STUDY_REVIEW"] as const).map((value) => <button key={value} type="button" className={intent === value ? "selected" : "ghost"} onClick={() => setIntent(value)}>{value === "EXPLAIN" ? "Explain" : value === "LIBRARY" ? "Save Evidence" : "Study reminder"}</button>)}
    </div>
    {intent === "STUDY_REVIEW" ? <label>Study Review due date<input name="scheduledFor" type="datetime-local" required /></label> : null}
    <button disabled={action.pending}>Run {intent === "STUDY_REVIEW" ? "study reminder" : intent.toLowerCase()}</button><FormStatus value={action.message}/>
  </form>;
}

type LearnerCapabilityField = {
  key: string;
  label: string;
  kind: "number" | "quantity";
  help: string;
  min?: number;
  step?: number;
  unitOptions?: string[];
  defaultUnit?: string;
};

export type LearnerCapability = {
  publicKey: string;
  capabilityVersionId?: string;
  name: string;
  purpose: string;
  fields: LearnerCapabilityField[];
  example: string;
};

export type FollowupContractView = {
  activityType: "RETRY" | "TRANSFER" | "RETENTION";
  transfer?: {
    source?: Record<string, unknown>;
    target?: Record<string, unknown>;
    materialDifferenceRationale?: string;
    evidenceLimit?: string;
    changedDimensions?: string[];
  } | null;
  retention?: {
    dueAt: string;
    declaredDelaySeconds: number;
    interveningExposure: Record<string, unknown>;
    contentEquivalence: Record<string, unknown>;
    assistancePolicy: Record<string, unknown>;
  } | null;
};

export function ImmutableFollowupContract({ contract }: { contract: FollowupContractView }) {
  if (contract.activityType === "TRANSFER" && contract.transfer) {
    return <section className="evidence-card" data-testid="immutable-transfer-contract">
      <strong>Immutable Transfer contract</strong>
      <pre>{JSON.stringify({ source: contract.transfer.source, target: contract.transfer.target, changedDimensions: contract.transfer.changedDimensions }, null, 2)}</pre>
      <p><strong>Material-difference rationale:</strong> {contract.transfer.materialDifferenceRationale}</p>
      <small>Evidence limit · {contract.transfer.evidenceLimit}</small>
    </section>;
  }
  if (contract.activityType === "RETENTION" && contract.retention) {
    return <section className="evidence-card" data-testid="immutable-retention-contract">
      <strong>Immutable Retention assignment contract</strong>
      <pre>{JSON.stringify({
        dueAt: contract.retention.dueAt,
        declaredDelaySeconds: contract.retention.declaredDelaySeconds,
        assignmentTimeInterveningExposure: contract.retention.interveningExposure,
        contentEquivalence: contract.retention.contentEquivalence,
        assistancePolicy: contract.retention.assistancePolicy,
      }, null, 2)}</pre>
      <small>Assignment-time declarations remain separate from the teacher&apos;s completion-time exposure confirmation.</small>
    </section>;
  }
  return <small>Retry preserves the reviewed issue while creating a new exact runtime and review chain.</small>;
}

export function AttemptForm({ taskId, episodeId, capabilities = [] }: { taskId: string; episodeId: string; capabilities?: LearnerCapability[] }) {
  const action = useAction();
  const [selectedKey, setSelectedKey] = useState("");
  const [manualEntry, setManualEntry] = useState(false);
  const selected = capabilities.find((capability) => capability.publicKey === selectedKey);
  return <form className="stack" data-testid="attempt-form" onSubmit={async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const fields = Object.fromEntries(manualEntry && selected ? selected.fields.flatMap((field) => field.kind === "quantity"
        ? [[field.key, String(form.get(`field:${field.key}`) ?? "")], [`${field.key}Unit`, String(form.get(`unit:${field.key}`) ?? "")]]
        : [[field.key, String(form.get(`field:${field.key}`) ?? "")]]) : []);
      await action.run("/api/attempts", {
        taskId,
        episodeId,
        capabilityPublicKey: selected?.publicKey,
        fields,
        manualEntry,
        prompt: form.get("prompt"),
        response: form.get("response"),
        idempotencyKey: randomKey("attempt"),
      });
    }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to capture Attempt"); }
  }}>
    <label>Calculation activity hint (optional)<select value={selectedKey} onChange={(event) => { setSelectedKey(event.target.value); setManualEntry(false); }}><option value="">Let Foundry identify the calculation</option>{capabilities.map((capability) => <option key={capability.publicKey} value={capability.publicKey}>{capability.name}</option>)}</select></label>
    {selected ? <label><input type="checkbox" checked={manualEntry} onChange={(event) => setManualEntry(event.target.checked)}/> Enter calculation values myself</label> : null}
    {selected && manualEntry ? <fieldset className="stack"><legend>{selected.name}</legend><p>{selected.purpose}</p>{selected.fields.map((field) => <div className="stack compact" key={field.key}><label htmlFor={`field:${field.key}`}>{field.label}</label><span className="inline-form"><input id={`field:${field.key}`} name={`field:${field.key}`} type="number" required min={field.min} step={field.step ?? "any"} aria-describedby={`help:${field.key}`}/>{field.kind === "quantity" ? <select name={`unit:${field.key}`} defaultValue={field.defaultUnit} aria-label={`${field.label} unit`}>{field.unitOptions?.map((value) => <option key={value} value={value}>{value}</option>)}</select> : null}</span><small id={`help:${field.key}`}>{field.help}</small></div>)}<small><strong>Example:</strong> {selected.example}</small></fieldset> : null}
    <label>Problem or question<textarea name="prompt" required placeholder="Paste or type the chemistry problem you are solving." /></label>
    <label>Your working and answer<textarea name="response" required placeholder="Show your method in your own words, including units and your final answer." /></label>
    <button disabled={action.pending}>Capture Attempt</button><FormStatus value={action.message}/>
    <small>Foundry may make one bounded input-extraction call, then validates the result against the active course activity before checking the final number. This is not Evidence or a comprehensive Diagnosis, and Teacher Review still follows. Manual entry makes no model call.</small>
  </form>;
}

export function MaterialUploadForm({ taskId, episodeId }: { taskId: string; episodeId: string }) {
  const action = useMultipartAction();
  return <form className="stack" data-testid="material-upload-form" onSubmit={async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.set("taskId", taskId);
    form.set("episodeId", episodeId);
    form.set("idempotencyKey", randomKey("material-upload"));
    try { await action.run("/api/files/material", form); formElement.reset(); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to upload learning material"); }
  }}>
    <label>PDF or image<input name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required /></label>
    <label>Source title<input name="title" required minLength={3} /></label>
    <label>Rights/license statement<textarea name="rights" required minLength={3} placeholder="State why the institution may use this material." /></label>
    <button disabled={action.pending}>Upload for ingestion and rights review</button><FormStatus value={action.message}/>
    <small>Upload does not authorize delivery. A course-scoped teacher must approve the explicit rights decision before extracted content can become Evidence.</small>
  </form>;
}

export function ImageAttemptForm({ taskId, episodeId }: { taskId: string; episodeId: string }) {
  const action = useMultipartAction();
  return <form className="stack" data-testid="image-attempt-form" onSubmit={async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.set("taskId", taskId);
    form.set("episodeId", episodeId);
    form.set("idempotencyKey", randomKey("image-attempt"));
    try { await action.run("/api/files/attempt", form); formElement.reset(); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to upload image Attempt"); }
  }}>
    <label>Attempt image<input name="file" type="file" accept="image/png,image/jpeg,image/webp" required /></label>
    <label>Activity prompt<input name="prompt" required defaultValue="Inspect the reasoning shown in this image." /></label>
    <label>Learner note (optional)<textarea name="learnerNote" placeholder="Add context that is not visible in the image." /></label>
    <button disabled={action.pending}>Capture image Attempt</button><FormStatus value={action.message}/>
    <small>The original upload is preserved. Multimodal transcription and interpretation run only when the configured provider executes; otherwise the Teacher receives an explicit unavailable state.</small>
  </form>;
}

export function SourceRightsForm({ sourceId, currentRights }: { sourceId: string; currentRights: string }) {
  const action = useAction();
  const [decision, setDecision] = useState<"APPROVED" | "DENIED">("APPROVED");
  return <form className="inline-form" data-testid="source-rights-form" onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await action.run(`/api/sources/${sourceId}/rights`, { decision, rights: form.get("rights"), idempotencyKey: randomKey("source-rights") }); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to record rights decision"); }
  }}>
    <select value={decision} onChange={(event) => setDecision(event.target.value as "APPROVED" | "DENIED")}><option>APPROVED</option><option>DENIED</option></select>
    <input name="rights" required defaultValue={currentRights} aria-label="Final rights statement" />
    <button disabled={action.pending}>Record human rights decision</button><FormStatus value={action.message}/>
  </form>;
}

type TeacherCourseOption = { id: string; code: string; name: string };
type TeacherLearnerOption = { id: string; courseId: string; name: string };
export type TeacherCapabilityOption = { id: string; courseId: string; key: string; name: string };

export function TeacherAssignmentForm({
  courses,
  learners,
  capabilities,
}: {
  courses: TeacherCourseOption[];
  learners: TeacherLearnerOption[];
  capabilities: TeacherCapabilityOption[];
}) {
  const action = useAction();
  const inFlight = useRef(false);
  const idempotencyKey = useRef(randomKey("teacher-assignment"));
  const [submitting, setSubmitting] = useState(false);
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const courseLearners = learners.filter((learner) => learner.courseId === courseId);
  const courseCapabilities = capabilities.filter((capability) => capability.courseId === courseId);
  return <form className="stack" data-testid="teacher-assignment-form" onSubmit={async (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const selectedValues = (name: string) => form.getAll(name).map(String).filter(Boolean);
    const dueAt = form.get("dueAt");
    try {
      await action.run("/api/teacher/assignments", {
        courseId,
        learnerId: form.get("learnerId"),
        title: form.get("title"),
        goal: form.get("goal"),
        instructions: form.get("instructions"),
        completionRule: form.get("completionRule"),
        dueAt: dueAt ? new Date(String(dueAt)).toISOString() : undefined,
        requiredCapabilityIds: selectedValues("requiredCapabilityIds"),
        excludedCapabilityIds: selectedValues("excludedCapabilityIds"),
        idempotencyKey: idempotencyKey.current,
      });
      idempotencyKey.current = randomKey("teacher-assignment");
      formElement.reset();
    } catch (error) {
      action.setMessage(error instanceof Error ? error.message : "Unable to assign Task");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }}>
    <label>Course<select value={courseId} onChange={(event) => setCourseId(event.target.value)} required>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} · {course.name}</option>)}</select></label>
    <label>Learner<select name="learnerId" key={courseId} required defaultValue=""><option value="" disabled>Select enrolled learner</option>{courseLearners.map((learner) => <option key={learner.id} value={learner.id}>{learner.name}</option>)}</select></label>
    <label>Task title<input name="title" required minLength={3}/></label>
    <label>Goal<textarea name="goal" required minLength={5}/></label>
    <label>Teacher instructions<textarea name="instructions" required minLength={5}/></label>
    <label>Completion rule<textarea name="completionRule" required minLength={5}/></label>
    <label>Due time (optional)<input name="dueAt" type="datetime-local"/></label>
    <label>Required Capabilities (optional)<select name="requiredCapabilityIds" multiple>{courseCapabilities.map((capability) => <option key={capability.id} value={capability.id}>{capability.name} · {capability.key}</option>)}</select></label>
    <label>Excluded Capabilities (optional)<select name="excludedCapabilityIds" multiple>{courseCapabilities.map((capability) => <option key={capability.id} value={capability.id}>{capability.name} · {capability.key}</option>)}</select></label>
    <small>Use Cmd/Ctrl to select multiple. Required and excluded sets must not overlap.</small>
    <button disabled={submitting || action.pending || !courseId || courseLearners.length === 0}>Assign canonical Task</button><FormStatus value={action.message}/>
  </form>;
}

export function TeacherInterventionForm({
  runtimeDeliveryId,
  capabilities,
}: {
  runtimeDeliveryId: string;
  capabilities: TeacherCapabilityOption[];
}) {
  const action = useAction();
  const inFlight = useRef(false);
  const idempotencyKey = useRef(randomKey("teacher-intervention"));
  const [submitting, setSubmitting] = useState(false);
  const [actionType, setActionType] = useState<"REQUIRE_CAPABILITY" | "EXCLUDE_CAPABILITY">("REQUIRE_CAPABILITY");
  return <form className="stack compact" data-testid="teacher-intervention-form" onSubmit={async (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      await action.run("/api/teacher/interventions", {
        runtimeDeliveryId,
        actionType,
        capabilityId: form.get("teacherCapabilityChoice"),
        reason: form.get("reason"),
        idempotencyKey: idempotencyKey.current,
      });
      idempotencyKey.current = randomKey("teacher-intervention");
    } catch (error) {
      action.setMessage(error instanceof Error ? error.message : "Unable to record intervention");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }}>
    <label>Intervention<select value={actionType} onChange={(event) => setActionType(event.target.value as typeof actionType)}><option value="REQUIRE_CAPABILITY">Require Capability next cycle</option><option value="EXCLUDE_CAPABILITY">Exclude Capability next cycle</option></select></label>
    <label>Capability<select name="teacherCapabilityChoice" required defaultValue=""><option value="" disabled>Select course Capability</option>{capabilities.map((capability) => <option key={capability.id} value={capability.id}>{capability.name} · {capability.key}</option>)}</select></label>
    <label>Human reason<textarea name="reason" required minLength={5}/></label>
    <button disabled={submitting || action.pending || capabilities.length === 0}>Record explicit intervention</button><FormStatus value={action.message}/>
  </form>;
}

export function ReviewForm({ threadId, expectedVersion }: { threadId: string; expectedVersion: number }) {
  const action = useAction();
  const [decision, setDecision] = useState("ACCEPT");
  return <form className="inline-form" data-testid="teacher-review-form" onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await action.run(`/api/workflows/${encodeURIComponent(threadId)}/resume`, { expectedVersion, decision: form.get("decision"), correction: form.get("correction") || undefined, supplement: form.get("supplement") || undefined, teachingSupport: form.get("support"), idempotencyKey: randomKey("review") }); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to review"); }
  }}>
    <select name="decision" value={decision} onChange={(event) => setDecision(event.target.value)}><option>ACCEPT</option><option>CORRECT</option><option>SUPPLEMENT</option><option>ESCALATE</option></select>
    {decision === "CORRECT" ? <input name="correction" required placeholder="Required correction" /> : null}
    {decision === "SUPPLEMENT" ? <input name="supplement" required placeholder="Required supplement" /> : null}
    <input name="support" required placeholder="Teaching support" />
    <button disabled={action.pending}>Review & resume</button><FormStatus value={action.message}/>
  </form>;
}

export function GovernedFollowupForm(props: {
  observationId: string;
  reviewId: string;
  transferSource: { context: string; representation: string; itemFamily: string; problemStructure: string };
}) {
  const action = useAction();
  const commandKey = useStableCommandKey("followup");
  const [activityType, setActivityType] = useState<"RETRY" | "TRANSFER" | "RETENTION">("RETRY");
  return <form className="stack compact" data-testid="governed-followup-form" onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const base = { observationId: props.observationId, reviewId: props.reviewId, activityType, prompt: form.get("prompt"), assignmentIdempotencyKey: commandKey.current() };
    const transfer = activityType === "TRANSFER" ? {
      transfer: {
        target: {
          context: form.get("transferContext"),
          representation: form.get("transferRepresentation"),
          itemFamily: form.get("transferItemFamily"),
          problemStructure: form.get("transferProblemStructure"),
        },
        materialDifferenceRationale: form.get("materialDifferenceRationale"),
      },
    } : {};
    const retention = activityType === "RETENTION" ? {
      retention: {
        declaredDelaySeconds: Number(form.get("declaredDelaySeconds")),
        scheduledFor: new Date(String(form.get("scheduledFor"))).toISOString(),
        interveningExposure: { kind: form.get("exposureKind"), detail: form.get("exposureDetail") },
        contentEquivalence: { kind: form.get("equivalenceKind"), rationale: form.get("equivalenceRationale") },
        assistancePolicy: { kind: form.get("assistanceKind"), allowed: form.get("assistanceAllowed") },
      },
    } : {};
    try { await action.run("/api/followups", { ...base, ...transfer, ...retention }); commandKey.regenerate(); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to assign governed follow-up"); }
  }}>
    <label>Follow-up type<select value={activityType} onChange={(event) => setActivityType(event.target.value as typeof activityType)}><option>RETRY</option><option>TRANSFER</option><option>RETENTION</option></select></label>
    <label>Learner activity prompt<textarea name="prompt" required minLength={5} placeholder="Prompt tied to this reviewed issue"/></label>
    {activityType === "TRANSFER" ? <fieldset className="stack compact"><legend>Authenticated teacher Transfer declaration</legend>
      <small>Canonical source values are shown below. The current runtime can honestly vary only the context: target representation is STRUCTURED and the exact Capability and implementation stay fixed.</small>
      <pre>{JSON.stringify(props.transferSource, null, 2)}</pre>
      <label>Target context<input name="transferContext" defaultValue={props.transferSource.context} required/></label>
      <label>Target representation<input name="transferRepresentation" value="STRUCTURED" readOnly required/></label>
      <label>Target item family<input name="transferItemFamily" value={props.transferSource.itemFamily} readOnly required/></label><label>Target problem structure<input name="transferProblemStructure" value={props.transferSource.problemStructure} readOnly required/></label>
      <label>Why this is materially different<textarea name="materialDifferenceRationale" required minLength={10}/></label>
      <small>Change the target context materially. The source signature is canonical and the target is your authenticated declaration; Foundry does not claim to have machine-proven the contextual difference.</small>
    </fieldset> : null}
    {activityType === "RETENTION" ? <fieldset className="stack compact"><legend>Retention schedule and exposure contract</legend>
      <label>Declared delay in seconds<input name="declaredDelaySeconds" type="number" min={1} max={31536000} defaultValue={86400} required/></label>
      <label>Scheduled time<input name="scheduledFor" type="datetime-local" required/></label>
      <label>Intervening exposure<select name="exposureKind"><option>NONE_DECLARED</option><option>SAME_CONTENT</option><option>RELATED_CONTENT</option><option>UNKNOWN</option></select></label>
      <label>Exposure detail<textarea name="exposureDetail" required/></label>
      <label>Content equivalence<select name="equivalenceKind"><option>EXACT</option><option>EQUIVALENT_FORM</option><option>SAME_CONCEPT_DIFFERENT_ITEM</option></select></label>
      <label>Equivalence rationale<textarea name="equivalenceRationale" required minLength={5}/></label>
      <label>Assistance policy<select name="assistanceKind"><option>INDEPENDENT</option><option>STANDARD_SUPPORT</option><option>DECLARED_ASSISTANCE</option></select></label>
      <label>Allowed assistance<textarea name="assistanceAllowed" required/></label>
    </fieldset> : null}
    <button disabled={action.pending}>Assign governed {activityType}</button><FormStatus value={action.message}/>
  </form>;
}

export function FollowupAttemptForm({ threadId, expectedVersion, prompt, contract, scheduledFor, capabilities, unavailableReason }: { threadId: string; expectedVersion: number; prompt: string; contract: FollowupContractView; scheduledFor?: string; capabilities: LearnerCapability[]; unavailableReason?: string }) {
  const action = useAction();
  const commandKey = useStableCommandKey("followup-attempt");
  const selectedKey = capabilities[0]?.publicKey ?? "";
  const selected = capabilities.find((capability) => capability.publicKey === selectedKey);
  return <form className="stack compact" data-testid="followup-attempt-form" onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const fields = Object.fromEntries(selected ? selected.fields.flatMap((field) => field.kind === "quantity"
      ? [[field.key, String(form.get(`followup-field:${field.key}`) ?? "")], [`${field.key}Unit`, String(form.get(`followup-unit:${field.key}`) ?? "")]]
      : [[field.key, String(form.get(`followup-field:${field.key}`) ?? "")]]) : []);
    try { await action.run(`/api/workflows/${encodeURIComponent(threadId)}/resume`, { expectedVersion, response: form.get("response"), capabilityPublicKey: selectedKey, fields, idempotencyKey: commandKey.current() }); commandKey.regenerate(); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to submit follow-up"); }
  }}><div className="header-actions"><strong>{contract.activityType}</strong>{scheduledFor ? <small>Scheduled {new Date(scheduledFor).toLocaleString()}</small> : null}</div><p>{prompt}</p>
    <ImmutableFollowupContract contract={contract}/>
    {selected ? <p><strong>Exact planned activity:</strong> {selected.name} · version {selected.capabilityVersionId}</p> : <small>{unavailableReason ?? "The exact planned CapabilityVersion is unavailable or stale; submission is disabled."}</small>}
    {selected ? <fieldset className="stack compact"><legend>{selected.name}</legend>{selected.fields.map((field) => <div className="stack compact" key={field.key}><label htmlFor={`followup-field:${field.key}`}>{field.label}</label><span className="inline-form"><input id={`followup-field:${field.key}`} name={`followup-field:${field.key}`} type="number" min={field.min} step={field.step ?? "any"} required aria-describedby={`followup-help:${field.key}`}/>{field.kind === "quantity" ? <select name={`followup-unit:${field.key}`} defaultValue={field.defaultUnit} aria-label={`${field.label} unit`}>{field.unitOptions?.map((unit) => <option key={unit}>{unit}</option>)}</select> : null}</span><small id={`followup-help:${field.key}`}>{field.help}</small></div>)}</fieldset> : null}
    <label>Your new reasoning and answer<textarea name="response" required placeholder="Complete the governed follow-up activity"/></label><button disabled={action.pending || !selected}>Submit {contract.activityType} Attempt</button><FormStatus value={action.message}/></form>;
}

export function CancelFollowupForm({ activityId }: { activityId: string }) {
  const action = useAction();
  return <form className="stack compact" data-testid="cancel-followup-form" onSubmit={async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try { await action.run(`/api/followups/${encodeURIComponent(activityId)}`, { reason: form.get("reason") }, "DELETE"); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to cancel follow-up"); }
  }}>
    <label>Cancellation reason<input name="reason" minLength={5} maxLength={1000} required placeholder="Why this assigned follow-up should stop"/></label>
    <button className="ghost" disabled={action.pending}>Cancel before runtime</button><FormStatus value={action.message}/>
  </form>;
}

export function FollowupResultReviewForm({ threadId, expectedVersion, contract }: { threadId: string; expectedVersion: number; contract: FollowupContractView }) {
  const action = useAction();
  const commandKey = useStableCommandKey("followup-review");
  const [decision, setDecision] = useState("ACCEPT");
  return <form className="stack compact" data-testid="followup-review-form" onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const retentionExposure = contract.activityType === "RETENTION" ? {
      kind: form.get("completedExposureKind"),
      detail: form.get("completedExposureDetail"),
    } : undefined;
    const transferContractConfirmed = contract.activityType === "TRANSFER"
      ? form.get("transferContractConfirmed") === "on"
      : undefined;
    try { await action.run(`/api/workflows/${encodeURIComponent(threadId)}/resume`, {
      expectedVersion, decision, correction: form.get("correction") || undefined, supplement: form.get("supplement") || undefined, teachingSupport: form.get("support"), reviewIdempotencyKey: commandKey.current(), retentionExposure, transferContractConfirmed,
    }); commandKey.regenerate(); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to complete review"); }
  }}>
    <select name="decision" value={decision} onChange={(event) => setDecision(event.target.value)}><option>ACCEPT</option><option>CORRECT</option><option>SUPPLEMENT</option><option>ESCALATE</option></select>
    {decision === "CORRECT" ? <input name="correction" required placeholder="Required correction"/> : null}
    {decision === "SUPPLEMENT" ? <input name="supplement" required placeholder="Required supplement"/> : null}
    <ImmutableFollowupContract contract={contract}/>
    {contract.activityType === "TRANSFER" ? <label><input name="transferContractConfirmed" type="checkbox" required/> I confirm the completed activity used this immutable target context and the disclosed evidence limit.</label> : null}
    {contract.activityType === "RETENTION" ? <fieldset className="stack compact"><legend>Confirm actual intervening exposure</legend>
      <label>Observed exposure<select name="completedExposureKind"><option>NONE_DECLARED</option><option>SAME_CONTENT</option><option>RELATED_CONTENT</option><option>UNKNOWN</option></select></label>
      <label>What actually occurred during the delay<textarea name="completedExposureDetail" required minLength={1} maxLength={1000}/></label>
      <small>This completion-time teacher confirmation is stored separately from the assignment-time expectation.</small>
    </fieldset> : null}
    <small>This records only the new human TeacherReview. CAP-06 does not create a LearningOutcome, mastery decision, or effectiveness claim.</small>
    <input name="support" required placeholder="Human teaching support"/>
    <button disabled={action.pending}>{decision === "ESCALATE" ? "Record escalation" : "Review follow-up result"}</button><FormStatus value={action.message}/>
  </form>;
}

type EvidenceOption = { id: string; title: string; locator: string; sourceTitle: string };

function componentContent(form: FormData) {
  const evidenceUnitId = String(form.get("evidenceUnitId") ?? "");
  const attribution = String(form.get("attribution") ?? "").trim();
  return {
    teachingSupport: form.get("teachingSupport"),
    scaffoldHint: form.get("scaffoldHint"),
    workedExample: form.get("workedExample"),
    learnerAction: form.get("learnerAction"),
    evidenceRefs: evidenceUnitId ? [{ evidenceUnitId, attribution }] : [],
  };
}

function contentValue(content: Record<string, unknown>, key: string): string {
  return typeof content[key] === "string" ? String(content[key]) : "";
}

export function CandidateForm({ observationId, evidenceOptions = [] }: { observationId: string; evidenceOptions?: EvidenceOption[] }) {
  const action = useAction();
  return <form className="stack compact" data-testid="candidate-form" onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await action.run("/api/components", { observationId, key: form.get("key"), title: form.get("title"), purpose: form.get("purpose"), content: componentContent(form), idempotencyKey: randomKey("candidate") }); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to create candidate"); }
  }}>
    <input name="key" required pattern="[a-z0-9-]+" placeholder="candidate-key"/><input name="title" required placeholder="Candidate title"/>
    <textarea name="purpose" required minLength={10} placeholder="Purpose grounded in the reviewed pattern"/>
    <textarea name="teachingSupport" required minLength={10} placeholder="Teaching support"/>
    <textarea name="scaffoldHint" required minLength={5} placeholder="Scaffold or hint"/>
    <textarea name="workedExample" required minLength={10} placeholder="Worked example"/>
    <textarea name="learnerAction" required minLength={5} placeholder="Learner action"/>
    <label>Governed Evidence (optional for a deterministic scaffold)<select name="evidenceUnitId" defaultValue=""><option value="">No Evidence claim — explicit NOT_REQUIRED policy</option>{evidenceOptions.map((option) => <option key={option.id} value={option.id}>{option.title} · {option.locator}</option>)}</select></label>
    <input name="attribution" placeholder="Evidence attribution (required when selected)"/>
    <small>Capability and Reference Pack bindings are derived from the persisted reviewed Observation; they are not editable free text.</small>
    <button className="secondary" disabled={action.pending}>Create reviewed Component candidate</button><FormStatus value={action.message}/>
  </form>;
}

export function GapSupplyButton({ capabilityResolutionId }: { capabilityResolutionId: string }) {
  const action = useAction();
  const commandKey = useStableCommandKey("cap07-proposal");
  return <div><button data-testid="gap-supply-button" disabled={action.pending} onClick={async () => {
    try { await action.run("/api/capability-supply", { capabilityResolutionId, idempotencyKey: commandKey.current() }); commandKey.regenerate(); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to propose a bounded Web ComponentAsset"); }
  }}>Create bounded Web ComponentAsset proposal</button><FormStatus value={action.message}/></div>;
}

type WebAssetChoice = { id: string; label: string };

export function WebComponentPreviewForm({ componentId, componentVersionId, prompt, choices }: { componentId: string; componentVersionId: string; prompt: string; choices: WebAssetChoice[] }) {
  const action = useAction();
  const commandKey = useStableCommandKey("cap07-preview");
  const hydrated = useHydrated();
  const [selectedChoiceId, setSelectedChoiceId] = useState("");
  const runPreview = async () => {
    try { await action.run(`/api/components/${componentId}/preview`, { componentVersionId, selectedChoiceId, idempotencyKey: commandKey.current() }); commandKey.regenerate(); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Exact learner preview failed"); }
  };
  return <form className="stack compact" data-testid="web-component-preview-form" data-hydrated={hydrated ? "true" : "false"} onSubmit={(event) => { event.preventDefault(); if (selectedChoiceId) void runPreview(); }}>
    <p><strong>{prompt}</strong></p>
    {choices.map((choice) => <label className="choice-option" key={choice.id}><input type="radio" name="selectedChoiceId" value={choice.id} checked={selectedChoiceId === choice.id} onChange={() => setSelectedChoiceId(choice.id)} required/><span>{choice.label}</span></label>)}
    <button type="button" data-hydrated={hydrated ? "true" : "false"} disabled={!hydrated || !selectedChoiceId || action.pending} onClick={runPreview}>Run exact learner preview</button><FormStatus value={action.message}/>
    <small>Preview executes this exact Draft package. It creates no RuntimeDelivery, LearnerAttempt, Diagnosis, TeacherReview or LearningOutcome.</small>
  </form>;
}

export function LearnerWebComponentAssetForm({ taskId, episodeId, activityPlanProposalId, prompt, choices, retryOfDeliveryId }: { taskId: string; episodeId: string; activityPlanProposalId: string; prompt: string; choices: WebAssetChoice[]; retryOfDeliveryId?: string }) {
  const action = useAction();
  const commandKey = useStableCommandKey(retryOfDeliveryId ? "cap07-delivery-retry" : "cap07-delivery");
  const hydrated = useHydrated();
  return <form className="stack compact" data-testid={retryOfDeliveryId ? "learner-web-component-asset-retry" : "learner-web-component-asset"} data-hydrated={hydrated ? "true" : "false"} onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const selectedChoiceId = String(form.get("selectedChoiceId") ?? "");
    try { await action.run("/api/asset-runtime", { taskId, episodeId, activityPlanProposalId, retryOfDeliveryId, selectedChoiceId, idempotencyKey: commandKey.current() }); commandKey.regenerate(); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "ComponentAsset delivery failed"); }
  }}>
    <p><strong>{prompt}</strong></p>
    {choices.map((choice) => <label className="choice-option" key={choice.id}><input type="radio" name="selectedChoiceId" value={choice.id} required/><span>{choice.label}</span></label>)}
    <button data-hydrated={hydrated ? "true" : "false"} disabled={!hydrated || action.pending}>{retryOfDeliveryId ? "Retry exact learner runtime" : "Submit through exact learner runtime"}</button><FormStatus value={action.message}/>
  </form>;
}

export function CapabilityResolutionButton({ taskId, episodeId, diagnosticObservationId }: { taskId: string; episodeId: string; diagnosticObservationId: string }) {
  const action = useAction();
  return <div><button className="secondary" data-testid="capability-resolution-button" disabled={action.pending} onClick={async () => {
    try { await action.run("/api/capability-resolution", { taskId, episodeId, diagnosticObservationId }); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Capability Resolution failed"); }
  }}>Resolve capability and plan next activity</button><FormStatus value={action.message}/></div>;
}

export function ComponentVersionForm({ componentId, versionId, contract, content, evidenceOptions = [] }: { componentId: string; versionId: string; contract: Record<string, unknown>; content: Record<string, unknown>; evidenceOptions?: EvidenceOption[] }) {
  const action = useAction();
  const currentEvidence = Array.isArray(content.evidenceRefs) ? content.evidenceRefs[0] as { evidenceUnitId?: string; attribution?: string } | undefined : undefined;
  return <form className="stack compact" data-testid="component-version-form" onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await action.run(`/api/components/${componentId}/versions/${versionId}`, { title: form.get("title"), purpose: form.get("purpose"), content: componentContent(form), idempotencyKey: randomKey("version") }, "PATCH"); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to update draft"); }
  }}>
    <label>Title<input name="title" required minLength={3} defaultValue={String(contract.title ?? "")}/></label>
    <label>Purpose<textarea name="purpose" required minLength={10} defaultValue={String(contract.purpose ?? "")}/></label>
    <label>Teaching support<textarea name="teachingSupport" required minLength={10} defaultValue={contentValue(content, "teachingSupport")}/></label>
    <label>Scaffold or hint<textarea name="scaffoldHint" required minLength={5} defaultValue={contentValue(content, "scaffoldHint")}/></label>
    <label>Worked example<textarea name="workedExample" required minLength={10} defaultValue={contentValue(content, "workedExample")}/></label>
    <label>Learner action<textarea name="learnerAction" required minLength={5} defaultValue={contentValue(content, "learnerAction")}/></label>
    <label>Governed Evidence<select name="evidenceUnitId" defaultValue={currentEvidence?.evidenceUnitId ?? ""}><option value="">No Evidence claim — explicit NOT_REQUIRED policy</option>{evidenceOptions.map((option) => <option key={option.id} value={option.id}>{option.title} · {option.locator}</option>)}</select></label>
    <input name="attribution" defaultValue={currentEvidence?.attribution ?? ""} placeholder="Evidence attribution (required when selected)"/>
    <details><summary>Advanced version contract JSON (read only)</summary><pre>{JSON.stringify(contract, null, 2)}</pre></details>
    <button disabled={action.pending}>Save Draft and reset Component evaluation</button><FormStatus value={action.message}/>
  </form>;
}

export function ComponentEvaluationButton({ componentId, versionId }: { componentId: string; versionId: string }) {
  const action = useAction();
  return <div><button data-testid="component-evaluation-button" disabled={action.pending} onClick={async () => { try { await action.run(`/api/components/${componentId}/evaluate`, { componentVersionId: versionId }); } catch (error) { action.setMessage(error instanceof Error ? error.message : "Component evaluation failed"); } }}>Run system evaluation & request expert decision</button><FormStatus value={action.message}/></div>;
}

export function PublicationReviewForm({ threadId, expectedVersion, approvalAllowed }: { threadId: string; expectedVersion: number; approvalAllowed: boolean }) {
  const action = useAction();
  const commandKey = useStableCommandKey("publication");
  const hydrated = useHydrated();
  const [decisionOverride, setDecisionOverride] = useState<"APPROVE" | "REJECT" | null>(null);
  const decision = approvalAllowed ? decisionOverride ?? "APPROVE" : "REJECT";
  return <form className="stack compact" data-testid="publication-review-form" data-hydrated={hydrated ? "true" : "false"} onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await action.run(`/api/workflows/${encodeURIComponent(threadId)}/resume`, {
      expectedVersion,
      action: decision,
      rationale: form.get("rationale"),
      rubric: {
        domainCorrectness: form.get("domainCorrectness"),
        pedagogy: form.get("pedagogy"),
        safety: form.get("safety"),
        reuseReadiness: form.get("reuseReadiness"),
        notes: form.get("notes"),
      },
      idempotencyKey: commandKey.current(),
    }); commandKey.regenerate(); } catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to record publication decision"); }
  }}>
    <label>Decision<select value={decision} onChange={(event) => setDecisionOverride(event.target.value as "APPROVE" | "REJECT")}><option value="APPROVE" disabled={!approvalAllowed}>APPROVE</option><option value="REJECT">REJECT</option></select></label>
    {(["domainCorrectness", "pedagogy", "safety", "reuseReadiness"] as const).map((field) => <label key={field}>{field}<select name={field} defaultValue="PASS"><option>PASS</option><option>FAIL</option></select></label>)}
    <label>Expert rubric notes<textarea name="notes" required minLength={5}/></label>
    <label>Immutable decision rationale<textarea name="rationale" required minLength={5}/></label>
    <button data-hydrated={hydrated ? "true" : "false"} disabled={!hydrated || action.pending}>{decision === "APPROVE" ? "Approve and publish immutable version" : "Reject immutable version"}</button><FormStatus value={action.message}/>
  </form>;
}

export function RollbackForm({ componentId, expectedActiveVersionId, versions }: { componentId: string; expectedActiveVersionId: string; versions: Array<{ id: string; version: string }> }) {
  const action = useAction();
  return <form className="inline-form" data-testid="component-rollback-form" onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await action.run(`/api/components/${componentId}/rollback`, { targetVersionId: form.get("targetVersionId"), expectedActiveVersionId, rationale: form.get("rationale"), idempotencyKey: randomKey("rollback") }); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to roll back Component"); }
  }}><select name="targetVersionId" required defaultValue=""><option value="" disabled>Select published version</option>{versions.filter((version) => version.id !== expectedActiveVersionId).map((version) => <option key={version.id} value={version.id}>{version.version}</option>)}</select><input name="rationale" required minLength={5} placeholder="Rollback rationale"/><button disabled={action.pending}>Activate earlier published version</button><FormStatus value={action.message}/></form>;
}

export function ComponentDeliveryForm({ observationId }: { observationId: string }) {
  const action = useAction();
  return <div><button data-testid="component-delivery-button" disabled={action.pending} onClick={async () => { try { await action.run("/api/components/deliveries", { observationId, idempotencyKey: randomKey("component-delivery") }); } catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to deliver Component support"); } }}>Deliver active Component support</button><FormStatus value={action.message}/></div>;
}

export function AssetOptimizationProposalButton({ runtimeDeliveryId }: { runtimeDeliveryId: string }) {
  const action = useAction();
  const commandKey = useStableCommandKey("cap08a-proposal");
  return <div><button data-testid="asset-optimization-proposal-button" disabled={action.pending} onClick={async () => {
    try {
      await action.run("/api/asset-optimization/proposals", { runtimeDeliveryId, idempotencyKey: commandKey.current() });
      commandKey.regenerate();
    } catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to create the Asset Optimization Proposal"); }
  }}>Create evidence-bound Asset proposal</button><FormStatus value={action.message}/></div>;
}

export function AssetOptimizationDecisionForm({ proposalId }: { proposalId: string }) {
  const action = useAction();
  const commandKey = useStableCommandKey("cap08a-decision");
  const hydrated = useHydrated();
  const [decision, setDecision] = useState<"REQUEST_SUCCESSOR" | "KEEP_CURRENT">("REQUEST_SUCCESSOR");
  return <form className="stack compact" data-testid="asset-optimization-decision-form" data-hydrated={hydrated ? "true" : "false"} onSubmit={async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await action.run(`/api/asset-optimization/proposals/${proposalId}/decisions`, { action: decision, rationale: form.get("rationale"), idempotencyKey: commandKey.current() });
      commandKey.regenerate();
    } catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to govern the Asset Optimization Proposal"); }
  }}>
    <label>Next action<select value={decision} onChange={(event) => setDecision(event.target.value as "REQUEST_SUCCESSOR" | "KEEP_CURRENT")}><option value="REQUEST_SUCCESSOR">Request governed successor work</option><option value="KEEP_CURRENT">Keep current version</option></select></label>
    <label>Human rationale<textarea name="rationale" required minLength={5} placeholder="Explain why this evidence warrants successor work or no change."/></label>
    <button data-hydrated={hydrated ? "true" : "false"} disabled={!hydrated || action.pending}>Record append-only decision</button>
    <FormStatus value={action.message}/>
    <small>This decision does not create, check, confirm, publish or activate a successor version.</small>
  </form>;
}

export function RunFrameworkContractChecksButton() {
  const action = useAction();
  return <div><button data-testid="run-framework-contract-checks" disabled={action.pending} onClick={async () => { try { await action.run("/api/evals", {}); } catch (error) { action.setMessage(error instanceof Error ? error.message : "Framework contract checks failed"); } }}>Run framework/core contract checks</button><FormStatus value={action.message}/></div>;
}

function FormStatus({ value }: { value: string }) { return <small role="status" aria-live="polite" aria-atomic="true" className={value === "Saved" ? "form-success" : "form-error"}>{value}</small>; }
