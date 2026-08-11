import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { evidenceDirectory, timezone } from "./config.js";
import type { DraftRecord, GroupRecord, Slot } from "./types.js";

const composerLabels = [
  /เขียนอะไรบางอย่าง/i,
  /สร้างโพสต์/i,
  /write something/i,
  /create (?:a )?post/i,
];
const postButtonLabels = [/^โพสต์$/i, /^post$/i];
const facebookLoadTimeoutMs = Number(process.env.HR_AUTO_FACEBOOK_LOAD_TIMEOUT_MS || 45_000);
const pendingPhrases = [
  "รอการอนุมัติ",
  "อยู่ระหว่างรออนุมัติ",
  "pending approval",
  "submitted for approval",
  "post is pending",
];

export class SecurityCheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityCheckpointError";
  }
}

const securityPattern =
  /log in|เข้าสู่ระบบ|checkpoint|security check|ตรวจสอบความปลอดภัย|captcha|account restricted|ถูกจำกัดการใช้งาน|ยืนยันตัวตน|ยืนยันบัญชี|suspicious activity/i;

export async function checkSecurityCheckpoint(page: Page): Promise<void> {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (securityPattern.test(bodyText)) {
    throw new SecurityCheckpointError(
      "Facebook ต้องการให้ยืนยันตัวตน (Security Check/CAPTCHA/Checkpoint) หรือบัญชีถูกจำกัดการใช้งาน",
    );
  }
}

export interface PreparedPost {
  page: Page;
  dialog: Locator;
  postButton: Locator;
}

export interface AutomationCheck {
  ready: boolean;
  message: string;
}

function safeName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
}

function bangkokTimestamp(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}-${pick(
    "minute",
  )}-${pick("second")}+07-00`;
}

async function firstVisible(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false)) return item;
    }
  }
  return null;
}

async function findComposer(page: Page): Promise<Locator | null> {
  const candidates: Locator[] = [];
  for (const label of composerLabels) {
    candidates.push(page.getByRole("button", { name: label }));
    candidates.push(page.getByText(label, { exact: false }));
  }
  candidates.push(page.locator('[role="button"]').filter({ hasText: /เขียนอะไร|Write something/i }));
  return firstVisible(candidates);
}

async function currentDialog(page: Page, timeoutMs = 15_000): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const dialogs = page.locator('[role="dialog"]');
    const count = await dialogs.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const dialog = dialogs.nth(index);
      if (await dialog.isVisible().catch(() => false)) return dialog;
    }
    await page.waitForTimeout(200);
  }
  throw new Error("เปิดหน้าต่างสร้างโพสต์แล้ว แต่ไม่พบกล่องข้อความ");
}

async function findTextbox(
  page: Page,
  dialog: Locator,
  timeoutMs = facebookLoadTimeoutMs,
): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const textbox = await firstVisible([
      dialog.locator('[contenteditable="true"][data-lexical-editor="true"]'),
      dialog.locator('[contenteditable="true"][role="textbox"]'),
      dialog.locator('[contenteditable="true"][aria-placeholder]'),
      dialog.getByRole("textbox"),
      dialog.locator("textarea"),
      dialog.locator('[contenteditable="true"]'),
    ]);
    if (textbox) return textbox;
    await page.waitForTimeout(200);
  }
  return null;
}

async function findPostButton(
  page: Page,
  dialog: Locator,
  timeoutMs = facebookLoadTimeoutMs,
): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidates: Locator[] = [];
    for (const label of postButtonLabels) {
      candidates.push(dialog.getByRole("button", { name: label, exact: true }));
    }
    const button = await firstVisible(candidates);
    if (button) return button;
    await page.waitForTimeout(200);
  }
  return null;
}

async function waitForUpload(dialog: Locator, expected: number): Promise<void> {
  if (!expected) return;
  await dialog
    .locator('img[src^="blob:"], img[src^="data:"], [aria-label*="Remove"], [aria-label*="ลบ"]')
    .first()
    .waitFor({ state: "visible", timeout: 45_000 })
    .catch(() => undefined);
}

async function waitForEnabledPostButton(
  page: Page,
  dialog: Locator,
  timeoutMs = 45_000,
): Promise<Locator | null> {
  const button = await findPostButton(page, dialog);
  if (!button) return null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await button.isDisabled().catch(() => true))) return button;
    await page.waitForTimeout(250);
  }
  return button;
}

export async function inspectGroup(page: Page, group: GroupRecord): Promise<AutomationCheck> {
  await page.goto(group.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1_500);
  const blockedText = await page.locator("body").innerText().catch(() => "");
  if (/content isn't available|ไม่สามารถใช้งานเนื้อหานี้|เข้าร่วมกลุ่ม/i.test(blockedText)) {
    return { ready: false, message: "เข้าถึงกลุ่มไม่ได้หรือยังไม่มีสิทธิ์โพสต์" };
  }
  const composer = await findComposer(page);
  return composer
    ? { ready: true, message: "พบพื้นที่สร้างโพสต์" }
    : { ready: false, message: "ไม่พบพื้นที่สร้างโพสต์ กรุณาตรวจสิทธิ์หรือหน้าจอ Facebook" };
}

export async function preparePost(
  page: Page,
  draft: DraftRecord,
  group: GroupRecord,
): Promise<PreparedPost> {
  await page.goto(group.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1_500);
  await checkSecurityCheckpoint(page);
  const composer = await findComposer(page);
  if (!composer) throw new Error("ไม่พบพื้นที่สร้างโพสต์ในกลุ่มนี้");
  await composer.click({ timeout: 15_000 });
  const dialog = await currentDialog(page);
  const textbox = await findTextbox(page, dialog);
  if (!textbox)
    throw new Error(
      `ไม่พบกล่องกรอกข้อความหลังรอ Facebook โหลด ${Math.round(facebookLoadTimeoutMs / 1000)} วินาที`,
    );
  await textbox.click();
  await textbox.fill(draft.text).catch(async () => {
    await textbox.focus();
    await page.keyboard.press("ControlOrMeta+A").catch(() => undefined);
    await page.keyboard.insertText(draft.text);
  });

  if (draft.media.length) {
    let fileInput = dialog.locator('input[type="file"]').first();
    if (!(await fileInput.count())) {
      const mediaButton = await firstVisible([
        dialog.getByRole("button", { name: /รูปภาพ|วิดีโอ|photo|video/i }),
        dialog.locator('[role="button"]').filter({ hasText: /รูปภาพ|วิดีโอ|photo|video/i }),
      ]);
      if (mediaButton) await mediaButton.click();
      fileInput = dialog.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: "attached", timeout: 15_000 }).catch(() => undefined);
    }
    if (!(await fileInput.count())) throw new Error("ไม่พบช่องอัปโหลดรูปภาพ");
    await fileInput.setInputFiles(draft.media.map((item) => item.storedPath));
    await waitForUpload(dialog, draft.media.length);
  }

  const postButton = await waitForEnabledPostButton(page, dialog);
  if (!postButton) throw new Error("เตรียมโพสต์แล้ว แต่ไม่พบปุ่มโพสต์");
  if (await postButton.isDisabled().catch(() => false)) {
    throw new Error("ปุ่มโพสต์ยังไม่พร้อม อาจกำลังอัปโหลดรูปหรือกลุ่มต้องการข้อมูลเพิ่มเติม");
  }
  await checkSecurityCheckpoint(page);
  return { page, dialog, postButton };
}

export async function submitPreparedPost(prepared: PreparedPost): Promise<{
  status: "published" | "pending_review" | "manual_action_required";
  message: string;
  permalink: string | null;
}> {
  await prepared.postButton.click({ timeout: 15_000 });
  await prepared.dialog.waitFor({ state: "hidden", timeout: 45_000 }).catch(() => undefined);
  await prepared.page.waitForTimeout(2_000);
  await checkSecurityCheckpoint(prepared.page);
  const bodyText = (await prepared.page.locator("body").innerText().catch(() => "")).toLowerCase();
  if (pendingPhrases.some((phrase) => bodyText.includes(phrase))) {
    return {
      status: "pending_review",
      message: "ส่งโพสต์แล้วและกำลังรอผู้ดูแลกลุ่มอนุมัติ",
      permalink: null,
    };
  }
  const rawPermalink = await prepared.page
    .locator('a[href*="/posts/"], a[href*="/permalink/"]')
    .first()
    .getAttribute("href")
    .catch(() => null);
  const permalink = rawPermalink
    ? new URL(rawPermalink, prepared.page.url()).href
    : null;
  return {
    status: permalink ? "published" : "manual_action_required",
    message: permalink
      ? "โพสต์แล้วและพบลิงก์หลักฐาน"
      : "กดโพสต์แล้ว แต่ระบบยังยืนยัน permalink ไม่ได้ กรุณาตรวจภาพหลักฐาน",
    permalink,
  };
}

export async function captureEvidence(input: {
  page: Page;
  workDate: string;
  slot: Slot;
  runId: string;
  groupName: string;
  suffix: string;
  postText?: string;
}): Promise<string> {
  if (input.page.isClosed()) {
    throw new Error("ไม่สามารถเก็บหลักฐานได้ เพราะแท็บถูกปิดหรือ Chromium หยุดทำงาน");
  }
  const folder = path.join(evidenceDirectory, input.workDate, input.slot, input.runId);
  fs.mkdirSync(folder, { recursive: true });
  const fileName = `${bangkokTimestamp()}__${safeName(input.groupName) || "group"}__${safeName(
    input.suffix,
  )}.png`;
  const absolutePath = path.join(folder, fileName);
  const snippet = input.postText?.trim().slice(0, 60);
  if (snippet) {
    const post = input.page
      .locator('[role="article"]')
      .filter({ hasText: snippet })
      .first();
    if (await post.isVisible().catch(() => false)) {
      await post.screenshot({ path: absolutePath, timeout: 10_000 });
      return absolutePath;
    }
  }
  await input.page.screenshot({
    path: absolutePath,
    fullPage: false,
    timeout: 10_000,
  });
  return absolutePath;
}
