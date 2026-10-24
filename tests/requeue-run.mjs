// Stuck-queue behaviour: auto-confirm survives pauses, targets that fail before
// Post is pressed are retried at the back of the queue, and the user can move a
// prepared target to the back. Runs against a fake Facebook page.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const dataDirectory = path.resolve("test-results", `requeue-${Date.now()}`);
fs.mkdirSync(dataDirectory, { recursive: true });
process.env.HR_AUTO_DATA_DIR = dataDirectory;
process.env.HR_AUTO_PREPARE_DELAY_MS = "0";
process.env.HR_AUTO_FACEBOOK_LOAD_TIMEOUT_MS = "2500";
process.env.HR_AUTO_AUTO_CONFIRM_DELAY_MIN_MS = "1200";
process.env.HR_AUTO_AUTO_CONFIRM_DELAY_MAX_MS = "1500";
process.env.HR_AUTO_MAX_AUTO_REQUEUES = "1";

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
  // /flaky fails the first time only; /broken always fails.
  const failing =
    key.startsWith("/broken") || (key.startsWith("/flaky") && hits.get(key) === 1);
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
// Lets a scenario pretend the whole browser died (crash or killed for memory).
let browserAlive = true;
browserSession.isOpen = () => browserAlive;

async function waitFor(predicate, message, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out: ${message}`);
}

const draft = createDraft({ workDate: "2026-10-25", slot: "evening", text: "Requeue test post" });
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

console.log("Requeue and auto-confirm");

await scenario("auto-confirm keeps going after a pause (no tab left stuck)", async () => {
  const run = makeRun(["good", "good", "good"], { autoConfirm: true, tabLimit: 3 });
  runManager.start(run.id);
  // Pause as soon as the first tab is ready, so its auto-post comes due mid-pause.
  await waitFor(
    () => statuses(run.id).includes("awaiting_confirmation"),
    "first tab prepared",
    60_000,
  );
  runManager.pause(run.id);
  // Old code: timers firing during this pause gave up for good.
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  assert.ok(
    !statuses(run.id).includes("published"),
    "nothing should be posted while paused",
  );
  runManager.resume(run.id);
  await waitFor(() => finished(run.id), "run finished after resume");
  assert.deepEqual(statuses(run.id), ["published", "published", "published"]);
  assert.equal(getRun(run.id).status, "completed");
});

await scenario("a group that fails before Post is retried at the back and succeeds", async () => {
  const run = makeRun(["flaky", "good", "good"], { autoConfirm: true, tabLimit: 1 });
  const flakyId = run.targets[0].id;
  runManager.start(run.id);
  await waitFor(() => finished(run.id), "run finished");
  const targets = getRun(run.id).targets;
  assert.equal(targets.at(-1).id, flakyId, "flaky target should now be last in the queue");
  assert.deepEqual(targets.map((target) => target.status), ["published", "published", "published"]);
  assert.equal(getRun(run.id).status, "completed");
});

await scenario("a permanently broken group is retried once, then marked failed", async () => {
  const run = makeRun(["broken", "good"], { autoConfirm: true, tabLimit: 1 });
  const brokenId = run.targets[0].id;
  runManager.start(run.id);
  await waitFor(() => finished(run.id), "run finished");
  const broken = getRun(run.id).targets.find((target) => target.id === brokenId);
  const good = getRun(run.id).targets.find((target) => target.id !== brokenId);
  assert.equal(broken.status, "failed");
  assert.equal(good.status, "published");
  const brokenHits = [...hits.entries()].find(([key]) => key.includes(`broken-`))?.[1];
  assert.equal(brokenHits, 2, "broken group should be opened exactly twice (1 retry)");
});

await scenario("user can move a prepared tab to the back of the queue", async () => {
  const run = makeRun(["good", "good"], { autoConfirm: false, tabLimit: 1 });
  const [firstId, secondId] = run.targets.map((target) => target.id);
  runManager.start(run.id);
  await waitFor(
    () => getRun(run.id).targets.find((target) => target.id === firstId).status === "awaiting_confirmation",
    "first target prepared",
  );
  await runManager.requeue(run.id, firstId);
  assert.equal(
    getRun(run.id).targets.find((target) => target.id === firstId).status,
    "queued",
  );
  // The second group gets the free slot next.
  await waitFor(
    () => getRun(run.id).targets.find((target) => target.id === secondId).status === "awaiting_confirmation",
    "second target prepared",
  );
  await runManager.action(run.id, secondId, "confirm");
  // Then the moved group comes back, last.
  await waitFor(
    () => getRun(run.id).targets.find((target) => target.id === firstId).status === "awaiting_confirmation",
    "moved target prepared again",
  );
  await runManager.action(run.id, firstId, "confirm");
  await waitFor(() => finished(run.id), "run finished");
  const targets = getRun(run.id).targets;
  assert.deepEqual(targets.map((target) => target.id), [secondId, firstId]);
  assert.deepEqual(targets.map((target) => target.status), ["published", "published"]);
});

await scenario("requeue refuses a target that was already posted", async () => {
  const run = makeRun(["good", "good"], { autoConfirm: false, tabLimit: 1 });
  const [firstId] = run.targets.map((target) => target.id);
  runManager.start(run.id);
  await waitFor(
    () => getRun(run.id).targets.find((target) => target.id === firstId).status === "awaiting_confirmation",
    "first target prepared",
  );
  await runManager.action(run.id, firstId, "confirm");
  await assert.rejects(() => runManager.requeue(run.id, firstId), /ย้ายไปท้ายคิวได้เฉพาะ/);
  runManager.stop(run.id);
  await waitFor(() => finished(run.id), "run stopped");
});

await scenario("a tab the user closes is left for a manual check, not retried", async () => {
  const run = makeRun(["good"], { autoConfirm: false, tabLimit: 1 });
  const [targetId] = run.targets.map((target) => target.id);
  runManager.start(run.id);
  await waitFor(
    () => getRun(run.id).targets[0].status === "awaiting_confirmation",
    "target prepared",
  );
  const pages = context.pages();
  await pages[pages.length - 1].close();
  await waitFor(
    () => getRun(run.id).targets.find((target) => target.id === targetId).status === "manual_action_required",
    "closed tab marked for a manual check",
    10_000,
  );
  await waitFor(() => finished(run.id), "run finished");
});

await scenario("tabs lost because the whole browser died are retried and posted", async () => {
  const run = makeRun(["good", "good"], { autoConfirm: false, tabLimit: 2 });
  runManager.start(run.id);
  await waitFor(
    () => statuses(run.id).filter((status) => status === "awaiting_confirmation").length === 2,
    "both tabs prepared",
  );
  browserAlive = false;
  for (const page of context.pages()) await page.close();
  await waitFor(
    () => statuses(run.id).every((status) => status === "queued" || status === "awaiting_confirmation" || status === "opening" || status === "preparing") &&
      getRun(run.id).targets.some((target) => /BROWSER_CLOSED/.test(target.message)),
    "lost tabs moved back to the queue",
    10_000,
  );
  browserAlive = true; // the browser "relaunches" on the next tab
  for (let index = 0; index < 2; index += 1) {
    const prepared = await waitFor(
      () => getRun(run.id).targets.find((target) => target.status === "awaiting_confirmation"),
      "retried tab prepared again",
    );
    await runManager.action(run.id, prepared.id, "confirm");
  }
  await waitFor(() => finished(run.id), "run finished");
  assert.deepEqual(statuses(run.id), ["published", "published"]);
});

await context.close();
await browser.close();
mockServer.close();
if (failures) {
  console.log(`\nRequeue test: ${failures} scenario(s) failed`);
  process.exit(1);
}
console.log("Requeue test passed");
process.exit(0);
