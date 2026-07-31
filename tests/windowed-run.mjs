import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const dataDirectory = path.resolve("test-results", `windowed-${Date.now()}`);
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

const {
  createDraft,
  createRun,
  getRun,
  upsertGroup,
} = await import("../dist/db.js");
const { browserSession } = await import("../dist/session.js");
const { runManager } = await import("../dist/run-manager.js");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const windows = [];
const pageWindows = new WeakMap();

browserSession.status = async () => ({
  browserOpen: true,
  authenticated: true,
  url: null,
  accountIdMasked: "****test",
});
browserSession.newWindow = async () => {
  const page = await context.newPage();
  const windowPages = [page];
  windows.push(windowPages);
  pageWindows.set(page, windowPages);
  return page;
};
browserSession.newPageInWindow = async (anchor) => {
  const windowPages = pageWindows.get(anchor);
  if (!windowPages) throw new Error("Window anchor was not tracked");
  const page = await context.newPage();
  windowPages.push(page);
  pageWindows.set(page, windowPages);
  return page;
};

async function waitFor(predicate, message, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

function createGroups(prefix, count) {
  return Array.from({ length: count }, (_, index) =>
    upsertGroup({
      name: `${prefix} ${index + 1}`,
      url: `http://127.0.0.1:${address.port}/${prefix}-${index + 1}`,
    }),
  );
}

try {
  const groups = createGroups("Windowed group", 8);
  const draft = createDraft({
    workDate: "2026-07-31",
    slot: "morning",
    text: "Windowed keep-open state machine test",
  });
  const run = createRun({
    draftId: draft.id,
    groupIds: groups.map((group) => group.id),
    mode: "assisted",
    workflow: "hybrid-windows",
    tabLimit: 3,
  });

  runManager.start(run.id);
  const prepared = await waitFor(() => {
    const current = getRun(run.id);
    return current?.targets?.every(
      (target) => target.status === "awaiting_confirmation",
    )
      ? current
      : null;
  }, "Windowed run did not prepare every selected group");

  const layout = windows.map((windowPages) => windowPages.length);
  if (layout.join(",") !== "3,3,2") {
    throw new Error(`Expected window layout 3,3,2, got ${layout.join(",")}`);
  }

  await runManager.focusTarget(run.id, prepared.targets[0].id);
  for (const [index, target] of prepared.targets.entries()) {
    const action = index % 2 === 0 ? "mark-posted" : "skip";
    await runManager.action(run.id, target.id, action, "windowed test");
  }
  const completed = await waitFor(
    () => (getRun(run.id)?.status === "completed" ? getRun(run.id) : null),
    "Windowed run did not complete after resolving every tab",
  );
  if (context.pages().length !== 8) {
    throw new Error(
      `Windowed workflow closed tabs automatically: ${context.pages().length}/8 remain`,
    );
  }
  if (
    !completed.targets.every(
      (target) => target.evidencePath && fs.existsSync(target.evidencePath),
    )
  ) {
    throw new Error("Every resolved windowed target should have evidence");
  }

  const stopGroups = createGroups("Stopped windowed group", 4);
  const stopDraft = createDraft({
    workDate: "2026-07-31",
    slot: "midday",
    text: "Stopped windowed tabs must remain open",
  });
  const stopRun = createRun({
    draftId: stopDraft.id,
    groupIds: stopGroups.map((group) => group.id),
    mode: "assisted",
    workflow: "hybrid-windows",
    tabLimit: 3,
  });
  runManager.start(stopRun.id);
  await waitFor(
    () =>
      getRun(stopRun.id)?.targets?.every(
        (target) => target.status === "awaiting_confirmation",
      ),
    "Stopped windowed run did not prepare every selected group",
  );
  runManager.stop(stopRun.id);
  const stopped = await waitFor(
    () => (getRun(stopRun.id)?.status === "stopped" ? getRun(stopRun.id) : null),
    "Windowed run did not stop",
  );
  if (
    !stopped.targets.every(
      (target) => target.status === "manual_action_required",
    )
  ) {
    throw new Error("Stopped windowed targets were not marked for manual handling");
  }
  if (context.pages().length !== 12) {
    throw new Error("Stopping a windowed run closed one or more tabs");
  }

  await Promise.all(context.pages().map((page) => page.close()));
  if (context.pages().length !== 0) {
    throw new Error("Manual tab closing did not clean up the test browser");
  }
  console.log("Windowed run layout and keep-open test passed");
} finally {
  await browser.close();
  mockServer.close();
}
