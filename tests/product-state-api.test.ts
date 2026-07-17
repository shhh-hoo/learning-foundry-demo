import { describe, expect, it } from "vitest";
import { ProductStateApi } from "../src/product-state/product-state-api";
import { ProductStateService } from "../src/product-state/product-state-service";
import { TestProductStateRepository } from "./support/product-state-repository";

const learnerHeaders = {
  "x-foundry-actor-id": "learner-api",
  "x-foundry-actor-role": "LEARNER",
};

describe("canonical Product State API entrypoint", () => {
  it("wires a real task/episode/event path and enforces learner ownership", async () => {
    const repository = new TestProductStateRepository();
    const api = new ProductStateApi(
      new ProductStateService(repository, { now: () => "2026-07-18T13:00:00.000Z" }),
      repository,
    );
    expect(await api.handle({
      method: "POST",
      path: "/v1/product-state/tasks",
      headers: learnerHeaders,
      body: { taskId: "task-api", goal: "API-backed learning task", materialRefs: [] },
    })).toMatchObject({ status: 201, body: { ok: true, task: { id: "task-api", learnerId: "learner-api" } } });
    expect((await api.handle({
      method: "POST",
      path: "/v1/product-state/episodes",
      headers: learnerHeaders,
      body: { episodeId: "episode-api", taskId: "task-api" },
    })).status).toBe(201);
    expect((await api.handle({
      method: "POST",
      path: "/v1/product-state/conversation-events",
      headers: learnerHeaders,
      body: {
        eventId: "event-api",
        taskId: "task-api",
        episodeId: "episode-api",
        kind: "LEARNER_MESSAGE",
        payload: { content: "Persist this raw interaction." },
      },
    })).status).toBe(201);
    expect((await api.handle({
      method: "GET",
      path: "/v1/product-state/tasks/task-api",
      headers: learnerHeaders,
    })).body).toMatchObject({ learningLoop: { conversationEvents: [{ payload: { content: "Persist this raw interaction." } }] } });
    expect(await api.handle({
      method: "GET",
      path: "/v1/product-state/tasks/task-api",
      headers: { "x-foundry-actor-id": "another-learner", "x-foundry-actor-role": "LEARNER" },
    })).toMatchObject({ status: 403, body: { error: { code: "TASK_ACCESS_DENIED" } } });
  });
});
