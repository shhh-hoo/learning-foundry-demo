import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("four product surfaces", () => {
  it.each(["learner", "teacher", "foundry", "engineering"])("exports an authenticated Server Component page for /%s", async (surface) => {
    const page = await readFile(new URL(`../../app/${surface}/page.tsx`, import.meta.url), "utf8");
    expect(page).toMatch(/export default async function/);
    expect(page).toMatch(/requireWorkspaceActor\(/);
    expect(page).toMatch(/get(?:Learner|Teacher|Foundry|Engineering)Workspace/);
  });

  it("redirects wrong-role workspace navigation to a data-free denied surface", async () => {
    const identity = await readFile(new URL("../../application/identity.ts", import.meta.url), "utf8");
    const denied = await readFile(new URL("../../app/denied/page.tsx", import.meta.url), "utf8");
    expect(identity).toContain("redirect(`/denied?workspace=");
    expect(denied).toContain("Access denied");
    expect(denied).toContain("No workspace query was executed");
    expect(denied).not.toMatch(/get(?:Learner|Teacher|Foundry|Engineering)Workspace/);
  });

  it("has no free-standing Outcome escape hatch", async () => {
    await expect(access(new URL("../../app/api/outcomes/route.ts", import.meta.url))).rejects.toBeTruthy();
  });
});
