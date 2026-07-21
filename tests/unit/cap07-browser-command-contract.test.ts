// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GapSupplyButton,
  LearnerWebComponentAssetForm,
  PublicationReviewForm,
  WebComponentPreviewForm,
} from "@/components/ClientActions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const okResponse = { ok: true, json: async () => ({ status: "saved" }) } as Response;

function lostThenSaved() {
  const fetchMock = vi.fn()
    .mockRejectedValueOnce(new Error("response lost after command commit"))
    .mockResolvedValueOnce(okResponse)
    .mockResolvedValueOnce(okResponse);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function expectStableRetryThenRotation(fetchMock: ReturnType<typeof vi.fn>, submit: () => void) {
  submit();
  await waitFor(() => expect(screen.getByText("response lost after command commit")).toBeTruthy());
  const firstKey = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).idempotencyKey;

  submit();
  await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
  const announced = screen.getByRole("status");
  expect(announced.getAttribute("aria-live")).toBe("polite");
  expect(announced.getAttribute("aria-atomic")).toBe("true");
  const retryKey = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).idempotencyKey;
  expect(retryKey).toBe(firstKey);

  submit();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  const nextKey = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).idempotencyKey;
  expect(nextKey).not.toBe(firstKey);
}

describe("CAP-07 browser command replay contract", () => {
  it("reuses the proposal key after a lost response and rotates only after success", async () => {
    const fetchMock = lostThenSaved();
    render(createElement(GapSupplyButton, { capabilityResolutionId: "10000000-0000-4000-8000-000000000001" }));
    const submit = () => fireEvent.click(screen.getByRole("button", { name: "Create bounded Web ComponentAsset proposal" }));
    await expectStableRetryThenRotation(fetchMock, submit);
  });

  it("reuses the exact preview key after a lost response and rotates only after success", async () => {
    const fetchMock = lostThenSaved();
    render(createElement(WebComponentPreviewForm, {
      componentId: "10000000-0000-4000-8000-000000000001",
      componentVersionId: "10000000-0000-4000-8000-000000000002",
      prompt: "Which checked action should happen?",
      choices: [{ id: "verify-contract", label: "Verify the declared contract." }, { id: "skip", label: "Skip it." }],
    }));
    fireEvent.click(screen.getByLabelText("Verify the declared contract."));
    const submit = () => fireEvent.submit(screen.getByTestId("web-component-preview-form"));
    await expectStableRetryThenRotation(fetchMock, submit);
  });

  it("reuses the exact delivery key without sending client-authored prompt or response", async () => {
    const fetchMock = lostThenSaved();
    render(createElement(LearnerWebComponentAssetForm, {
      taskId: "10000000-0000-4000-8000-000000000001",
      episodeId: "10000000-0000-4000-8000-000000000002",
      activityPlanProposalId: "10000000-0000-4000-8000-000000000003",
      prompt: "Which checked action should happen?",
      choices: [{ id: "verify-contract", label: "Verify the declared contract." }, { id: "skip", label: "Skip it." }],
    }));
    fireEvent.click(screen.getByLabelText("Verify the declared contract."));
    const submit = () => fireEvent.submit(screen.getByTestId("learner-web-component-asset"));
    await expectStableRetryThenRotation(fetchMock, submit);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ selectedChoiceId: "verify-contract" });
    expect(body).not.toHaveProperty("prompt");
    expect(body).not.toHaveProperty("response");
  });

  it("reuses the authorized publication key after a lost response and rotates only after success", async () => {
    const fetchMock = lostThenSaved();
    render(createElement(PublicationReviewForm, {
      threadId: "10000000-0000-4000-8000-000000000001:component_lifecycle:exact",
      expectedVersion: 1,
      approvalAllowed: true,
    }));
    fireEvent.change(screen.getByLabelText("Expert rubric notes"), { target: { value: "Reviewed exact checks and preview." } });
    fireEvent.change(screen.getByLabelText("Immutable decision rationale"), { target: { value: "Authorize this exact course-private version." } });
    const submit = () => fireEvent.submit(screen.getByTestId("publication-review-form"));
    await expectStableRetryThenRotation(fetchMock, submit);
  });

  it("blocks rapid duplicate requests while the shared request is in flight", async () => {
    let finishRequest!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { finishRequest = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(GapSupplyButton, { capabilityResolutionId: "10000000-0000-4000-8000-000000000001" }));
    const button = screen.getByRole("button", { name: "Create bounded Web ComponentAsset proposal" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    finishRequest(okResponse);
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
  });
});
