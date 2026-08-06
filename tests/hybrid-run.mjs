import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const dataDirectory = path.resolve("test-results", `hybrid-${Date.now()}`);
fs.mkdirSync(dataDirectory, { recursive: true });
process.env.HR_AUTO_DATA_DIR = dataDirectory;
process.env.HR_AUTO_PREPARE_DELAY_MS = "0";

const mockServer = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
    <html lang="en">
      <body>
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
        </script>
      </body>
    </html>`);
});

await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
const address = mockServer.address();
if (!address || typeof address === "string") throw new Error("Mock server did not start");

const { createDraft, createRun, getRun, upsertGroup } = await import("../dist/db.js");
const { browserSession } = await import("../dist/session.js");
const { runManager } = await import("../dist/run-manager.js");

const draft = createDraft({
  workDate: "2026-07-23",
  slot: "morning",
  text: "Hybrid state machine test",
});
const groups = [1, 2, 3].map((index) =>
  upsertGroup({
    name: `Hybrid group ${index}`,
    url: `http://127.0.0.1:${address.port}/group-${index}`,
  }),
);
const run = createRun({
  draftId: draft.id,
  groupIds: groups.map((group) => group.id),
  mode: "assisted",
  workflow: "hybrid-tabs",
  tabLimit: 2,
});

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
browserSession.status = async () => ({
  browserOpen: true,
  authenticated: true,
  url: null,
  accountIdMasked: "****test",
});
browserSession.newPage = async () => context.newPage();

async function waitFor(predicate, message, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

try {
  runManager.start(run.id);
  const firstWindow = await waitFor(() => {
    const current = getRun(run.id);
    const awaiting = current?.targets?.filter(
      (target) => target.status === "awaiting_confirmation",
    );
    const queued = current?.targets?.filter((target) => target.status === "queued");
    return awaiting?.length === 2 && queued?.length === 1 ? current : null;
  }, "Hybrid run did not stop at its two-tab limit");

  if (context.pages().length !== 2) {
    throw new Error(`Expected exactly 2 prepared tabs, got ${context.pages().length}`);
  }

  const blockedDraft = createDraft({
    workDate: "2026-07-23",
    slot: "evening",
    text: "Concurrent run guard test",
  });
  const blockedRun = createRun({
    draftId: blockedDraft.id,
    groupIds: [groups[0].id],
    mode: "assisted",
    workflow: "hybrid-tabs",
    tabLimit: 1,
  });
  let concurrentRunWasBlocked = false;
  try {
    runManager.start(blockedRun.id);
  } catch (error) {
    concurrentRunWasBlocked = String(error).includes("มีคิวอื่นกำลังควบคุม");
  }
  if (!concurrentRunWasBlocked) {
    throw new Error("A second queue was allowed to control the same browser session");
  }

  const [first, second] = firstWindow.targets;
  await runManager.focusTarget(run.id, first.id);
  await runManager.action(run.id, first.id, "skip", "กลุ่มไม่ตรงพื้นที่");

  const refilled = await waitFor(() => {
    const current = getRun(run.id);
    const awaiting = current?.targets?.filter(
      (target) => target.status === "awaiting_confirmation",
    );
    return current?.targets?.[0].status === "skipped" && awaiting?.length === 2
      ? current
      : null;
  }, "Hybrid run did not refill the free tab");

  const third = refilled.targets[2];
  await runManager.action(run.id, second.id, "mark-posted");
  await runManager.action(run.id, third.id, "confirm");

  const finished = await waitFor(() => {
    const current = getRun(run.id);
    return current?.status === "completed" ? current : null;
  }, "Hybrid run did not complete after resolving all tabs");

  const statuses = finished.targets.map((target) => target.status);
  if (statuses.join(",") !== "skipped,published,published") {
    throw new Error(`Unexpected hybrid target statuses: ${statuses.join(",")}`);
  }
  if (
    !finished.targets.every(
      (target) => target.evidencePath && fs.existsSync(target.evidencePath),
    )
  ) {
    throw new Error("Every resolved hybrid target should have evidence");
  }
  if (!finished.targets[0].message.includes("กลุ่มไม่ตรงพื้นที่")) {
    throw new Error("Skip reason was not preserved");
  }
  if (context.pages().length !== 0) {
    throw new Error("Resolved hybrid tabs should be closed");
  }

  const safeDraft = createDraft({
    workDate: "2026-07-23",
    slot: "midday",
    text: "Safe sliding-window Hybrid state machine test",
  });
  const slidingGroups = Array.from({ length: 12 }, (_, index) =>
    upsertGroup({
      name: `Sliding Hybrid group ${index + 1}`,
      url: `http://127.0.0.1:${address.port}/sliding-group-${index + 1}`,
    }),
  );
  const safeRun = createRun({
    draftId: safeDraft.id,
    groupIds: slidingGroups.map((group) => group.id),
    mode: "assisted",
    workflow: "hybrid-tabs",
    tabLimit: 0,
  });
  if (safeRun.tabLimit !== 10) {
    throw new Error(`Hybrid tab limit 0 should normalize to 10, got ${safeRun.tabLimit}`);
  }
  runManager.start(safeRun.id);
  const firstSafeWindow = await waitFor(() => {
    const current = getRun(safeRun.id);
    const awaiting = current?.targets?.filter(
      (target) => target.status === "awaiting_confirmation",
    );
    const queued = current?.targets?.filter((target) => target.status === "queued");
    return awaiting?.length === 10 && queued?.length === 2 ? current : null;
  }, "Safe Hybrid did not stop at its ten-tab sliding window", 45_000);

  if (context.pages().length !== 10) {
    throw new Error(
      `Safe Hybrid expected 10 tabs, got ${context.pages().length}`,
    );
  }
  await runManager.action(
    safeRun.id,
    firstSafeWindow.targets[0].id,
    "skip",
    "sliding refill test",
  );
  const refilledSafeWindow = await waitFor(() => {
    const current = getRun(safeRun.id);
    const awaiting = current?.targets?.filter(
      (target) => target.status === "awaiting_confirmation",
    );
    const queued = current?.targets?.filter((target) => target.status === "queued");
    return awaiting?.length === 10 && queued?.length === 1 ? current : null;
  }, "Safe Hybrid did not refill the released tab");
  for (const target of refilledSafeWindow.targets.filter(
    (target) => target.status === "awaiting_confirmation",
  )) {
    await runManager.action(safeRun.id, target.id, "skip", "safe sliding test");
  }
  const finalPrepared = await waitFor(() => {
    const current = getRun(safeRun.id);
    return current?.targets?.find(
      (target) => target.status === "awaiting_confirmation",
    );
  }, "Safe Hybrid did not prepare its final queued group");
  await runManager.action(safeRun.id, finalPrepared.id, "skip", "safe final test");
  await waitFor(
    () => getRun(safeRun.id)?.status === "completed",
    "Safe Hybrid did not complete after resolving every tab",
  );
  if (context.pages().length !== 0) {
    throw new Error("Safe Hybrid tabs should close after being resolved");
  }

  const bulkDraft = createDraft({
    workDate: "2026-07-23",
    slot: "evening",
    text: "Bulk manually posted test",
  });
  const bulkRun = createRun({
    draftId: bulkDraft.id,
    groupIds: groups.slice(0, 2).map((group) => group.id),
    mode: "assisted",
    workflow: "hybrid-tabs",
    tabLimit: 2,
  });
  runManager.start(bulkRun.id);
  const bulkPrepared = await waitFor(() => {
    const current = getRun(bulkRun.id);
    return current?.targets?.every(
      (target) => target.status === "awaiting_confirmation",
    )
      ? current
      : null;
  }, "Bulk test targets were not prepared");
  const bulkResult = await runManager.markPostedBulk(
    bulkRun.id,
    bulkPrepared.targets.map((target) => target.id),
  );
  if (
    bulkResult.succeeded !== 2 ||
    bulkResult.failed !== 0 ||
    bulkResult.results.some((result) => !result.ok)
  ) {
    throw new Error(`Bulk manually posted result was incorrect: ${JSON.stringify(bulkResult)}`);
  }
  const bulkFinished = await waitFor(
    () => getRun(bulkRun.id)?.status === "completed" && getRun(bulkRun.id),
    "Bulk manually posted run did not complete",
  );
  if (
    bulkFinished.targets.some(
      (target) =>
        target.status !== "published" ||
        !target.evidencePath ||
        !fs.existsSync(target.evidencePath),
    )
  ) {
    throw new Error("Bulk manually posted targets did not retain published evidence");
  }
  if (context.pages().length !== 0) {
    throw new Error("Bulk manually posted tabs should close after capture");
  }
  console.log("Hybrid run state-machine test passed");
} finally {
  await browser.close();
  mockServer.close();
}
