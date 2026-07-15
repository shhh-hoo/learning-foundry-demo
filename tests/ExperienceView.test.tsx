import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

describe("real Agent product boundaries", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/?view=learner");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).endsWith("/health")) return Response.json({ configured: false, provider: "deepseek", model: null, thinkingMode: "disabled" });
      if (init?.method === "POST") return Response.json({ ok: false, error: { code: "AGENT_NOT_CONFIGURED", message: "Set DEEPSEEK_API_KEY and DEEPSEEK_MODEL on the server." } }, { status: 503 });
      return Response.json({}, { status: 404 });
    }));
  });
  afterEach(() => { window.history.replaceState({}, "", "/"); vi.unstubAllGlobals(); });

  it("shows a configuration error and creates no fake answer or product record", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Agent not configured")).toBeVisible());
    fireEvent.change(screen.getByLabelText("Message Learning Foundry"), { target: { value: "Explain coefficients" } });
    fireEvent.click(screen.getByRole("button", { name: "Run Agent" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("DEEPSEEK_API_KEY"));
    expect(screen.getByText(/No Agent runs yet/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(screen.getByText(/Nothing saved/)).toBeVisible();
  });

  it("uses a preset only to fill input and labels its origin", () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("Fill input from preset"), { target: { value: "diagnosis" } });
    expect((screen.getByLabelText("Message Learning Foundry") as HTMLTextAreaElement).value).toContain("4.80 / 24.0");
    expect(screen.getByText("Input origin: PRESET_INPUT")).toBeVisible();
    expect(screen.getByText(/No Agent runs yet/)).toBeVisible();
  });

  it("starts Pattern Inbox empty and cannot create a candidate", () => {
    window.history.replaceState({}, "", "/?view=studio");
    render(<App />);
    expect(screen.getByText((_, element) => element?.classList.contains("empty-state") === true && element.textContent?.includes("No learning patterns yet.") === true)).toBeVisible();
    expect(screen.getByText((_, element) => element?.classList.contains("empty-state") === true && element.textContent?.includes("Patterns appear only after actual Agent runs") === true)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create component candidate" })).not.toBeInTheDocument();
  });
});
