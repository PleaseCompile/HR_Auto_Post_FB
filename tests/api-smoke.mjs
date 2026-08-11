import { spawn } from "node:child_process";
import path from "node:path";

const port = 4174;
const dataDirectory = path.resolve("test-results", `api-${Date.now()}`);
const server = spawn(process.execPath, ["dist/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HR_AUTO_DATA_DIR: dataDirectory,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Test server did not start");
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${url}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

try {
  await waitForServer();
  const initialScan = await jsonRequest("/api/groups/scan");
  if (initialScan.status !== "idle") throw new Error("Unexpected initial scan state");
  const scanWithoutSession = await fetch(
    `http://127.0.0.1:${port}/api/groups/scan/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledged: true }),
    },
  );
  const scanError = await scanWithoutSession.json();
  if (
    scanWithoutSession.ok ||
    !String(scanError.error || "").includes("ล็อกอิน Facebook")
  ) {
    throw new Error("Group scan did not enforce an authenticated session");
  }

  const draft = await jsonRequest("/api/drafts", {
    method: "POST",
    body: JSON.stringify({
      workDate: "2026-07-23",
      slot: "morning",
      text: "API smoke test",
    }),
  });
  const imageForm = new FormData();
  imageForm.append(
    "images",
    new Blob(
      [
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7ZkAAAAASUVORK5CYII=",
          "base64",
        ),
      ],
      { type: "image/png" },
    ),
    "smoke.png",
  );
  const mediaResponse = await fetch(
    `http://127.0.0.1:${port}/api/drafts/${draft.id}/media`,
    { method: "POST", body: imageForm },
  );
  if (!mediaResponse.ok) throw new Error("Media upload failed");

  const group = await jsonRequest("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      name: "Smoke test group",
      url: `https://www.facebook.com/groups/smoke-${Date.now()}`,
      tags: ["test"],
    }),
  });
  const csvForm = new FormData();
  csvForm.append(
    "file",
    new Blob(
      [
        `name,url,province,tags,can_post,requires_approval,note,active\nCSV smoke group,https://www.facebook.com/groups/csv-${Date.now()},Bangkok,test|csv,yes,no,smoke,yes\n`,
      ],
      { type: "text/csv" },
    ),
    "groups.csv",
  );
  const csvResponse = await fetch(`http://127.0.0.1:${port}/api/groups/import`, {
    method: "POST",
    body: csvForm,
  });
  const csvResult = await csvResponse.json();
  if (!csvResponse.ok || csvResult.imported !== 1) {
    throw new Error(`CSV import failed: ${JSON.stringify(csvResult)}`);
  }

  const run = await jsonRequest("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      draftId: draft.id,
      groupIds: [group.id],
      mode: "dry-run",
    }),
  });
  const saved = await jsonRequest(`/api/runs/${run.id}`);
  if (
    saved.targets.length !== 1 ||
    saved.draft.text !== "API smoke test" ||
    saved.draft.media.length !== 1 ||
    saved.workflow !== "sequential" ||
    saved.tabLimit !== 0
  ) {
    throw new Error("Saved run did not contain expected draft/target data");
  }

  const windowedGroup = await jsonRequest("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      name: "Windowed smoke test group",
      url: `https://www.facebook.com/groups/windowed-smoke-${Date.now()}`,
      tags: ["test", "windows"],
    }),
  });
  const windowedRun = await jsonRequest("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      draftId: draft.id,
      groupIds: [windowedGroup.id],
      mode: "assisted",
      workflow: "hybrid-windows",
      tabLimit: 30,
    }),
  });
  const savedWindowedRun = await jsonRequest(`/api/runs/${windowedRun.id}`);
  if (
    savedWindowedRun.workflow !== "hybrid-windows" ||
    savedWindowedRun.tabLimit !== 30
  ) {
    throw new Error("Windowed workflow settings were not saved");
  }

  // The old hard cap of 30 tabs per window was a manual-reviewability guideline,
  // not a RAM limit, so both hybrid workflows now share the 250 ceiling.
  const wideWindowedRun = await jsonRequest("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      draftId: draft.id,
      groupIds: [windowedGroup.id],
      mode: "assisted",
      workflow: "hybrid-windows",
      tabLimit: 50,
    }),
  });
  const savedWideWindowedRun = await jsonRequest(`/api/runs/${wideWindowedRun.id}`);
  if (
    savedWideWindowedRun.workflow !== "hybrid-windows" ||
    savedWideWindowedRun.tabLimit !== 50
  ) {
    throw new Error("Windowed workflow did not accept a tabLimit above the old 30 cap");
  }

  const overLimitResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      draftId: draft.id,
      groupIds: [windowedGroup.id],
      mode: "assisted",
      workflow: "hybrid-windows",
      tabLimit: 251,
    }),
  });
  if (overLimitResponse.status !== 400) {
    throw new Error("Windowed workflow did not reject a tabLimit above 250");
  }

  const customHybridRun = await jsonRequest("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      draftId: draft.id,
      groupIds: [windowedGroup.id],
      mode: "assisted",
      workflow: "hybrid-tabs",
      tabLimit: 50,
      autoConfirm: true,
    }),
  });
  const savedCustomRun = await jsonRequest(`/api/runs/${customHybridRun.id}`);
  if (
    savedCustomRun.workflow !== "hybrid-tabs" ||
    savedCustomRun.tabLimit !== 50 ||
    savedCustomRun.autoConfirm !== true
  ) {
    throw new Error("Hybrid-tabs custom tabLimit 50 and autoConfirm true were not saved");
  }

  const targetId = saved.targets[0].id;
  const evidenceForm = new FormData();
  evidenceForm.append(
    "files",
    new Blob(
      [
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7ZkAAAAASUVORK5CYII=",
          "base64",
        ),
      ],
      { type: "image/png" },
    ),
    "manual-proof.png",
  );
  evidenceForm.append("note", "หลักฐานจาก API smoke");
  const evidenceResponse = await fetch(
    `http://127.0.0.1:${port}/api/run-targets/${targetId}/evidence`,
    { method: "POST", body: evidenceForm },
  );
  const addedEvidence = await evidenceResponse.json();
  if (
    !evidenceResponse.ok ||
    addedEvidence.length !== 1 ||
    addedEvidence[0].note !== "หลักฐานจาก API smoke" ||
    "storedPath" in addedEvidence[0]
  ) {
    throw new Error(`Manual evidence upload failed: ${JSON.stringify(addedEvidence)}`);
  }
  const evidenceId = addedEvidence[0].id;
  const evidenceFile = await fetch(
    `http://127.0.0.1:${port}/api/manual-evidence/${evidenceId}/file`,
  );
  if (!evidenceFile.ok || evidenceFile.headers.get("content-type") !== "image/png") {
    throw new Error("Manual evidence file could not be opened");
  }

  const replacementForm = new FormData();
  replacementForm.append(
    "file",
    new Blob(
      [
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7ZkAAAAASUVORK5CYII=",
          "base64",
        ),
      ],
      { type: "image/png" },
    ),
    "replacement-proof.png",
  );
  replacementForm.append("note", "แก้ไขหมายเหตุแล้ว");
  const replacementResponse = await fetch(
    `http://127.0.0.1:${port}/api/manual-evidence/${evidenceId}`,
    { method: "PUT", body: replacementForm },
  );
  const replacedEvidence = await replacementResponse.json();
  if (
    !replacementResponse.ok ||
    replacedEvidence.fileName !== "replacement-proof.png" ||
    replacedEvidence.note !== "แก้ไขหมายเหตุแล้ว"
  ) {
    throw new Error(`Manual evidence edit failed: ${JSON.stringify(replacedEvidence)}`);
  }

  await jsonRequest(`/api/manual-evidence/${evidenceId}`, { method: "DELETE" });
  const remainingEvidence = await jsonRequest(
    `/api/manual-evidence?targetId=${encodeURIComponent(targetId)}`,
  );
  if (remainingEvidence.length !== 0) {
    throw new Error("Manual evidence was not deleted");
  }
  console.log("API smoke test passed");
} finally {
  server.kill("SIGTERM");
}
