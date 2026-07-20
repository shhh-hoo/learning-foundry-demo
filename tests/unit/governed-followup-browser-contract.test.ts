// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FollowupAttemptForm, GovernedFollowupForm } from "@/components/ClientActions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const okResponse = { ok: true, json: async () => ({ status: "saved" }) } as Response;

describe("CAP-06 browser command contract", () => {
  it("reuses an assignment key after an uncertain failure and rotates it only after confirmed success", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue(okResponse)
      .mockResolvedValue(okResponse);
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(GovernedFollowupForm, {
      observationId: "80000000-0000-4000-8000-000000000001",
      reviewId: "80000000-0000-4000-8000-000000000002",
      transferSource: { context: "source", representation: "TEXT", itemFamily: "chemistry-molar-concentration", problemStructure: "chemistry.molar-concentration.v1" },
    }));
    fireEvent.change(screen.getByLabelText("Learner activity prompt"), { target: { value: "Retry this exact reviewed issue." } });
    const form = screen.getByTestId("governed-followup-form");

    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText("response lost")).toBeTruthy());
    const firstKey = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).assignmentIdempotencyKey;

    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
    const retryKey = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).assignmentIdempotencyKey;
    expect(retryKey).toBe(firstKey);

    fireEvent.submit(form);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const nextKey = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).assignmentIdempotencyKey;
    expect(nextKey).not.toBe(firstKey);
  });

  it("blocks a rapid duplicate while the actual request is in flight", async () => {
    let finishRequest!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { finishRequest = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(GovernedFollowupForm, {
      observationId: "80000000-0000-4000-8000-000000000001",
      reviewId: "80000000-0000-4000-8000-000000000002",
      transferSource: { context: "source", representation: "TEXT", itemFamily: "chemistry-molar-concentration", problemStructure: "chemistry.molar-concentration.v1" },
    }));
    fireEvent.change(screen.getByLabelText("Learner activity prompt"), { target: { value: "Retry this exact reviewed issue." } });
    const form = screen.getByTestId("governed-followup-form");
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Assign governed RETRY" }) as HTMLButtonElement).disabled).toBe(true);
    finishRequest(okResponse);
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
  });

  it("fails closed when the exact planned CapabilityVersion is unavailable", () => {
    render(createElement(FollowupAttemptForm, {
      threadId: "institution:governed_followup:thread",
      expectedVersion: 1,
      prompt: "Complete the planned activity.",
      contract: { activityType: "RETRY" },
      capabilities: [],
      unavailableReason: "The exact planned CapabilityVersion version-old is no longer active; current version version-new is not substituted.",
    }));
    expect(screen.getByText(/version-old is no longer active/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit RETRY Attempt" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
