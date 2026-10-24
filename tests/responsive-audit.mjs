// Opens every page at phone, tablet and desktop widths with realistic data and
// fails if anything sticks out of the screen or needs sideways scrolling.
//
//   node tests/responsive-audit.mjs            # audit, exit 1 on problems
//   SHOTS=dir node tests/responsive-audit.mjs  # also save screenshots
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const port = 4185;
const baseUrl = `http://127.0.0.1:${port}`;
const dataDirectory = path.resolve("test-results", `responsive-${Date.now()}`);
const shotsDirectory = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null;

const widths = [320, 360, 390, 412, 600, 768, 820, 912, 1024, 1180, 1280, 1440];
const routes = ["dashboard", "compose", "groups", "runs", "pending", "history", "settings"];

const server = spawn(process.execPath, ["dist/server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HR_AUTO_DATA_DIR: dataDirectory },
  stdio: ["ignore", "pipe", "pipe"],
});

async function request(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(`${url} -> ${response.status} ${await response.text()}`);
  return response.json();
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await request("/api/health");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error("Server did not start");
}

const longNames = [
  "หางานสระบุรี งานด่วน รายวัน รายเดือน ไม่ต้องมีประสบการณ์ รับสมัครด่วนมาก",
  "งานพาร์ทไทม์ กรุงเทพฯ นักศึกษา ทำงานที่บ้าน",
  "หางานโปรแกรมเมอร์ Thailand Developer Jobs Remote & Onsite Full-stack Backend",
  "(จ้างงาน&หางาน) Freelance ทั่วไทย",
  "หางานชลบุรี พัทยา ระยอง แหลมฉบัง อมตะนคร ปิ่นทอง เหมราช",
  "รับสมัครงาน รปภ. แม่บ้าน พนักงานทำความสะอาด ทั่วประเทศ",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-unbroken-name",
  "งานโรงงาน นิคมอุตสาหกรรม อยุธยา โรจนะ ไฮเทค บางปะอิน",
];

async function seed() {
  const draft = await request("/api/drafts", {
    method: "POST",
    body: JSON.stringify({
      workDate: "2026-10-24",
      slot: "evening",
      text: "รับสมัครพนักงานขายประจำสาขาสระบุรี เงินเดือน 15,000 บาทขึ้นไป พร้อมค่าคอมมิชชั่น สวัสดิการครบ ประกันสังคม สนใจทักแชทหรือโทร 08x-xxx-xxxx https://example.com/a-very-long-link-that-should-wrap-somewhere",
      status: "ready",
    }),
  });
  const groups = [];
  for (const [index, name] of longNames.entries()) {
    groups.push(
      await request("/api/groups", {
        method: "POST",
        body: JSON.stringify({
          name,
          url: `https://www.facebook.com/groups/${100000 + index}`,
          province: index % 3 === 0 ? "สระบุรี" : index % 3 === 1 ? "กรุงเทพมหานคร" : "",
          tags: index % 2 ? ["งานด่วน", "รายวัน", "พาร์ทไทม์", "ไม่ต้องมีประสบการณ์"] : [],
        }),
      }),
    );
  }
  await request("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      draftId: draft.id,
      groupIds: groups.map((group) => group.id),
      mode: "assisted",
      workflow: "hybrid-tabs",
      tabLimit: 4,
    }),
  });
  return { draft, groups };
}

/** Real run shape from the server, with targets spread over every status. */
function craftRuns(realRuns) {
  const statuses = [
    "published", "pending_review", "awaiting_confirmation", "manual_action_required",
    "preparing", "submitting", "failed", "skipped",
  ];
  const active = structuredClone(realRuns[0]);
  active.id = "audit-active";
  active.status = "running";
  active.targets = active.targets.map((target, index) => ({
    ...target,
    id: `audit-target-${index}`,
    status: statuses[index % statuses.length],
    message:
      index % 2
        ? "กดโพสต์แล้ว แต่ระบบยังยืนยัน permalink ไม่ได้ กรุณาตรวจภาพหลักฐาน https://www.facebook.com/groups/123456789/permalink/987654321"
        : "พบพื้นที่สร้างโพสต์",
    evidencePath: index % 3 === 0 ? "evidence/fake.png" : null,
    permalink: index % 4 === 0 ? "https://www.facebook.com/groups/1/posts/2" : null,
  }));
  const done = structuredClone(realRuns[0]);
  done.id = "audit-done";
  done.status = "completed";
  done.mode = "dry-run";
  done.targets = done.targets.map((target, index) => ({
    ...target,
    id: `audit-done-${index}`,
    status: "dry_run_ready",
    message: "พบพื้นที่สร้างโพสต์",
  }));
  return [active, done];
}

function craftPendingCleanup(groups) {
  return {
    id: "audit-cleanup",
    status: "scanned",
    scope: "known-pending",
    deleteMode: "all",
    olderThanDays: 7,
    groupsTotal: groups.length,
    groupsScanned: groups.length,
    groupsWithPending: 3,
    pendingFound: 17,
    deleteGroupsTotal: 0,
    deleteGroupsDone: 0,
    deletedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    message: "ตรวจครบแล้ว พบของค้าง 17 โพสต์ใน 3 กลุ่ม",
    snapshotPath: null,
    error: null,
    scopeCounts: { knownPending: 3, posted: 8, all: groups.length },
    groups: groups.slice(0, 4).map((group, index) => ({
      id: `audit-pending-group-${index}`,
      groupId: group.id,
      groupName: group.name,
      groupUrl: group.url + "/",
      pendingCount: index === 3 ? 0 : 5 + index,
      status: index === 2 ? "failed" : "scanned",
      selected: true,
      message: index === 2 ? "หน้าเว็บบอกว่ามีของค้างแต่ระบบอ่านการ์ดไม่เจอ ลองตรวจใหม่อีกครั้ง" : null,
      posts: Array.from({ length: 3 }, (_, postIndex) => ({
        id: `audit-post-${index}-${postIndex}`,
        status: ["found", "deleted", "failed"][postIndex],
        snippet: "รับสมัครพนักงานขายประจำสาขาสระบุรี เงินเดือน 15,000 บาทขึ้นไป พร้อมค่าคอมมิชชั่น",
        message: postIndex === 2 ? "กดยืนยันแล้วแต่โพสต์ยังอยู่" : null,
        evidencePath: postIndex === 1 ? "pending/fake.png" : null,
      })),
    })),
  };
}

const measure = () => {
  const viewport = document.documentElement.clientWidth;
  const problems = [];
  const describe = (element) => {
    const id = element.id ? `#${element.id}` : "";
    const cls = typeof element.className === "string" && element.className
      ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
    const text = (element.innerText || element.value || "").trim().replace(/\s+/g, " ").slice(0, 30);
    return `${element.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""}`;
  };
  if (document.documentElement.scrollWidth > viewport + 1) {
    problems.push(`page scrolls sideways (${document.documentElement.scrollWidth}px > ${viewport}px)`);
  }
  for (const element of document.querySelectorAll("body *")) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (element.closest("dialog:not([open]), [hidden]")) continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    // Inner sideways scrolling (e.g. a wide table in an overflow:auto box).
    if (
      ["auto", "scroll"].includes(style.overflowX) &&
      element.scrollWidth > element.clientWidth + 1 &&
      element.tagName !== "SELECT" &&
      element.tagName !== "TEXTAREA"
    ) {
      problems.push(`scrolls sideways inside: ${describe(element)} (${element.scrollWidth}>${element.clientWidth})`);
    }
    if (rect.right > viewport + 1 || rect.left < -1) {
      // Skip children of something already reported or clipped on purpose.
      let clipped = false;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent);
        if (parentStyle.overflowX !== "visible") {
          const parentRect = parent.getBoundingClientRect();
          if (parentRect.right <= viewport + 1 && parentRect.left >= -1) clipped = true;
          break;
        }
      }
      if (!clipped) {
        problems.push(`off-screen: ${describe(element)} (left ${Math.round(rect.left)}, right ${Math.round(rect.right)})`);
      }
    }
  }
  // Report only the outermost offender of each chain to keep the list readable.
  return [...new Set(problems)].slice(0, 12);
};

let browser;
let exitCode = 0;
try {
  await waitForServer();
  const { groups } = await seed();
  const runs = craftRuns(await request("/api/runs"));
  const cleanup = craftPendingCleanup(groups);

  browser = await chromium.launch({ headless: true });
  const report = {};
  for (const width of widths) {
    const touch = width < 1024;
    const context = await browser.newContext({
      viewport: { width, height: width < 768 ? 800 : 1000 },
      hasTouch: touch,
      isMobile: width < 768,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.route(`${baseUrl}/api/runs`, (route) =>
      route.request().method() === "GET" ? route.fulfill({ json: runs }) : route.continue(),
    );
    await page.route(`${baseUrl}/api/pending-cleanup`, (route) =>
      route.request().method() === "GET" ? route.fulfill({ json: cleanup }) : route.continue(),
    );
    for (const route of routes) {
      await page.goto(`${baseUrl}/#${route}`, { waitUntil: "networkidle" });
      await page.waitForFunction((name) => location.hash === `#${name}` && document.querySelector("#app > *:not(.loading-state)"), route);
      if (route === "groups") {
        for (let index = 0; index < 3; index += 1) {
          await page.locator(".group-check").nth(index).check();
        }
      }
      if (route === "pending") {
        const expand = page.locator('[data-action="expand-pending-group"]').first();
        if (await expand.count()) await expand.click();
      }
      await page.waitForTimeout(150);
      const problems = await page.evaluate(measure);
      if (problems.length) {
        report[`${width}px ${route}`] = problems;
        exitCode = 1;
      }
      if (shotsDirectory) {
        fs.mkdirSync(shotsDirectory, { recursive: true });
        await page.screenshot({ path: path.join(shotsDirectory, `${width}-${route}.png`), fullPage: true });
      }
    }
    await context.close();
  }
  if (exitCode) {
    console.log("Responsive audit found problems:");
    for (const [key, problems] of Object.entries(report)) {
      console.log(`\n[${key}]`);
      for (const problem of problems) console.log(`  - ${problem}`);
    }
  } else {
    console.log(`Responsive audit passed (${widths.length} widths x ${routes.length} pages)`);
  }
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await browser?.close();
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill();
  await exited;
  fs.rmSync(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(exitCode);
