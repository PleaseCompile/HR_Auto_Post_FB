import fs from "node:fs";
import path from "node:path";

const dataDirectory = path.resolve("test-results", `run-deletion-${Date.now()}`);
process.env.HR_AUTO_DATA_DIR = dataDirectory;
fs.mkdirSync(dataDirectory, { recursive: true });

const {
  closeDatabase,
  createDraft,
  createRun,
  deleteUnsuccessfulRun,
  getDraft,
  getRun,
  updateTarget,
  upsertGroup,
} = await import("../dist/db.js");

try {
  const draft = createDraft({
    workDate: "2026-07-24",
    slot: "midday",
    text: "Run deletion smoke test",
  });
  const protectedGroup = upsertGroup({
    name: "Protected published group",
    url: `https://www.facebook.com/groups/protected-${Date.now()}/`,
  });
  const uncertainGroup = upsertGroup({
    name: "Uncertain stopped group",
    url: `https://www.facebook.com/groups/uncertain-${Date.now()}/`,
  });

  const protectedRun = createRun({
    draftId: draft.id,
    groupIds: [protectedGroup.id],
    mode: "assisted",
  });
  updateTarget(protectedRun.targets[0].id, "published", {
    message: "Published test target",
  });
  let protectedRejected = false;
  try {
    deleteUnsuccessfulRun(protectedRun.id, { acknowledgedUncertain: true });
  } catch (error) {
    protectedRejected = String(error).includes("ลบคิวนี้ไม่ได้");
  }
  if (!protectedRejected || !getRun(protectedRun.id)) {
    throw new Error("Published run was not protected from deletion");
  }

  const uncertainRun = createRun({
    draftId: draft.id,
    groupIds: [uncertainGroup.id],
    mode: "assisted",
  });
  const evidencePath = path.join(dataDirectory, "evidence", "uncertain.png");
  updateTarget(uncertainRun.targets[0].id, "manual_action_required", {
    message: "Must be checked manually",
    evidencePath,
  });
  let acknowledgementRequired = false;
  try {
    deleteUnsuccessfulRun(uncertainRun.id);
  } catch (error) {
    acknowledgementRequired = String(error).includes("กรุณาตรวจ Facebook");
  }
  if (!acknowledgementRequired || !getRun(uncertainRun.id)) {
    throw new Error("Uncertain run did not require explicit acknowledgement");
  }

  const deleted = deleteUnsuccessfulRun(uncertainRun.id, {
    acknowledgedUncertain: true,
  });
  if (
    !deleted ||
    deleted.targetCount !== 1 ||
    !deleted.evidencePaths.includes(evidencePath) ||
    getRun(uncertainRun.id)
  ) {
    throw new Error("Uncertain unsuccessful run was not deleted correctly");
  }
  if (!getDraft(draft.id)) {
    throw new Error("Deleting a run unexpectedly deleted its draft");
  }

  const replacementRun = createRun({
    draftId: draft.id,
    groupIds: [uncertainGroup.id],
    mode: "assisted",
  });
  if (!replacementRun || replacementRun.targets.length !== 1) {
    throw new Error("Deleted unsuccessful targets still blocked a replacement run");
  }

  console.log("Run deletion safety test passed");
} finally {
  closeDatabase();
}
