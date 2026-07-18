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

export function AttemptForm({ taskId, episodeId, capabilities = [] }: { taskId: string; episodeId: string; capabilities?: Array<{ id: string; name: string; contract?: Record<string, unknown> }> }) {
  const action = useAction();
  return <form className="stack" data-testid="attempt-form" onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      const capabilityId = String(form.get("capabilityId") ?? "");
      const structuredInput = capabilityId ? JSON.parse(String(form.get("structuredInput"))) : { responseType: "FREE_TEXT" };
      await action.run("/api/attempts", {
        taskId, episodeId, capabilityId: capabilityId || undefined, prompt: form.get("prompt"), response: form.get("response"), structuredInput, sourceRefs: [], idempotencyKey: randomKey("attempt"),
      });
    }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to capture Attempt"); }
  }}>
    <label>Deterministic Capability (optional)<select name="capabilityId"><option value="">Teacher inspection only</option>{capabilities.map((capability) => <option key={capability.id} value={capability.id}>{capability.name}</option>)}</select></label>
    {capabilities.length ? <details><summary>Capability input contracts</summary><pre>{JSON.stringify(capabilities.map(({ id, name, contract }) => ({ id, name, contract })), null, 2)}</pre></details> : null}
    {capabilities.length ? <label>Capability input JSON<textarea name="structuredInput" defaultValue={JSON.stringify({ learnerAnswer: 0, tolerance: 0.01 }, null, 2)} /></label> : null}
    <label>Activity prompt<input name="prompt" required defaultValue="Explain your reasoning and identify where supporting Evidence is needed." /></label>
    <label>Your Attempt<textarea name="response" required placeholder="Write your reasoning..." /></label>
    <button disabled={action.pending}>Capture Attempt</button><FormStatus value={action.message}/>
    <small>Selecting a listed Capability runs its persisted deterministic adapter. Without one, the Attempt remains review-required and no automated Diagnosis is claimed.</small>
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

export function CandidateForm({ observationId }: { observationId: string }) {
  const action = useAction();
  return <form className="stack compact" data-testid="candidate-form" onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await action.run("/api/components", { observationId, key: form.get("key"), title: form.get("title"), purpose: form.get("purpose"), capabilityKey: form.get("capabilityKey"), referencePackKey: form.get("referencePackKey"), content: { support: form.get("support") }, idempotencyKey: randomKey("candidate") }); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to create candidate"); }
  }}>
    <input name="key" required pattern="[a-z0-9-]+" placeholder="candidate-key"/><input name="title" required placeholder="Candidate title"/>
    <textarea name="purpose" required placeholder="Purpose grounded in the reviewed pattern"/><input name="capabilityKey" required pattern="[a-z0-9-]+" placeholder="capability-key"/>
    <input name="referencePackKey" required placeholder="Reference Pack key"/><textarea name="support" required placeholder="Editable teaching support"/>
    <button className="secondary" disabled={action.pending}>Create reviewed Component candidate</button><FormStatus value={action.message}/>
  </form>;
}

export function ComponentVersionForm({ componentId, versionId, contract, content }: { componentId: string; versionId: string; contract: Record<string, unknown>; content: Record<string, unknown> }) {
  const action = useAction();
  return <form className="stack compact" data-testid="component-version-form" onSubmit={async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await action.run(`/api/components/${componentId}/versions/${versionId}`, { contract: JSON.parse(String(form.get("contract"))), content: JSON.parse(String(form.get("content"))), idempotencyKey: randomKey("version") }, "PATCH"); }
    catch (error) { action.setMessage(error instanceof Error ? error.message : "Unable to update draft"); }
  }}><label>Contract JSON<textarea name="contract" defaultValue={JSON.stringify(contract, null, 2)} /></label><label>Content JSON<textarea name="content" defaultValue={JSON.stringify(content, null, 2)} /></label><button disabled={action.pending}>Save draft & reset structural preflight</button><FormStatus value={action.message}/></form>;
}

export function StructuralPreflightButton({ componentId, versionId }: { componentId: string; versionId: string }) {
  const action = useAction();
  return <div><button data-testid="structural-preflight-button" disabled={action.pending} onClick={async () => { try { await action.run(`/api/components/${componentId}/preflight`, { componentVersionId: versionId }); } catch (error) { action.setMessage(error instanceof Error ? error.message : "Structural preflight failed"); } }}>Run structural preflight</button><FormStatus value={action.message}/></div>;
}

export function RunFrameworkContractChecksButton() {
  const action = useAction();
  return <div><button data-testid="run-framework-contract-checks" disabled={action.pending} onClick={async () => { try { await action.run("/api/evals", {}); } catch (error) { action.setMessage(error instanceof Error ? error.message : "Framework contract checks failed"); } }}>Run framework/core contract checks</button><FormStatus value={action.message}/></div>;
}

function FormStatus({ value }: { value: string }) { return value ? <small className={value === "Saved" ? "form-success" : "form-error"}>{value}</small> : null; }
