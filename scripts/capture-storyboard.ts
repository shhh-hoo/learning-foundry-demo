import { chromium, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "demo-storyboard");
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath(), args: ["--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on("console", (message) => { if (message.type() === "error") console.error(`Browser console: ${message.text()}`); });

async function shot(name: string): Promise<void> {
  await page.waitForTimeout(350);
  await page.locator(".demo-shell").screenshot({ path: resolve(output, name), animations: "disabled", caret: "hide" });
  console.log(`Captured ${name}`);
}

async function liveFrame(current: Page) {
  const handle = await current.waitForSelector('iframe[title="Live product surface"]');
  const frame = await handle.contentFrame();
  if (!frame) throw new Error("Live product frame is unavailable.");
  return frame;
}

try {
  await page.goto("http://127.0.0.1:4173/?view=demo", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    localStorage.clear();
    await fetch("http://127.0.0.1:4175/session", { method: "DELETE" });
  });
  await page.reload({ waitUntil: "networkidle" });

  let frame = await liveFrame(page);
  await frame.getByRole("button", { name: "Check my working" }).waitFor();
  await shot("01-learner-question.png");

  await frame.getByRole("button", { name: "Check my working" }).click();
  await page.getByText("What happened", { exact: true }).waitFor();
  await frame.getByRole("button", { name: "Library" }).click();
  await frame.getByRole("heading", { name: "Your learning memory." }).waitFor();
  await shot("02-diagnosis-and-learning-memory.png");

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  frame = await liveFrame(page);
  await frame.getByText("3 / 3").waitFor();
  await shot("03-teacher-pattern-inbox.png");

  await page.getByRole("button", { name: "Next" }).click();
  frame = await liveFrame(page);
  await frame.getByRole("button", { name: "Pattern Inbox" }).click();
  await frame.getByRole("button", { name: "Create component candidate" }).click();
  await frame.getByRole("button", { name: "Continue to evaluation" }).click();
  await frame.getByRole("button", { name: "Run 15 checks" }).click();
  await frame.getByRole("button", { name: "Expert Review" }).click();
  await frame.getByRole("button", { name: "Approve component" }).click();
  await frame.getByRole("button", { name: "Foundry Evaluation" }).click();
  await page.getByText("Expert authority recorded", { exact: true }).waitFor();
  await frame.evaluate(() => window.scrollTo(0, 0));
  await shot("04-candidate-and-governance.png");

  await page.getByRole("button", { name: "Next" }).click();
  frame = await liveFrame(page);
  await frame.getByRole("button", { name: "Publish 1.1.0" }).click();
  await page.getByText("Registry accepted", { exact: true }).waitFor();
  await frame.getByText("Available to connected runtimes").waitFor();
  await shot("05-published-to-local-registry.png");

  await page.getByRole("button", { name: "Next" }).click();
  frame = await liveFrame(page);
  await frame.getByRole("button", { name: /Stoichiometric product mass.*v1\.1\.0/ }).waitFor();
  await frame.getByLabel("Mg:MgO mole ratio").fill("0.5");
  await frame.getByRole("button", { name: "Diagnose learner evidence" }).click();
  await frame.getByText("2Mg : 2MgO simplifies to 1:1. Each mole of Mg forms one mole of MgO.").waitFor();
  await page.getByText("Improved support delivered", { exact: true }).waitFor();
  await shot("06-new-learner-improved-support.png");

  await page.getByRole("button", { name: "Free Explore" }).click();
  await page.getByLabel("Product surface").selectOption("?view=inspector&embedded=1");
  frame = await liveFrame(page);
  await frame.getByRole("heading", { name: "Engineering Inspector" }).waitFor();
  await frame.getByText("RUNTIME_DIAGNOSIS_COMPLETED").waitFor();
  await shot("07-engineering-inspector.png");
} finally {
  await browser.close();
}

console.log(`Captured seven Demo Shell story frames in ${output}`);
