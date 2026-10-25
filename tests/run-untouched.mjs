import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

// Only a group nobody has touched may be posted again; everything else could already
// be on Facebook. This covers resume, new runs for the same draft, and a Post click
// that times out.
const dataDirectory = path.resolve("test-results", `untouched-${Date.now()}`);
fs.mkdirSync(dataDirectory, { recursive: true });
process.env.HR_AUTO_DATA_DIR = dataDirectory;
process.env.HR_AUTO_PREPARE_DELAY_MS = "0";
process.env.HR_AUTO_AUTO_CONFIRM_DELAY_MIN_MS = "300";
process.env.HR_AUTO_AUTO_CONFIRM_DELAY_MAX_MS = "400";

const mockServer = http.createServer((request, response) => {
  // "/covered-*" lays an overlay over the Post button once the composer is ready, the
  // same "subtree intercepts pointer events" failure seen on the live page.
  const covered = (request.url || "").startsWith("/covered");
  // "/suggest-*" mimics Facebook's hashtag suggestions: a listbox over the Post button
  // that closes as soon as the editor loses focus.
  const suggest = (request.url || "").startsWith("/suggest");
  // "/nolink-*" publishes like the live feed often does: the new post, stamped
  // "Just now", with no /posts/ link anywhere.
  const noLink = (request.url || "").startsWith("/nolink");
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
              const typed = dialog.querySelector('[role="textbox"]').textContent;
              dialog.remove();
              ${
                noLink
                  ? `const article = document.createElement("div");
                     article.setAttribute("role", "article");
                     article.innerText = "Test Author · AI content · Just now · " + typed;
                     document.body.prepend(article);`
                  : `const link = document.createElement("a");
                     link.href = "/groups/mock/posts/123/";
                     link.textContent = "Permalink";
                     document.body.prepend(link);`
              }
            });
            ${
              suggest
                ? `const editor = dialog.querySelector('[role="textbox"]');
                   editor.addEventListener("input", () => {
                     if (document.querySelector('[role="listbox"]')) return;
                     const list = document.createElement("div");
                     list.setAttribute("role", "listbox");
                     list.style.cssText = "position:fixed;left:0;right:0;top:200px;bottom:0;z-index:9999;background:#fff";
                     list.innerHTML = '<div role="option">#hashtag</div>';
                     document.body.append(list);
                     editor.addEventListener("blur", () => list.remove(), { once: true });
                   });`
                : ""
            }
            ${
              covered
                ? `let covered = false;
                   dialog.querySelector('[role="textbox"]').addEventListener("input", () => {
                     if (covered) return;
                     covered = true;
                     const cover = document.createElement("div");
                     cover.style.cssText = "position:fixed;inset:0;z-index:9999";
                     document.body.append(cover);
                   });`
                : ""
            }
          });
        </script>
      </body>
    </html>`);
});
await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
const address = mockServer.address();
if (!address || typeof address === "string") throw new Error("Mock server did not start");

const { createDraft, createRun, getRun, updateRunStatus, updateTarget, upsertGroup } =
  await import("../dist/db.js");
const { browserSession } = await import("../dist/session.js");
const { runManager } = await import("../dist/run-manager.js");

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
    return;
  }
  failures += 1;
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitFor(predicate, message, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
browserSession.status = async () => ({
  browserOpen: true,
  authenticated: true,
  url: null,
  accountIdMasked: "****test",
});
browserSession.newPage = async () => context.newPage();

try {
  const draft = createDraft({ workDate: "2026-10-25", slot: "morning", text: "White-only test" });
  const groups = Array.from({ length: 6 }, (_, index) =>
    upsertGroup({
      name: `Untouched group ${index}`,
      url: `http://127.0.0.1:${address.port}/group-${index}`,
    }),
  );
  const run = createRun({
    draftId: draft.id,
    groupIds: groups.slice(0, 5).map((group) => group.id),
    mode: "assisted",
    workflow: "hybrid-tabs",
    tabLimit: 5,
  });
  const [published, failed, uncertain, skipped, untouched] = run.targets;
  updateTarget(published.id, "published", { message: "posted" });
  updateTarget(failed.id, "failed", { message: "[FACEBOOK_TIMEOUT] click timed out" });
  updateTarget(uncertain.id, "manual_action_required", { message: "[TAB_CLOSED]" });
  updateTarget(skipped.id, "skipped", { message: "skipped" });
  updateRunStatus(run.id, "failed", { finish: true });

  console.log("Resume");
  runManager.start(run.id);
  await waitFor(
    () => getRun(run.id)?.targets?.find((target) => target.id === untouched.id)?.status ===
      "awaiting_confirmation",
    "The untouched group was never prepared",
  );
  // Give the loop time to (wrongly) pick anything else up.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const resumed = getRun(run.id);
  check("a failed run can be resumed", true);
  check("only the untouched group got a tab", context.pages().length === 1, `${context.pages().length} tabs`);
  check(
    "touched groups keep their status",
    resumed.targets.slice(0, 4).map((target) => target.status).join(",") ===
      "published,failed,manual_action_required,skipped",
    resumed.targets.map((target) => target.status).join(","),
  );
  runManager.stop(run.id);
  await waitFor(() => !runManager.isBusy(), "Run did not stop");

  let refused = "";
  try {
    runManager.start(run.id);
  } catch (error) {
    refused = String(error);
  }
  check("a run with nothing untouched refuses to start", refused.includes("ไม่มีรายการที่ยังไม่เคยทำ"), refused);

  console.log("New run for the same draft");
  const second = createRun({
    draftId: draft.id,
    groupIds: groups.map((group) => group.id),
    mode: "assisted",
    workflow: "hybrid-tabs",
    tabLimit: 5,
  });
  const secondGroups = second.targets.map((target) => target.groupId).sort();
  check(
    "touched groups are cut, skipped and new ones stay",
    JSON.stringify(secondGroups) === JSON.stringify([groups[3].id, groups[5].id].sort()),
    second.targets.map((target) => target.group?.name).join(", "),
  );
  check("the cut groups are reported", second.excludedTouchedGroups.length === 4, String(second.excludedTouchedGroups));
  let allTouched = "";
  try {
    createRun({
      draftId: draft.id,
      groupIds: [groups[0].id, groups[1].id],
      mode: "assisted",
      workflow: "hybrid-tabs",
      tabLimit: 5,
    });
  } catch (error) {
    allTouched = String(error);
  }
  check("a run of only touched groups is refused", allTouched.includes("ไม่โพสต์ซ้ำ"), allTouched);
  const dryDraft = createDraft({ workDate: "2026-10-25", slot: "evening", text: "dry" });
  const dry = createRun({ draftId: dryDraft.id, groupIds: [groups[0].id], mode: "dry-run" });
  updateTarget(dry.targets[0].id, "failed", { message: "dry check failed" });
  const afterDry = createRun({
    draftId: dryDraft.id,
    groupIds: [groups[0].id],
    mode: "assisted",
    workflow: "hybrid-tabs",
    tabLimit: 1,
  });
  check("a failed dry run does not block real posting", afterDry.targets.length === 1);

  const singleRun = async (slug, options = {}) => {
    const runDraft = createDraft({ workDate: "2026-10-25", slot: "midday", text: `Post #${slug}` });
    const runGroup = upsertGroup({
      name: `Group ${slug}`,
      url: `http://127.0.0.1:${address.port}/${slug}`,
    });
    return createRun({
      draftId: runDraft.id,
      groupIds: [runGroup.id],
      mode: "assisted",
      workflow: "hybrid-tabs",
      tabLimit: 1,
      ...options,
    });
  };
  const prepared = (runId) =>
    waitFor(
      () => getRun(runId)?.targets?.[0]?.status === "awaiting_confirmation",
      `${runId} was never prepared`,
    );

  console.log("Hashtag suggestions over the Post button");
  const suggestRun = await singleRun("suggest-group");
  runManager.start(suggestRun.id);
  await prepared(suggestRun.id);
  await runManager.action(suggestRun.id, suggestRun.targets[0].id, "confirm");
  const suggested = getRun(suggestRun.id).targets[0];
  check("the suggestion list is closed and the post goes out", suggested.status === "published", `${suggested.status} · ${suggested.message.slice(0, 80)}`);
  await waitFor(() => !runManager.isBusy(), "Suggest run did not finish");

  console.log("Published post with no link");
  const noLinkRun = await singleRun("nolink-group");
  runManager.start(noLinkRun.id);
  await prepared(noLinkRun.id);
  await runManager.action(noLinkRun.id, noLinkRun.targets[0].id, "confirm");
  const noLinkTarget = getRun(noLinkRun.id).targets[0];
  check(
    "the fresh post in the feed counts as published",
    noLinkTarget.status === "published" && noLinkTarget.message.includes("Just now"),
    `${noLinkTarget.status} · ${noLinkTarget.message.slice(0, 80)}`,
  );
  await waitFor(() => !runManager.isBusy(), "No-link run did not finish");

  console.log("Something that never stops covering the Post button");
  const coveredRun = await singleRun("covered-group");
  runManager.start(coveredRun.id);
  await prepared(coveredRun.id);
  await runManager.action(coveredRun.id, coveredRun.targets[0].id, "confirm");
  const settled = getRun(coveredRun.id).targets[0];
  check(
    "an unclickable Post button is never clicked and the group goes back to white",
    settled.status === "queued" && settled.message.includes("POST_BUTTON_BLOCKED"),
    `${settled.status} · ${settled.message.slice(0, 80)}`,
  );
  await waitFor(() => !runManager.isBusy(), "Covered run did not finish");

  console.log("Auto-confirm that comes due during a pause");
  const pausedRun = await singleRun("paused-group", { autoConfirm: true });
  runManager.start(pausedRun.id);
  await prepared(pausedRun.id);
  runManager.pause(pausedRun.id);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  check("nothing is posted while paused", getRun(pausedRun.id).targets[0].status === "awaiting_confirmation");
  runManager.resume(pausedRun.id);
  const resumedTarget = await waitFor(() => {
    const current = getRun(pausedRun.id)?.targets?.[0];
    return current?.status === "published" ? current : null;
  }, "The auto-confirm was lost after the pause", 15_000).catch(() => getRun(pausedRun.id).targets[0]);
  check("the tab is posted after resuming", resumedTarget.status === "published", resumedTarget.status);
  await waitFor(() => !runManager.isBusy(), "Paused run did not finish");
} finally {
  await browser.close();
  mockServer.close();
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nUntouched-only run test passed");
process.exit(0);
