// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeacherAssignmentForm, TeacherInterventionForm } from "@/components/ClientActions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const okResponse = { ok: true, json: async () => ({ status: "saved" }) } as Response;

describe("CAP-05 teacher command forms", () => {
  it("blocks an immediate duplicate Assignment submit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse);
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(TeacherAssignmentForm, {
      courses: [{ id: "course-1", code: "CHEM", name: "Chemistry" }],
      learners: [{ id: "learner-1", courseId: "course-1", name: "Learner" }],
      capabilities: [],
    }));

    fireEvent.change(screen.getByLabelText("Learner"), { target: { value: "learner-1" } });
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Concentration practice" } });
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Solve concentration problems" } });
    fireEvent.change(screen.getByLabelText("Teacher instructions"), { target: { value: "Show each unit conversion" } });
    fireEvent.change(screen.getByLabelText("Completion rule"), { target: { value: "Submit one complete solution" } });
    const form = screen.getByTestId("teacher-assignment-form");
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
  });

  it("reuses an Intervention key after an uncertain failure and rotates it only after success", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network response lost"))
      .mockResolvedValue(okResponse)
      .mockResolvedValue(okResponse);
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(TeacherInterventionForm, {
      runtimeDeliveryId: "delivery-1",
      capabilities: [{ id: "capability-1", courseId: "course-1", key: "molar-concentration", name: "Molar concentration" }],
    }));

    fireEvent.change(screen.getByLabelText("Capability"), { target: { value: "capability-1" } });
    fireEvent.change(screen.getByLabelText("Human reason"), { target: { value: "Require a more explicit scaffold" } });
    const form = screen.getByTestId("teacher-intervention-form");
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText("network response lost")).toBeTruthy());
    const firstKey = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).idempotencyKey;

    fireEvent.submit(form);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const retryKey = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).idempotencyKey;
    expect(retryKey).toBe(firstKey);

    fireEvent.submit(form);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const nextCommandKey = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).idempotencyKey;
    expect(nextCommandKey).not.toBe(firstKey);
  });
});
