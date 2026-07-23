import { spawn } from "node:child_process";
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const externalUrl = process.env.HR_AUTO_URL;
const port = 4175;
const baseUrl = externalUrl || `http://127.0.0.1:${port}`;
const outputDirectory = path.resolve("test-results");
fs.mkdirSync(outputDirectory, { recursive: true });

let testServer = null;
if (!externalUrl) {
  testServer = spawn(process.execPath, ["dist/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HR_AUTO_DATA_DIR: path.join(outputDirectory, `ui-${Date.now()}`),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) break;
    } catch {
      // Server is still starting.
    }
    if (attempt === 29) throw new Error("UI smoke server did not start");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "ภาพรวมวันนี้" }).waitFor();
  await page.screenshot({
    path: path.join(outputDirectory, "dashboard.png"),
    fullPage: true,
  });

  await page.locator('[data-route="compose"]').click();
  await page.getByRole("heading", { name: "สร้างและเตรียมโพสต์" }).waitFor();
  await page
    .getByPlaceholder(/ใส่รายละเอียดตำแหน่งงาน/)
    .fill("ทดสอบ Preview สำหรับ HR Auto");
  await page.getByText("ทดสอบ Preview สำหรับ HR Auto").last().waitFor();
  await page.screenshot({
    path: path.join(outputDirectory, "compose.png"),
    fullPage: true,
  });

  await page.locator('[data-route="groups"]').click();
  await page.getByRole("heading", { name: "คลังกลุ่ม", exact: true }).waitFor();
  await page.getByRole("button", { name: "สแกนจาก Facebook" }).click();
  await page.getByRole("heading", { name: "Automatic Group Scan" }).waitFor();
  if (!(await page.getByRole("button", { name: "เริ่มสแกน" }).isDisabled())) {
    throw new Error("Scan start should be disabled without a Facebook session");
  }
  await page.screenshot({
    path: path.join(outputDirectory, "group-scan.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "ยกเลิก" }).click();
  await page.screenshot({
    path: path.join(outputDirectory, "groups.png"),
    fullPage: true,
  });

  if (consoleErrors.length) {
    throw new Error(`Browser console errors:\n${consoleErrors.join("\n")}`);
  }
  console.log("UI smoke test passed");
} finally {
  await browser?.close();
  testServer?.kill("SIGTERM");
}
