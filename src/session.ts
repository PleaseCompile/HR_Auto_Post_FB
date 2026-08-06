import fs from "node:fs";
import {
  chromium,
  type BrowserContext,
  type Page,
  type Request,
} from "playwright";
import {
  browserEventLogPath,
  browserProfileDirectory,
  browserSessionLockPath,
} from "./config.js";
import type { SessionStatus } from "./types.js";

interface SessionLock {
  pid: number;
  startedAt: string;
  profile: string;
}

const MAX_EVENT_LOG_BYTES = 5 * 1024 * 1024;

class BrowserSessionManager {
  private context: BrowserContext | null = null;
  private launchPromise: Promise<SessionStatus> | null = null;
  private ownsProfileLock = false;
  private closingIntentionally = false;
  private observedPages = new WeakSet<Page>();
  private crashCount = 0;
  private pageErrorCount = 0;
  private lastError: string | null = null;
  private lastEventAt: string | null = null;

  constructor() {
    process.once("exit", () => this.releaseProfileLockSync());
  }

  private isPidRunning(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  private readProfileLock(): SessionLock | null {
    try {
      const value = JSON.parse(
        fs.readFileSync(browserSessionLockPath, "utf8"),
      ) as Partial<SessionLock>;
      if (!Number.isInteger(value.pid) || !value.startedAt) return null;
      return {
        pid: Number(value.pid),
        startedAt: String(value.startedAt),
        profile: String(value.profile || browserProfileDirectory),
      };
    } catch {
      return null;
    }
  }

  private acquireProfileLock(): void {
    if (this.ownsProfileLock) return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = fs.openSync(browserSessionLockPath, "wx");
        const lock: SessionLock = {
          pid: process.pid,
          startedAt: new Date().toISOString(),
          profile: browserProfileDirectory,
        };
        fs.writeFileSync(handle, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
        fs.closeSync(handle);
        this.ownsProfileLock = true;
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = this.readProfileLock();
        if (
          existing?.pid &&
          existing.pid !== process.pid &&
          this.isPidRunning(existing.pid)
        ) {
          throw new Error(
            `Browser profile กำลังถูกใช้งานโดย HR Auto อีกหน้าต่าง (PID ${existing.pid}) กรุณาปิดหน้าต่างนั้นหรือกด “ปิด Browser” ก่อน`,
          );
        }
        fs.rmSync(browserSessionLockPath, { force: true });
      }
    }
    throw new Error("ไม่สามารถจอง Browser profile สำหรับ HR Auto ได้");
  }

  private releaseProfileLockSync(): void {
    if (!this.ownsProfileLock) return;
    const existing = this.readProfileLock();
    if (!existing || existing.pid === process.pid) {
      fs.rmSync(browserSessionLockPath, { force: true });
    }
    this.ownsProfileLock = false;
  }

  private rotateEventLog(): void {
    try {
      if (fs.statSync(browserEventLogPath).size <= MAX_EVENT_LOG_BYTES) return;
      const previousPath = `${browserEventLogPath}.previous`;
      fs.rmSync(previousPath, { force: true });
      fs.renameSync(browserEventLogPath, previousPath);
    } catch {
      // The log does not exist yet or rotation is not required.
    }
  }

  private logEvent(
    event: string,
    details: Record<string, unknown> = {},
  ): void {
    const timestamp = new Date().toISOString();
    this.lastEventAt = timestamp;
    const record = {
      timestamp,
      event,
      pid: process.pid,
      ...details,
    };
    try {
      fs.appendFileSync(browserEventLogPath, `${JSON.stringify(record)}\n`, "utf8");
    } catch {
      // Browser operation must continue even if diagnostic logging is unavailable.
    }
  }

  private failedDocumentDetails(request: Request): Record<string, unknown> {
    return {
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      failure: request.failure()?.errorText || null,
    };
  }

  private observePage(page: Page): void {
    if (this.observedPages.has(page)) return;
    this.observedPages.add(page);
    this.logEvent("page_opened", { url: page.url() });
    page.on("crash", () => {
      this.crashCount += 1;
      this.lastError = "แท็บ Chromium หยุดทำงาน (renderer crashed)";
      this.logEvent("page_crashed", { url: page.url() });
    });
    page.on("pageerror", (error) => {
      this.pageErrorCount += 1;
      this.lastError = `JavaScript ในหน้าเว็บผิดพลาด: ${error.message}`;
      this.logEvent("page_error", { url: page.url(), message: error.message });
    });
    page.on("requestfailed", (request) => {
      if (request.resourceType() !== "document") return;
      this.lastError =
        request.failure()?.errorText || "การโหลดเอกสารหลักของหน้าเว็บไม่สำเร็จ";
      this.logEvent("document_request_failed", this.failedDocumentDetails(request));
    });
    page.on("close", () => {
      this.logEvent("page_closed", { url: page.url() });
    });
  }

  private observeContext(context: BrowserContext): void {
    context.pages().forEach((page) => this.observePage(page));
    context.on("page", (page) => this.observePage(page));
    context.on("weberror", (webError) => {
      this.pageErrorCount += 1;
      this.lastError = `Web error: ${webError.error().message}`;
      this.logEvent("web_error", {
        message: webError.error().message,
        url: webError.page()?.url() || null,
      });
    });
    context.once("close", () => {
      if (!this.closingIntentionally) {
        this.lastError = "Browser context ปิดโดยไม่คาดคิด";
        this.logEvent("context_closed_unexpectedly");
      } else {
        this.logEvent("context_closed");
      }
      this.context = null;
      this.closingIntentionally = false;
      this.releaseProfileLockSync();
    });
  }

  private async requireContext(): Promise<BrowserContext> {
    if (!this.context) await this.launch();
    if (!this.context) throw new Error("ไม่สามารถเปิด Browser session ได้");
    return this.context;
  }

  async launch(): Promise<SessionStatus> {
    if (this.context) return this.status();
    if (this.launchPromise) return this.launchPromise;
    this.launchPromise = this.launchInternal();
    try {
      return await this.launchPromise;
    } finally {
      this.launchPromise = null;
    }
  }

  private async launchInternal(): Promise<SessionStatus> {
    this.acquireProfileLock();
    this.rotateEventLog();
    this.lastError = null;
    this.logEvent("session_launching", { profile: browserProfileDirectory });
    const headless = process.env.HR_AUTO_HEADLESS === "true";
    try {
      this.context = await chromium.launchPersistentContext(browserProfileDirectory, {
        headless,
        viewport: null,
        args: headless
          ? ["--disable-notifications"]
          : ["--start-maximized", "--disable-notifications"],
        locale: process.env.HR_AUTO_LOCALE || "th-TH",
      });
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "ไม่สามารถเปิด Chromium ได้";
      this.lastError = /profile is already in use|existing browser session/i.test(
        rawMessage,
      )
        ? "พบ Chromium เดิมค้างและกำลังใช้ browser-profile ของ HR Auto กรุณาปิด Chromium ของ HR Auto เดิมแล้วลองใหม่"
        : rawMessage;
      this.logEvent("session_launch_failed", { message: this.lastError });
      this.releaseProfileLockSync();
      throw new Error(this.lastError);
    }
    this.observeContext(this.context);
    this.logEvent("session_launched");
    const page = this.context.pages()[0] || (await this.context.newPage());
    if (!page.url() || page.url() === "about:blank") {
      await page.goto(
        process.env.HR_AUTO_SESSION_HOME_URL || "https://www.facebook.com/",
        {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        },
      );
    }
    await page.bringToFront();
    return this.status();
  }

  async status(): Promise<SessionStatus> {
    if (!this.context) {
      const lock = this.readProfileLock();
      const lockedByOtherProcess = Boolean(
        lock?.pid && lock.pid !== process.pid && this.isPidRunning(lock.pid),
      );
      return {
        browserOpen: false,
        authenticated: false,
        url: null,
        accountIdMasked: null,
        pageCount: 0,
        profileLocked: lockedByOtherProcess,
        ownerPid: lockedByOtherProcess ? lock?.pid || null : null,
        crashCount: this.crashCount,
        pageErrorCount: this.pageErrorCount,
        lastError: this.lastError,
        lastEventAt: this.lastEventAt,
      };
    }
    try {
      const cookies = await this.context.cookies("https://www.facebook.com/");
      const accountCookie = cookies.find((cookie) => cookie.name === "c_user");
      const page = this.context.pages()[0];
      const value = accountCookie?.value;
      return {
        browserOpen: true,
        authenticated: Boolean(value),
        url: page?.url() || null,
        accountIdMasked: value
          ? `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`
          : null,
        pageCount: this.context.pages().filter((item) => !item.isClosed()).length,
        profileLocked: true,
        ownerPid: process.pid,
        crashCount: this.crashCount,
        pageErrorCount: this.pageErrorCount,
        lastError: this.lastError,
        lastEventAt: this.lastEventAt,
      };
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : "ตรวจสอบ Browser session ไม่สำเร็จ";
      this.context = null;
      this.releaseProfileLockSync();
      return {
        browserOpen: false,
        authenticated: false,
        url: null,
        accountIdMasked: null,
        pageCount: 0,
        profileLocked: false,
        ownerPid: null,
        crashCount: this.crashCount,
        pageErrorCount: this.pageErrorCount,
        lastError: this.lastError,
        lastEventAt: this.lastEventAt,
      };
    }
  }

  async page(): Promise<Page> {
    const context = await this.requireContext();
    const pages = context.pages();
    const page = pages.find((candidate) => candidate.url().includes("facebook.com")) || pages[0];
    return page || context.newPage();
  }

  async newPage(): Promise<Page> {
    return (await this.requireContext()).newPage();
  }

  async newWindow(): Promise<Page> {
    const context = await this.requireContext();
    const source = context.pages()[0] || (await context.newPage());
    const cdp = await context.newCDPSession(source);
    try {
      const pagePromise = context.waitForEvent("page", { timeout: 15_000 });
      await cdp.send("Target.createTarget", {
        url: "about:blank",
        newWindow: true,
        background: false,
      });
      const page = await pagePromise;
      await page.bringToFront();
      return page;
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  }

  async newPageInWindow(anchor: Page): Promise<Page> {
    const context = await this.requireContext();
    if (anchor.isClosed()) throw new Error("หน้าต่าง Chrome สำหรับชุดนี้ถูกปิดแล้ว");
    await anchor.bringToFront();
    const cdp = await context.newCDPSession(anchor);
    try {
      const pagePromise = context.waitForEvent("page", { timeout: 15_000 });
      await cdp.send("Target.createTarget", {
        url: "about:blank",
        newWindow: false,
        background: false,
      });
      return await pagePromise;
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    const context = this.context;
    this.context = null;
    this.closingIntentionally = true;
    await context?.close().catch(() => undefined);
    this.closingIntentionally = false;
    this.releaseProfileLockSync();
  }
}

export const browserSession = new BrowserSessionManager();
