// Evidence retention: old system screenshots are deleted, recent ones and
// files the team uploaded by hand are kept, the database stops pointing at
// deleted files, and low disk space removes the oldest screenshots first.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const mode = process.argv[2] || "age";
const dataDirectory = path.resolve("test-results", `retention-${mode}-${Date.now()}`);
process.env.HR_AUTO_DATA_DIR = dataDirectory;
process.env.HR_AUTO_EVIDENCE_RETENTION_DAYS = mode === "age" ? "30" : "";
// "disk" mode asks for more free space than any disk has, forcing cleanup.
process.env.HR_AUTO_MIN_FREE_DISK_MB = mode === "disk" ? "999999999" : "";

const { createDraft, createRun, getRun, upsertGroup, updateTarget } = await import("../dist/db.js");
const { runRetention } = await import("../dist/retention.js");
const { evidenceDirectory, manualEvidenceDirectory } = await import("../dist/config.js");

const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
function makeFile(directory, name, ageDays) {
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, Buffer.alloc(2048, 1));
  fs.utimesSync(filePath, daysAgo(ageDays), daysAgo(ageDays));
  return filePath;
}

const oldShot = makeFile(path.join(evidenceDirectory, "2026-08-01", "morning", "run-a"), "old.png", 40);
const newShot = makeFile(path.join(evidenceDirectory, "2026-10-20", "evening", "run-b"), "new.png", 2);
const manualOld = makeFile(manualEvidenceDirectory, "uploaded-by-team.png", 90);

const draft = createDraft({ workDate: "2026-08-01", slot: "morning", text: "retention" });
const group = upsertGroup({ name: "Retention group", url: "https://www.facebook.com/groups/retention" });
const run = createRun({ draftId: draft.id, groupIds: [group.id], mode: "assisted", workflow: "hybrid-tabs" });
const targetId = run.targets[0].id;
updateTarget(targetId, "published", { evidencePath: oldShot });

const result = runRetention();

if (mode === "age") {
  assert.equal(fs.existsSync(oldShot), false, "40-day-old screenshot deleted");
  assert.equal(fs.existsSync(newShot), true, "2-day-old screenshot kept");
  assert.equal(fs.existsSync(manualOld), true, "hand-uploaded evidence is never deleted");
  assert.equal(fs.existsSync(path.dirname(oldShot)), false, "empty folders removed");
  assert.equal(result.deletedFiles, 1);
  assert.equal(result.clearedReferences, 1);
  assert.equal(getRun(run.id).targets[0].evidencePath, null, "database no longer points at the deleted file");
  assert.equal(getRun(run.id).targets[0].status, "published", "the post record itself is kept");
} else {
  assert.equal(fs.existsSync(oldShot), false, "oldest screenshot deleted for space");
  assert.equal(fs.existsSync(newShot), false, "then the next oldest");
  assert.equal(fs.existsSync(manualOld), true, "hand-uploaded evidence is never deleted");
  assert.match(result.reason, /low disk space/);
}

// The SQLite file stays open in this process; test-results/ is gitignored.

if (mode === "age") {
  // Run the low-disk scenario in a fresh process (settings are read at startup).
  execFileSync(process.execPath, [new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), "disk"], {
    stdio: "inherit",
  });
  console.log("Retention test passed");
}
