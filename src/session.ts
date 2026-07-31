import { chromium, type BrowserContext, type Page } from "playwright";
import { browserProfileDirectory } from "./config.js";
import type { SessionStatus } from "./types.js";

class BrowserSessionManager {
  private context: BrowserContext | null = null;

  private async requireContext(): Promise<BrowserContext> {
    if (!this.context) await this.launch();
    if (!this.context) throw new Error("ไม่สามารถเปิด Browser session ได้");
    return this.context;
  }

  async launch(): Promise<SessionStatus> {
    if (this.context) return this.status();
    const headless = process.env.HR_AUTO_HEADLESS === "true";
    this.context = await chromium.launchPersistentContext(browserProfileDirectory, {
      headless,
      viewport: null,
      args: headless
        ? ["--disable-notifications"]
        : ["--start-maximized", "--disable-notifications"],
      locale: process.env.HR_AUTO_LOCALE || "th-TH",
    });
    this.context.once("close", () => {
      this.context = null;
    });
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
      return {
        browserOpen: false,
        authenticated: false,
        url: null,
        accountIdMasked: null,
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
      };
    } catch {
      this.context = null;
      return {
        browserOpen: false,
        authenticated: false,
        url: null,
        accountIdMasked: null,
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
    await context?.close().catch(() => undefined);
  }
}

export const browserSession = new BrowserSessionManager();
