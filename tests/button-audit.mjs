import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const port = 4176;
const baseUrl = `http://127.0.0.1:${port}`;
const dataDirectory = path.resolve("test-results", `buttons-${Date.now()}`);
const fixturePath = path.join(dataDirectory, "fixture.png");
const todayBangkok = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
fs.mkdirSync(dataDirectory, { recursive: true });
fs.writeFileSync(
  fixturePath,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7ZkAAAAASUVORK5CYII=",
    "base64",
  ),
);

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
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Button-audit server did not start");
}

async function request(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

const passed = [];
async function check(name, task) {
  await task();
  passed.push(name);
}

let browser;
try {
  await waitForServer();
  const seedDraft = await request("/api/drafts", {
    method: "POST",
    body: JSON.stringify({
      workDate: todayBangkok,
      slot: "morning",
      text: "Seed draft for button audit",
    }),
  });
  const restartDraft = await request("/api/drafts", {
    method: "POST",
    body: JSON.stringify({
      workDate: todayBangkok,
      slot: "evening",
      text: "Restart Draft for button audit",
    }),
  });
  const seedGroup = await request("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      name: "Seed group",
      url: "https://www.facebook.com/groups/button-audit-seed/",
      province: "Bangkok",
    }),
  });
  const seedRun = await request("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      draftId: seedDraft.id,
      groupIds: [seedGroup.id],
      mode: "dry-run",
    }),
  });

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const navigate = async (route, heading) => {
    await page.locator(`[data-route="${route}"]`).click();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
  };

  await check("Sidebar: dashboard", () => navigate("dashboard", "ภาพรวมวันนี้"));
  await check("Sidebar: compose", () => navigate("compose", "สร้างและเตรียมโพสต์"));
  await check("Sidebar: groups", () => navigate("groups", "คลังกลุ่ม"));
  await check("Sidebar: runs", () => navigate("runs", "คิวและการทำงาน"));
  await check("Sidebar: history", () => navigate("history", "หลักฐานการโพสต์"));
  await check("Sidebar: settings", () => navigate("settings", "ตั้งค่าและ Session"));

  await navigate("dashboard", "ภาพรวมวันนี้");
  await check("Dashboard: edit morning draft", async () => {
    await page
      .locator(".slot-row")
      .filter({ hasText: "เช้า" })
      .getByRole("button", { name: "แก้ไข" })
      .click();
    await page.getByRole("heading", { name: "แก้ไข Draft" }).waitFor();
  });
  await navigate("dashboard", "ภาพรวมวันนี้");
  await check("Dashboard: create midday slot", async () => {
    await page
      .locator(".slot-row")
      .filter({ hasText: "กลางวัน" })
      .getByRole("button", { name: "สร้างโพสต์" })
      .click();
    if ((await page.locator('[name="slot"]').inputValue()) !== "midday") {
      throw new Error("Midday shortcut did not set the slot");
    }
  });
  await navigate("dashboard", "ภาพรวมวันนี้");
  await check("Dashboard: view all drafts", async () => {
    await page.getByRole("button", { name: "ดู Draft ทั้งหมด" }).click();
    await page.getByRole("heading", { name: "สร้างและเตรียมโพสต์" }).waitFor();
  });
  await navigate("dashboard", "ภาพรวมวันนี้");
  await check("Dashboard: view queue", async () => {
    await page.getByRole("button", { name: "ดูคิว" }).click();
    await page.getByRole("heading", { name: "คิวและการทำงาน" }).waitFor();
  });
  await navigate("dashboard", "ภาพรวมวันนี้");
  await check("Topbar: new draft", async () => {
    await page.getByRole("button", { name: "สร้างโพสต์ใหม่" }).click();
    await page.getByRole("heading", { name: "สร้าง Draft ใหม่" }).waitFor();
  });

  await check("Compose: remove pending image", async () => {
    await page.locator("#draftImages").setInputFiles(fixturePath);
    const pending = page.locator(".pending-media").first();
    await pending.waitFor();
    await page
      .locator(".media-thumb.pending-media")
      .getByRole("button", { name: "×" })
      .click();
    if (await page.locator(".media-thumb.pending-media").count()) {
      throw new Error("Pending image was not removed");
    }
  });
  await check("Compose: save draft", async () => {
    await page.locator("#draftText").fill("Saved from button audit");
    await page.getByRole("button", { name: "บันทึก Draft", exact: true }).click();
    await page.getByText("บันทึก Draft และรูปเรียบร้อย").waitFor();
    await page.getByRole("button", { name: "สร้าง Draft ใหม่" }).waitFor();
  });
  await check("Compose: clear editing draft", async () => {
    await page.getByRole("button", { name: "สร้าง Draft ใหม่" }).click();
    if ((await page.locator("#draftText").inputValue()) !== "") {
      throw new Error("New draft button did not clear the editor");
    }
  });
  await check("Compose: save and choose groups", async () => {
    await page.locator("#draftText").fill("Save and continue from button audit");
    await page.getByRole("button", { name: "บันทึกแล้วเลือกกลุ่ม" }).click();
    await page.getByRole("heading", { name: "คลังกลุ่ม", exact: true }).waitFor();
  });

  await check("Group dialog: close X without validation", async () => {
    await page.getByRole("button", { name: "เพิ่มกลุ่ม", exact: true }).click();
    const dialog = page.locator("#groupDialog");
    await dialog.getByRole("button", { name: "ปิด" }).click();
    if (await dialog.isVisible()) throw new Error("Group dialog X did not close");
  });
  await check("Group dialog: cancel without validation", async () => {
    await page.getByRole("button", { name: "เพิ่มกลุ่ม", exact: true }).click();
    const dialog = page.locator("#groupDialog");
    await dialog.getByRole("button", { name: "ยกเลิก" }).click();
    if (await dialog.isVisible()) throw new Error("Group dialog cancel did not close");
  });
  await check("Group dialog: save valid group", async () => {
    await page.getByRole("button", { name: "เพิ่มกลุ่ม", exact: true }).click();
    const dialog = page.locator("#groupDialog");
    await dialog.locator('[name="name"]').fill("Added by button audit");
    await dialog
      .locator('[name="url"]')
      .fill("https://www.facebook.com/groups/button-audit-added/");
    await dialog.getByRole("button", { name: "บันทึกกลุ่ม" }).click();
    await page.getByText("Added by button audit").waitFor();
  });
  await check("Groups: import CSV button", async () => {
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "นำเข้า CSV" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "groups.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "name,url,province,tags,can_post,requires_approval,note,active\nImported by audit,https://www.facebook.com/groups/button-audit-csv/,Bangkok,test,yes,no,audit,yes\n",
      ),
    });
    await page.getByText("Imported by audit").waitFor();
  });
  await check("Groups: fluid multi-keyword search", async () => {
    const search = page.locator("#groupSearch");
    const waitForRows = (count) =>
      page.waitForFunction(
        (expected) =>
          document.querySelectorAll("#groupTableBody .group-name").length === expected,
        count,
      );

    await search.fill("audit Added");
    await waitForRows(1);
    await page.getByText("Added by button audit", { exact: true }).waitFor();

    for (let index = 0; index < 5; index += 1) {
      await search.press("Backspace");
      const stillFocused = await search.evaluate(
        (element) => document.activeElement === element,
      );
      if (!stillFocused) throw new Error("Search input lost focus while deleting");
    }

    await search.fill("Seed | Imported");
    await waitForRows(2);
    await search.fill("audit -Imported");
    await waitForRows(1);
    await search.fill('"Added by"');
    await waitForRows(1);
    await search.fill("");
    await waitForRows(3);
  });
  await check("Scan dialog: close X", async () => {
    await page.getByRole("button", { name: "สแกนจาก Facebook" }).click();
    const dialog = page.locator("#scanDialog");
    await dialog.getByRole("button", { name: "ปิด" }).click();
    if (await dialog.isVisible()) throw new Error("Scan dialog X did not close");
  });
  await check("Scan dialog: cancel", async () => {
    await page.getByRole("button", { name: "สแกนจาก Facebook" }).click();
    const dialog = page.locator("#scanDialog");
    await dialog.getByRole("button", { name: "ยกเลิก" }).click();
    if (await dialog.isVisible()) throw new Error("Scan dialog cancel did not close");
  });
  await check("Groups: clear selection", async () => {
    await page.locator(".group-check").first().check();
    await page.getByRole("button", { name: "ล้างที่เลือก" }).click();
    if (await page.locator(".group-check:checked").count()) {
      throw new Error("Clear selection left checked groups");
    }
  });
  await check("Groups: clear old Draft queues and restart", async () => {
    await page.locator(".group-check").first().check();
    await page.locator("#runDraft").selectOption(restartDraft.id);
    page.once("dialog", (dialog) => dialog.accept("เริ่มใหม่ทั้งหมด"));
    await page
      .getByRole("button", { name: "ล้างคิวเดิมทั้งหมดและสร้างใหม่" })
      .click();
    await page.getByRole("heading", { name: "คิวและการทำงาน" }).waitFor();
    await page.getByText(/ล้างคิวเดิม 0 คิวแล้ว และสร้างคิวใหม่ 1 กลุ่มสำเร็จ/).waitFor();
    await navigate("groups", "คลังกลุ่ม");
  });
  await check("Groups: create queue", async () => {
    await page.locator(".group-check").nth(1).check();
    await page.locator("#runDraft").selectOption(seedDraft.id);
    if ((await page.locator("#runMode").inputValue()) !== "assisted") {
      throw new Error("Assisted mode should be the default queue mode");
    }
    if (
      (await page.locator("#runWorkflow").inputValue()) !== "hybrid-tabs" ||
      (await page.locator("#runTabLimit").inputValue()) !== "0"
    ) {
      throw new Error("Hybrid workflow with all selected groups should be the default");
    }
    await page.locator("#runMode").selectOption("dry-run");
    await page.getByRole("button", { name: "สร้างคิวโพสต์" }).click();
    await page.getByRole("heading", { name: "คิวและการทำงาน" }).waitFor();
  });
  await check("Runs: refresh", async () => {
    await page.getByRole("button", { name: "รีเฟรชสถานะ" }).click();
    await page.getByText("อัปเดตสถานะแล้ว").waitFor();
  });
  await check("Evidence: open manager and upload", async () => {
    const targetId = seedRun.targets[0].id;
    const targetRow = page.locator(`.target-row:has([data-target="${targetId}"])`).first();
    await targetRow.getByRole("button", { name: "จัดการหลักฐาน", exact: true }).click();
    const dialog = page.locator("#evidenceDialog");
    await dialog.waitFor();
    await dialog.locator('input[name="files"]').setInputFiles(fixturePath);
    await dialog.locator('input[name="note"]').fill("อัปโหลดจาก button audit");
    await dialog.getByRole("button", { name: "อัปโหลดหลักฐาน" }).click();
    await page.getByText("อัปโหลดหลักฐานเรียบร้อย").waitFor();
    await dialog.getByText("อัปโหลดเอง").waitFor();
  });
  await check("Evidence: edit note", async () => {
    const dialog = page.locator("#evidenceDialog");
    await dialog.locator("textarea").fill("แก้ไขหมายเหตุจาก button audit");
    await dialog.getByRole("button", { name: "บันทึกหมายเหตุ" }).click();
    await page.getByText("บันทึกหมายเหตุแล้ว").waitFor();
    if ((await dialog.locator("textarea").inputValue()) !== "แก้ไขหมายเหตุจาก button audit") {
      throw new Error("Evidence note was not preserved after save");
    }
  });
  await check("Evidence: replace image", async () => {
    const dialog = page.locator("#evidenceDialog");
    await dialog.locator(".evidence-replace-input").setInputFiles(fixturePath);
    await page.getByText("เปลี่ยนรูปหลักฐานแล้ว").waitFor();
  });
  await check("Evidence: delete upload", async () => {
    const dialog = page.locator("#evidenceDialog");
    page.once("dialog", (confirmation) => confirmation.accept());
    await dialog.getByRole("button", { name: "ลบ", exact: true }).click();
    await page.getByText("ลบหลักฐานแล้ว").waitFor();
    await dialog.getByText("ยังไม่มีหลักฐานสำหรับกลุ่มนี้").waitFor();
  });
  await check("Evidence: close manager", async () => {
    const dialog = page.locator("#evidenceDialog");
    await dialog.getByRole("button", { name: "ปิด", exact: true }).last().click();
    if (await dialog.isVisible()) throw new Error("Evidence manager did not close");
  });
  await check("Runs: start guarded queue", async () => {
    await page.getByRole("button", { name: "เริ่มคิว" }).first().click();
    await page
      .getByText("เริ่มคิวแล้ว ระบบจะเปิดแท็บ Facebook ใหม่ตามรูปแบบของคิว")
      .waitFor();
  });

  let mockedRuns = [
    {
      id: "mock-run",
      draftId: seedDraft.id,
      mode: "assisted",
      workflow: "hybrid-tabs",
      tabLimit: 3,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      createdAt: new Date().toISOString(),
      draft: {
        id: seedDraft.id,
        workDate: "2026-07-23",
        slot: "morning",
        text: "Mock run",
        status: "draft",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        media: [],
      },
      targets: [
        {
          id: "mock-target-skip",
          runId: "mock-run",
          groupId: seedGroup.id,
          position: 0,
           status: "awaiting_confirmation",
           message: "รอยืนยัน",
           evidencePath: "mock-skip.png",
           permalink: null,
           updatedAt: "2026-07-23T01:00:00.000Z",
          group: seedGroup,
        },
        {
          id: "mock-target-confirm",
          runId: "mock-run",
           groupId: "second-group",
          position: 1,
          status: "awaiting_confirmation",
          message: "รอยืนยัน",
           evidencePath: "mock-confirm.png",
           permalink: null,
           updatedAt: "2026-07-23T05:30:00.000Z",
          group: { ...seedGroup, id: "second-group", name: "Second mock group" },
        },
        {
          id: "mock-target-manual",
          runId: "mock-run",
           groupId: "third-group",
          position: 2,
          status: "awaiting_confirmation",
          message: "รอยืนยัน",
           evidencePath: "mock-manual.png",
           permalink: null,
           updatedAt: "2026-07-23T11:00:00.000Z",
          group: { ...seedGroup, id: "third-group", name: "Manual mock group" },
        },
      ],
    },
    {
      id: "mock-dry-run",
      draftId: seedDraft.id,
      mode: "dry-run",
      workflow: "sequential",
      tabLimit: 3,
      status: "completed",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      draft: {
        id: seedDraft.id,
        workDate: "2026-07-23",
        slot: "midday",
        text: "Mock dry run",
        status: "draft",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        media: [],
      },
      targets: [
        {
          id: "mock-dry-target",
          runId: "mock-dry-run",
          groupId: seedGroup.id,
          position: 0,
          status: "dry_run_ready",
          message: "Dry run ready",
           evidencePath: "mock-dry.png",
           permalink: null,
           updatedAt: "2026-07-23T02:00:00.000Z",
          group: seedGroup,
        },
      ],
    },
    {
      id: "mock-failed-run",
      draftId: seedDraft.id,
      mode: "assisted",
      workflow: "sequential",
      tabLimit: 3,
      status: "failed",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      draft: {
        id: seedDraft.id,
        workDate: "2026-07-23",
        slot: "morning",
        text: "Mock failed assisted run",
        status: "draft",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        media: [],
      },
      targets: [
        {
          id: "mock-failed-target",
          runId: "mock-failed-run",
          groupId: seedGroup.id,
          position: 0,
          status: "failed",
          message: "Composer was not ready",
           evidencePath: "mock-failed.png",
           permalink: null,
           updatedAt: "2026-07-23T12:00:00.000Z",
          group: seedGroup,
        },
      ],
    },
    {
      id: "mock-recovery-run",
      draftId: seedDraft.id,
      mode: "assisted",
      workflow: "sequential",
      tabLimit: 3,
      status: "interrupted",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      draft: {
        id: seedDraft.id,
        workDate: "2026-07-23",
        slot: "evening",
        text: "Recovery mock run",
        status: "draft",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        media: [],
      },
      targets: [
        {
          id: "mock-recovery-target",
          runId: "mock-recovery-run",
           groupId: "recovery-group",
          position: 0,
          status: "manual_action_required",
          message: "ต้องตรวจย้อนหลัง",
           evidencePath: "mock-recovery.png",
           permalink: null,
           updatedAt: "2026-07-23T13:00:00.000Z",
          group: { ...seedGroup, id: "recovery-group", name: "Recovery mock group" },
        },
      ],
    },
  ];
  let clonedAssistedPayload = null;
  let deletedRunPayload = null;
  let deletedPostedRunPayload = null;
  await page.route(`${baseUrl}/api/runs`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: mockedRuns });
    } else if (route.request().method() === "POST") {
      clonedAssistedPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        json: {
          id: "cloned-assisted-run",
          ...clonedAssistedPayload,
          status: "queued",
          targets: [],
        },
      });
    } else {
      await route.continue();
    }
  });
  await page.route(`${baseUrl}/api/runs/mock-run/**`, async (route) => {
    const url = route.request().url();
    if (url.endsWith("/pause")) mockedRuns[0].status = "paused";
    else if (url.endsWith("/resume")) mockedRuns[0].status = "running";
    else if (url.endsWith("/stop")) mockedRuns[0].status = "stopped";
    else if (url.endsWith("/focus")) {
      // Focusing a tab does not change target state.
    }
    else if (url.includes("mock-target-skip")) {
      mockedRuns[0].targets[0].status = "skipped";
    } else if (url.includes("mock-target-confirm")) {
      mockedRuns[0].targets[1].status = "published";
    } else if (url.includes("mock-target-manual")) {
      mockedRuns[0].targets[2].status = "published";
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.route(`${baseUrl}/api/runs/mock-recovery-run`, async (route) => {
    if (route.request().method() === "DELETE") {
      deletedPostedRunPayload = route.request().postDataJSON();
      const index = mockedRuns.findIndex((run) => run.id === "mock-recovery-run");
      if (index >= 0) mockedRuns.splice(index, 1);
      await route.fulfill({ json: { ok: true, runId: "mock-recovery-run" } });
      return;
    }
    await route.continue();
  });
  await page.route(`${baseUrl}/api/runs/mock-recovery-run/**`, async (route) => {
    const url = route.request().url();
    const recoveryRun = mockedRuns.find((run) => run.id === "mock-recovery-run");
    if (!recoveryRun) throw new Error("Recovery mock run is missing");
    if (url.endsWith("/workflow")) {
      const payload = route.request().postDataJSON();
      recoveryRun.workflow = payload.workflow;
      recoveryRun.tabLimit = payload.tabLimit;
    } else if (url.endsWith("/reconcile-posted")) {
      recoveryRun.targets[0].status = "published";
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.route(`${baseUrl}/api/runs/mock-failed-run`, async (route) => {
    if (route.request().method() === "DELETE") {
      deletedRunPayload = route.request().postDataJSON();
      const index = mockedRuns.findIndex((run) => run.id === "mock-failed-run");
      if (index >= 0) mockedRuns.splice(index, 1);
      await route.fulfill({ json: { ok: true, runId: "mock-failed-run" } });
      return;
    }
    await route.continue();
  });
  await navigate("runs", "คิวและการทำงาน");
  await check("Runs: status colors and legend", async () => {
    await page.getByRole("button", { name: "รีเฟรชสถานะ" }).click();
    await page.getByText("Second mock group").waitFor();
    for (const label of [
      "เสร็จแล้ว",
      "กำลังทำงาน",
      "รอยืนยัน/ต้องตรวจ",
      "ไม่สำเร็จ",
      "รอเริ่ม/ข้าม/หยุด",
    ]) {
      await page.locator(".status-legend").getByText(label, { exact: true }).waitFor();
    }
    const runClasses = await page.locator(".run-card").evaluateAll((elements) =>
      elements.map((element) => element.className),
    );
    const attentionTarget = await page
      .locator(".target-row")
      .filter({ hasText: "Second mock group" })
      .evaluate((element) => element.className);
    if (
      !runClasses.includes("run-card run-state-done") ||
      !runClasses.includes("run-card run-state-failed") ||
      !attentionTarget.includes("target-state-attention")
    ) {
      throw new Error(
        `Run or target status color class was not applied: ${JSON.stringify({ runClasses, attentionTarget })}`,
      );
    }
  });
  await check("Runs: convert completed Dry run to real queue", async () => {
    await page.getByRole("button", { name: "สร้างคิวโพสต์จริง" }).click();
    await page
      .getByText("สร้างคิวโพสต์จริงจาก Dry run แล้ว กดเริ่มคิวเพื่อทำงานต่อ")
      .waitFor();
    if (
      clonedAssistedPayload?.mode !== "assisted" ||
      clonedAssistedPayload?.draftId !== seedDraft.id ||
      clonedAssistedPayload?.groupIds?.[0] !== seedGroup.id
    ) {
      throw new Error("Dry-run conversion did not create the expected assisted queue");
    }
  });
  await check("Runs: retry failed assisted targets", async () => {
    clonedAssistedPayload = null;
    await page.getByRole("button", { name: "ลองใหม่รายการที่ไม่สำเร็จ" }).click();
    await page.getByText("สร้างคิวลองใหม่แล้ว กดเริ่มคิวเพื่อเตรียมโพสต์อีกครั้ง").waitFor();
    if (
      clonedAssistedPayload?.mode !== "assisted" ||
      clonedAssistedPayload?.draftId !== seedDraft.id ||
      clonedAssistedPayload?.groupIds?.[0] !== seedGroup.id
    ) {
      throw new Error("Failed-target retry did not create the expected assisted queue");
    }
  });
  await check("Runs: switch interrupted queue to Hybrid", async () => {
    await page
      .locator(".run-card")
      .filter({ hasText: "Recovery mock group" })
      .getByRole("button", { name: "เปลี่ยนเป็น Hybrid" })
      .click();
    await page.getByText("เปลี่ยนเป็น Hybrid แบบเปิดทุกกลุ่มพร้อมกันแล้ว").waitFor();
    const recoveryRun = mockedRuns.find((run) => run.id === "mock-recovery-run");
    if (recoveryRun?.workflow !== "hybrid-tabs" || recoveryRun?.tabLimit !== 0) {
      throw new Error("Interrupted run workflow was not updated");
    }
  });
  await check("Runs: reconcile manually posted interrupted target", async () => {
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .locator(".target-row")
      .filter({ hasText: "Recovery mock group" })
      .getByRole("button", { name: "ยืนยันว่าโพสต์เองแล้ว" })
      .click();
    await page
      .getByText("กระทบยอดเป็นเผยแพร่แล้วและเก็บหลักฐานย้อนหลังเรียบร้อย")
      .waitFor();
  });
  await check("Runs: pause", async () => {
    await page.getByRole("button", { name: "พัก" }).click();
    await page.getByRole("button", { name: "ทำต่อ" }).waitFor();
  });
  await check("Runs: resume", async () => {
    await page.getByRole("button", { name: "ทำต่อ" }).click();
    await page.getByRole("button", { name: "พัก" }).waitFor();
  });
  await check("Runs: focus prepared Facebook tab", async () => {
    await page
      .locator(".target-row")
      .filter({ hasText: "Seed group" })
      .getByRole("button", { name: "เปิดแท็บ" })
      .click();
    await page.getByText("เปิดแท็บ Facebook ของกลุ่มนี้แล้ว").waitFor();
  });
  await check("Runs: skip target", async () => {
    page.once("dialog", (dialog) => dialog.accept("ข้ามจากชุดทดสอบ"));
    await page
      .locator(".target-row")
      .filter({ hasText: "Seed group" })
      .getByRole("button", { name: "ข้าม + หลักฐาน" })
      .click();
    await page.getByText("ข้ามกลุ่มนี้พร้อมเก็บหลักฐานแล้ว").waitFor();
  });
  await check("Runs: confirm target", async () => {
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .locator(".target-row")
      .filter({ hasText: "Second mock group" })
      .getByRole("button", { name: "ยืนยันและโพสต์" })
      .click();
    await page.getByText("ระบบกด Post แล้วและกำลังเก็บหลักฐาน").waitFor();
  });
  await check("Runs: record manually posted target", async () => {
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .locator(".target-row")
      .filter({ hasText: "Manual mock group" })
      .getByRole("button", { name: "ฉันโพสต์เองแล้ว" })
      .click();
    await page
      .getByText("บันทึกว่าโพสต์เองแล้วและเก็บหลักฐานเรียบร้อย")
      .waitFor();
  });
  await check("Runs: stop", async () => {
    await page.getByRole("button", { name: "หยุด" }).click();
    await page.getByText("หยุดแล้ว").waitFor();
  });

  await navigate("history", "หลักฐานการโพสต์");
  await check("History filters: recommended grouped view", async () => {
    await page.locator(".evidence-filter-panel").waitFor();
    if (
      (await page.locator("#historyView").inputValue()) !== "run" ||
      (await page.locator("#historySort").inputValue()) !== "newest" ||
      (await page.locator("#historyDateBasis").inputValue()) !== "work" ||
      (await page.locator(".evidence-run-divider").count()) !== 4 ||
      (await page.locator(".evidence-result-row").count()) !== 6
    ) {
      throw new Error("History did not default to grouped-by-run, newest-first view");
    }
  });
  await check("History filters: fluid multi-keyword search", async () => {
    const query = page.locator("#historyQuery");
    await query.fill("Second mock");
    if ((await page.locator(".evidence-result-row").count()) !== 1) {
      throw new Error("History keyword search did not narrow to one evidence item");
    }
    await page.waitForTimeout(3200);
    if ((await page.evaluate(() => document.activeElement?.id)) !== "historyQuery") {
      throw new Error("History search lost focus during background refresh");
    }
  });
  await check("History filters: queue, slot, status, source and time", async () => {
    await page.getByRole("button", { name: "ล้างตัวกรองทั้งหมด" }).click();
    await page.locator("#historySlot").selectOption("midday");
    await page.locator("#historyRun").selectOption("mock-dry-run");
    await page.locator("#historyStatus").selectOption("dry_run_ready");
    await page.locator("#historySource").selectOption("system");
    await page.locator("#historyTimeFrom").fill("08:30");
    await page.locator("#historyTimeTo").fill("09:30");
    await page.locator("#historyTimeTo").dispatchEvent("change");
    if (
      (await page.locator(".evidence-result-row").count()) !== 1 ||
      !(await page.locator(".evidence-result-row").first().innerText()).includes("Seed group")
    ) {
      throw new Error("Combined history filters returned an unexpected result");
    }
  });
  await check("History filters: exact group, date preset and list view", async () => {
    await page.getByRole("button", { name: "ล้างตัวกรองทั้งหมด" }).click();
    await page.locator("#historyGroup").selectOption("second-group");
    if ((await page.locator(".evidence-result-row").count()) !== 1) {
      throw new Error("Exact-group history filter did not return one item");
    }
    await page.getByRole("button", { name: "เดือนนี้" }).click();
    await page.locator("#historyView").selectOption("list");
    if ((await page.locator(".evidence-run-divider").count()) !== 0) {
      throw new Error("List history view still rendered run dividers");
    }
    await page.getByRole("button", { name: "ล้างตัวกรองทั้งหมด" }).click();
    if ((await page.locator(".evidence-result-row").count()) !== 6) {
      throw new Error("Clear history filters did not restore all evidence");
    }
  });
  await navigate("runs", "คิวและการทำงาน");
  await check("Runs: delete entire failed queue", async () => {
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .locator(".run-card")
      .filter({ hasText: "Composer was not ready" })
      .getByRole("button", { name: "ลบทั้งคิว" })
      .click();
    await page
      .getByText("ลบทั้งคิวแล้ว สามารถเลือกกลุ่มเดิมทั้งหมดและสร้างคิวโพสต์ใหม่ได้")
      .waitFor();
    if (!deletedRunPayload || mockedRuns.some((run) => run.id === "mock-failed-run")) {
      throw new Error("Failed run was not deleted through the UI");
    }
  });
  await check("Runs: require typed confirmation before deleting posted queue", async () => {
    page.once("dialog", (dialog) => dialog.accept("ลบทั้งคิว"));
    await page
      .locator(".run-card")
      .filter({ hasText: "Recovery mock group" })
      .getByRole("button", { name: "ลบทั้งคิว" })
      .click();
    for (let attempt = 0; attempt < 30 && !deletedPostedRunPayload; attempt += 1) {
      await page.waitForTimeout(100);
    }
    if (
      !deletedPostedRunPayload?.acknowledgedPosted ||
      mockedRuns.some((run) => run.id === "mock-recovery-run")
    ) {
      throw new Error(
        `Posted queue was not deleted after typed acknowledgement: ${JSON.stringify({
          deletedPostedRunPayload,
          recoveryStillPresent: mockedRuns.some((run) => run.id === "mock-recovery-run"),
        })}`,
      );
    }
  });

  let fakeSession = null;
  await page.route(`${baseUrl}/api/dashboard`, async (route) => {
    const upstream = await route.fetch();
    const body = await upstream.json();
    if (fakeSession) body.session = fakeSession;
    await route.fulfill({ response: upstream, json: body });
  });
  let connectCalled = false;
  let closeCalled = false;
  await page.route(`${baseUrl}/api/session/connect`, async (route) => {
    connectCalled = true;
    await route.fulfill({
      json: {
        browserOpen: true,
        authenticated: true,
        url: "https://www.facebook.com/",
        accountIdMasked: "****1234",
      },
    });
  });
  await page.route(`${baseUrl}/api/session/close`, async (route) => {
    closeCalled = true;
    fakeSession = {
      browserOpen: false,
      authenticated: false,
      url: null,
      accountIdMasked: null,
    };
    await route.fulfill({ json: { ok: true } });
  });
  mockedRuns = null;
  await page.unroute(`${baseUrl}/api/runs`);
  await navigate("settings", "ตั้งค่าและ Session");
  await check("Settings: connect session handler", async () => {
    await page.getByRole("button", { name: "เชื่อมต่อ Facebook" }).click();
    if (!connectCalled) throw new Error("Connect session API was not called");
  });
  fakeSession = {
    browserOpen: true,
    authenticated: true,
    url: "https://www.facebook.com/",
    accountIdMasked: "****1234",
  };
  await navigate("settings", "ตั้งค่าและ Session");
  await page.getByRole("button", { name: "ตรวจ Session" }).waitFor();
  await check("Settings: check session", async () => {
    await page.getByRole("button", { name: "ตรวจ Session" }).click();
    await page.getByText("อัปเดตสถานะแล้ว").waitFor();
  });
  await check("Settings: close browser handler", async () => {
    await page.getByRole("button", { name: "ปิด Browser" }).click();
    if (!closeCalled) throw new Error("Close session API was not called");
  });

  let mockScan = {
    id: null,
    status: "idle",
    startedAt: null,
    finishedAt: null,
    foundCount: 0,
    newCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    scrollCount: 0,
    message: "พร้อมสแกน",
    snapshotPath: null,
    error: null,
  };
  fakeSession = {
    browserOpen: true,
    authenticated: true,
    url: "https://www.facebook.com/",
    accountIdMasked: "****1234",
  };
  await page.route(`${baseUrl}/api/groups/scan`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: mockScan });
    } else {
      await route.continue();
    }
  });
  await page.route(`${baseUrl}/api/groups/scan/start`, async (route) => {
    mockScan = {
      ...mockScan,
      id: "mock-scan",
      status: "running",
      startedAt: new Date().toISOString(),
      foundCount: 12,
      scrollCount: 2,
      message: "พบ 12 กลุ่ม",
    };
    await route.fulfill({ json: mockScan });
  });
  await page.route(`${baseUrl}/api/groups/scan/stop`, async (route) => {
    mockScan = {
      ...mockScan,
      status: "completed",
      finishedAt: new Date().toISOString(),
      message: "หยุดและบันทึก 12 กลุ่ม",
    };
    await route.fulfill({ json: mockScan });
  });
  await page.reload({ waitUntil: "networkidle" });
  await navigate("groups", "คลังกลุ่ม");
  await check("Scan: start", async () => {
    await page.getByRole("button", { name: "สแกนจาก Facebook" }).click();
    await page.locator("#scanAck").check();
    await page.getByRole("button", { name: "เริ่มสแกน" }).click();
    await page.getByRole("button", { name: "หยุดและบันทึกที่พบ" }).waitFor();
  });
  await check("Scan: stop", async () => {
    await page.getByRole("button", { name: "หยุดและบันทึกที่พบ" }).click();
    await page.getByText("สแกนล่าสุดเสร็จแล้ว").waitFor();
    await page.getByRole("button", { name: "ปิดและดูคลังกลุ่ม" }).click();
  });

  if (consoleErrors.length) {
    throw new Error(`Browser console errors:\n${consoleErrors.join("\n")}`);
  }
  await page.screenshot({
    path: path.resolve("test-results", "button-audit-final.png"),
    fullPage: true,
  });
  console.log(`Button audit passed (${passed.length} interactions)`);
  for (const item of passed) console.log(`  ✓ ${item}`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
