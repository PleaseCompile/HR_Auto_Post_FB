import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const dataDirectory = path.resolve("test-results", `hybrid-${Date.now()}`);
fs.mkdirSync(dataDirectory, { recursive: true });
process.env.HR_AUTO_DATA_DIR = dataDirectory;

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

  const unlimitedDraft = createDraft({
    workDate: "2026-07-23",
    slot: "midday",
    text: "Unlimited hybrid state machine test",
  });
  const unlimitedRun = createRun({
    draftId: unlimitedDraft.id,
    groupIds: groups.map((group) => group.id),
    mode: "assisted",
    workflow: "hybrid-tabs",
    tabLimit: 0,
  });
  runManager.start(unlimitedRun.id);
  const allPrepared = await waitFor(() => {
    const current = getRun(unlimitedRun.id);
    const awaiting = current?.targets?.filter(
      (target) => target.status === "awaiting_confirmation",
    );
    return awaiting?.length === groups.length ? current : null;
  }, "Unlimited Hybrid did not prepare every selected group");

  if (context.pages().length !== groups.length) {
    throw new Error(
      `Unlimited Hybrid expected ${groups.length} tabs, got ${context.pages().length}`,
    );
  }
  for (const target of allPrepared.targets) {
    await runManager.action(unlimitedRun.id, target.id, "skip", "unlimited test");
  }
  await waitFor(
    () => getRun(unlimitedRun.id)?.status === "completed",
    "Unlimited Hybrid did not complete after resolving every tab",
  );
  if (context.pages().length !== 0) {
    throw new Error("Unlimited Hybrid tabs should close after being resolved");
  }
  console.log("Hybrid run state-machine test passed");
} finally {
  await browser.close();
  mockServer.close();
}
