import path from "node:path";

// Opening the database marks live sweeps as interrupted, so never use the real one.
process.env.HR_AUTO_DATA_DIR = path.resolve("test-results", `pending-tabs-${Date.now()}`);
process.env.HR_AUTO_PENDING_TAB_STAGGER_MS = "20";
const { pendingCleaner, clampPendingTabs } = await import("../dist/pending-cleaner.js");
const { browserSession } = await import("../dist/session.js");
const { SecurityCheckpointError } = await import("../dist/facebook.js");

// No browser: each "tab" is a stub, and the work is a timed promise per group.
let opened = 0, closed = 0;
const fake = () => ({ id: ++opened, close: async () => { closed += 1; } });
browserSession.newPage = async () => fake();
browserSession.newWindow = async () => fake();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (ok, msg) => { if (!ok) { console.error("FAIL", msg); process.exit(1); } console.log("  ✓", msg); };

for (const tabs of [1, 3, 10]) {
  opened = closed = 0;
  pendingCleaner.tabs = tabs; pendingCleaner.stopRequested = false;
  const items = Array.from({ length: 25 }, (_, i) => i);
  const seen = []; let live = 0, peak = 0; const pagesUsed = new Set();
  await pendingCleaner.runWithTabs(items, async (page, item) => {
    live += 1; peak = Math.max(peak, live); pagesUsed.add(page.id);
    await sleep(5 + (item % 4) * 7); seen.push(item); live -= 1;
  });
  assert(seen.length === 25 && new Set(seen).size === 25, `tabs=${tabs}: every group done exactly once`);
  assert(peak <= tabs && (tabs === 1 || peak > 1), `tabs=${tabs}: peak concurrency ${peak}`);
  assert(opened <= tabs && closed === opened, `tabs=${tabs}: opened ${opened}, closed ${closed}`);
}

opened = closed = 0;
pendingCleaner.tabs = 3; pendingCleaner.stopRequested = false;
const done = []; let threw = null;
try {
  await pendingCleaner.runWithTabs(Array.from({ length: 30 }, (_, i) => i), async (_p, item) => {
    await sleep(10);
    if (item === 4) throw new SecurityCheckpointError("checkpoint");
    done.push(item);
  });
} catch (e) { threw = e; }
assert(threw instanceof SecurityCheckpointError, "checkpoint error is rethrown");
assert(done.length < 10, `other tabs stop soon after (${done.length} groups finished)`);
assert(closed === opened, "all pages closed after fatal");

pendingCleaner.tabs = 5; pendingCleaner.stopRequested = false; opened = closed = 0;
await pendingCleaner.runWithTabs([1, 2], async () => {});
assert(opened <= 2, "never opens more tabs than groups");

pendingCleaner.tabs = 3; pendingCleaner.stopRequested = false;
const stopDone = [];
await pendingCleaner.runWithTabs(Array.from({ length: 30 }, (_, i) => i), async (_p, item) => {
  await sleep(10); stopDone.push(item); if (item === 2) pendingCleaner.stopRequested = true;
});
assert(stopDone.length <= 5, `stop request ends the sweep (${stopDone.length} groups finished)`);

assert(clampPendingTabs(0) === 1 && clampPendingTabs(99) === 10 && clampPendingTabs("x") === 1 && clampPendingTabs(4.6) === 5, "clampPendingTabs bounds");
console.log("Pending tabs test passed");
process.exit(0);
