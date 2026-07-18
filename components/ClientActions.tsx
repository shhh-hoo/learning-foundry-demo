"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const run = async (url: string, body: Record<string, unknown>, method = "POST") => {
    setMessage("");
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Request failed");
    setMessage("Saved");
    startTransition(() => router.refresh());
    return data;
  };
  return { run, pending, message, setMessage };
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

type LearnerCapability = {
  publicKey: string;
  name: string;
  purpose: string;
  fields: LearnerCapabilityField[];
  example: string;
};

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

export function RetryForm(props: { observationId: string; reviewId: string }) {
  const action = useAction();
  return <form className="inline-form" data-testid="retry-form" onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await action.run("/api/retries", { ...props, activityType: "RETRY", prompt: form.get("prompt"), scheduledFor: form.get("scheduledFor") ? new Date(String(form.get("scheduledFor"))).toISOString() : undefined, assignmentIdempotencyKey: randomKey("retry") }); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to assign retry"); }
  }}>
    <input name="prompt" required placeholder="Reviewed retry prompt" />
    <input name="scheduledFor" type="datetime-local" />
    <button disabled={action.pending}>Assign reviewed Retry</button><FormStatus value={action.message}/>
  </form>;
}

export function RetryAttemptForm({ threadId, expectedVersion, prompt }: { threadId: string; expectedVersion: number; prompt: string }) {
  const action = useAction();
  return <form className="stack compact" data-testid="retry-attempt-form" onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await action.run(`/api/workflows/${encodeURIComponent(threadId)}/resume`, { expectedVersion, response: form.get("response"), structuredInput: { responseType: "FREE_TEXT" }, idempotencyKey: randomKey("retry-attempt") }); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to submit retry"); }
  }}><strong>{prompt}</strong><textarea name="response" required placeholder="Submit your retry reasoning"/><button disabled={action.pending}>Submit retry Attempt</button><FormStatus value={action.message}/></form>;
}

export function RetryResultReviewForm({ threadId, expectedVersion }: { threadId: string; expectedVersion: number }) {
  const action = useAction();
  const [decision, setDecision] = useState("ACCEPT");
  return <form className="stack compact" data-testid="retry-review-form" onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const outcome = decision === "ESCALATE" ? {} : { outcomeStatus: form.get("outcomeStatus"), outcomeNarrative: form.get("narrative"), outcomeIdempotencyKey: randomKey("outcome") };
    try { await action.run(`/api/workflows/${encodeURIComponent(threadId)}/resume`, {
      expectedVersion, decision, correction: form.get("correction") || undefined, supplement: form.get("supplement") || undefined, teachingSupport: form.get("support"), reviewIdempotencyKey: randomKey("retry-review"), ...outcome,
    }); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to complete review"); }
  }}>
    <select name="decision" value={decision} onChange={(event) => setDecision(event.target.value)}><option>ACCEPT</option><option>CORRECT</option><option>SUPPLEMENT</option><option>ESCALATE</option></select>
    {decision === "CORRECT" ? <input name="correction" required placeholder="Required correction"/> : null}
    {decision === "SUPPLEMENT" ? <input name="supplement" required placeholder="Required supplement"/> : null}
    {decision === "ESCALATE" ? <small>Escalation records the human Review and ends this workflow without a LearningOutcome.</small> : <><select name="outcomeStatus"><option>IMPROVED</option><option>MASTERED</option><option>NEEDS_SUPPORT</option></select><textarea name="narrative" required placeholder="Governed Outcome narrative"/></>}
    <input name="support" required placeholder="Human teaching support"/>
    <button disabled={action.pending}>{decision === "ESCALATE" ? "Record escalation" : "Review result & record Outcome"}</button><FormStatus value={action.message}/>
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
  const [decision, setDecision] = useState<"APPROVE" | "REJECT">(approvalAllowed ? "APPROVE" : "REJECT");
  return <form className="stack compact" data-testid="publication-review-form" onSubmit={async (event) => {
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
      idempotencyKey: randomKey("publication"),
    }); } catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to record publication decision"); }
  }}>
    <label>Decision<select value={decision} onChange={(event) => setDecision(event.target.value as "APPROVE" | "REJECT")}><option value="APPROVE" disabled={!approvalAllowed}>APPROVE</option><option value="REJECT">REJECT</option></select></label>
    {(["domainCorrectness", "pedagogy", "safety", "reuseReadiness"] as const).map((field) => <label key={field}>{field}<select name={field} defaultValue="PASS"><option>PASS</option><option>FAIL</option></select></label>)}
    <label>Expert rubric notes<textarea name="notes" required minLength={5}/></label>
    <label>Immutable decision rationale<textarea name="rationale" required minLength={5}/></label>
    <button disabled={action.pending}>{decision === "APPROVE" ? "Approve and publish immutable version" : "Reject immutable version"}</button><FormStatus value={action.message}/>
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

export function RunFrameworkContractChecksButton() {
  const action = useAction();
  return <div><button data-testid="run-framework-contract-checks" disabled={action.pending} onClick={async () => { try { await action.run("/api/evals", {}); } catch (error) { action.setMessage(error instanceof Error ? error.message : "Framework contract checks failed"); } }}>Run framework/core contract checks</button><FormStatus value={action.message}/></div>;
}

function FormStatus({ value }: { value: string }) { return value ? <small className={value === "Saved" ? "form-success" : "form-error"}>{value}</small> : null; }
