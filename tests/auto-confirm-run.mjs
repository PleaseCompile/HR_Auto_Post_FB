// Auto-confirm and the no-duplicate rule on the server edition:
//  - auto-confirm survives a pause (no tab left at "awaiting" for good);
//  - tabs are posted one at a time with a gap, never in the same moment;
//  - anything that went wrong is never retried automatically, so a group can
//    never be posted twice (failed, closed tab, dead browser all stay put).
// Runs against a fake Facebook page.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const dataDirectory = path.resolve("test-results", `auto-confirm-${Date.now()}`);
fs.mkdirSync(dataDirectory, { recursive: true });
process.env.HR_AUTO_DATA_DIR = dataDirectory;
process.env.HR_AUTO_PREPARE_DELAY_MS = "0";
process.env.HR_AUTO_FACEBOOK_LOAD_TIMEOUT_MS = "2500";
process.env.HR_AUTO_AUTO_CONFIRM_DELAY_MIN_MS = "1200";
process.env.HR_AUTO_AUTO_CONFIRM_DELAY_MAX_MS = "1500";

const composerPage = `<!doctype html><html lang="en"><body>
  <button id="composer">Write something</button>
  <script>
    document.querySelector("#composer").addEventListener("click", () => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.innerHTML = '<h2>Create post</h2><div role="textbox" contenteditable="true" data-lexical-editor="true" aria-placeholder="Create a public post..."></div><button id="post">Post</button>';
      document.body.append(dialog);
      dialog.querySelector("#post").addEventListener("click", () => {
        const text = dialog.querySelector('[role="textbox"]').textContent;
        dialog.remove();
        const article = document.createElement("article");
        article.setAttribute("role", "article");
        article.textContent = text;
        const link = document.createElement("a");
        link.href = "/groups/mock/posts/123/";
        link.textContent = "Permalink";
        article.append(link);
        document.body.prepend(article);
      });
    });
  </script></body></html>`;
const noComposerPage = `<!doctype html><html lang="en"><body><p>Nothing to post here</p></body></html>`;

const hits = new Map();
const mockServer = http.createServer((request, response) => {
  const key = request.url || "/";
  hits.set(key, (hits.get(key) || 0) + 1);
  // /flaky fails the first time only; a retry would succeed, so a second hit
  // would prove the run retried it.
  const failing = key.startsWith("/flaky") && hits.get(key) === 1;
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(failing ? noComposerPage : composerPage);
});
await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
const { port } = mockServer.address();

const { createDraft, createRun, getRun, upsertGroup } = await import("../dist/db.js");
const { browserSession } = await import("../dist/session.js");
const { runManager } = await import("../dist/run-manager.js");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
browserSession.status = async () => ({
  browserOpen: true,
  authenticated: true,
  url: null,
  accountIdMasked: "****test",
});
browserSession.newPage = async () => context.newPage();

async function waitFor(predicate, message, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out: ${message}`);
}

const draft = createDraft({ workDate: "2026-10-25", slot: "evening", text: "Auto-confirm test post" });
let groupCounter = 0;
function makeRun(paths, { autoConfirm = false, tabLimit = 2 } = {}) {
  const groups = paths.map((pathName) =>
    upsertGroup({
      name: `Group ${pathName} ${++groupCounter}`,
      url: `http://127.0.0.1:${port}/${pathName}-${groupCounter}`,
    }),
  );
  return createRun({
    draftId: draft.id,
    groupIds: groups.map((group) => group.id),
    mode: "assisted",
    workflow: "hybrid-tabs",
    tabLimit,
    autoConfirm,
  });
}
const finished = (runId) =>
  ["completed", "failed", "stopped"].includes(getRun(runId)?.status) && !runManager.isRunActive(runId);
const statuses = (runId) => getRun(runId).targets.map((target) => target.status);
const hitsFor = (fragment) => [...hits.entries()].find(([key]) => key.includes(fragment))?.[1] || 0;

let failures = 0;
async function scenario(name, task) {
  try {
    await task();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ ${name}\n    ${error.message}`);
  }
}

console.log("Auto-confirm and the no-duplicate rule");

await scenario("auto-confirm keeps going after a pause (no tab left stuck)", async () => {
  const run = makeRun(["good", "good", "good"], { autoConfirm: true, tabLimit: 3 });
  runManager.start(run.id);
  // Pause as soon as the first tab is ready, so its auto-post comes due mid-pause.
  await waitFor(() => statuses(run.id).includes("awaiting_confirmation"), "first tab prepared");
  runManager.pause(run.id);
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  assert.ok(!statuses(run.id).includes("published"), "nothing should be posted while paused");
  runManager.resume(run.id);
  await waitFor(() => finished(run.id), "run finished after resume");
  assert.deepEqual(statuses(run.id), ["published", "published", "published"]);
  assert.equal(getRun(run.id).status, "completed");
});

await scenario("tabs that come due together are posted one at a time", async () => {
  const run = makeRun(["good", "good", "good"], { autoConfirm: true, tabLimit: 3 });
  runManager.start(run.id);
  await waitFor(() => finished(run.id), "run finished");
  const times = getRun(run.id)
    .targets.map((target) => Date.parse(target.updatedAt))
    .sort((left, right) => left - right);
  for (let index = 1; index < times.length; index += 1) {
    assert.ok(
      times[index] - times[index - 1] >= 1_000,
      `posts ${index} and ${index + 1} were only ${times[index] - times[index - 1]} ms apart`,
    );
  }
});

await scenario("a group that failed is never retried, the rest still post", async () => {
  const run = makeRun(["flaky", "good"], { autoConfirm: true, tabLimit: 1 });
  const flakyId = run.targets[0].id;
  runManager.start(run.id);
  await waitFor(() => finished(run.id), "run finished");
  const flaky = getRun(run.id).targets.find((target) => target.id === flakyId);
  const good = getRun(run.id).targets.find((target) => target.id !== flakyId);
  assert.equal(flaky.status, "failed");
  assert.equal(good.status, "published");
  assert.equal(hitsFor("flaky-"), 1, "the failed group must be opened exactly once");
});

await scenario("a tab the user closes is left for a manual check", async () => {
  const run = makeRun(["good"], { autoConfirm: false, tabLimit: 1 });
  const [targetId] = run.targets.map((target) => target.id);
  runManager.start(run.id);
  await waitFor(() => getRun(run.id).targets[0].status === "awaiting_confirmation", "target prepared");
  const pages = context.pages();
  await pages[pages.length - 1].close();
  await waitFor(
    () => getRun(run.id).targets.find((target) => target.id === targetId).status === "manual_action_required",
    "closed tab marked for a manual check",
    10_000,
  );
  await waitFor(() => finished(run.id), "run finished");
});

await scenario("tabs lost when the whole browser closes are not retried", async () => {
  const run = makeRun(["good", "good"], { autoConfirm: false, tabLimit: 2 });
  runManager.start(run.id);
  await waitFor(
    () => statuses(run.id).filter((status) => status === "awaiting_confirmation").length === 2,
    "both tabs prepared",
  );
  for (const page of context.pages()) await page.close();
  await waitFor(
    () => statuses(run.id).every((status) => status === "manual_action_required"),
    "both tabs left for a manual check",
    10_000,
  );
  await waitFor(() => finished(run.id), "run finished");
  assert.ok(!statuses(run.id).includes("queued"), "nothing went back to the queue");
});

await context.close();
await browser.close();
mockServer.close();
if (failures) {
  console.log(`\nAuto-confirm test: ${failures} scenario(s) failed`);
  process.exit(1);
}
console.log("Auto-confirm test passed");
process.exit(0);
