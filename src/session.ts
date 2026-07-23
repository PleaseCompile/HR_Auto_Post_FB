import { chromium, type BrowserContext, type Page } from "playwright";
import { browserProfileDirectory } from "./config.js";
import type { SessionStatus } from "./types.js";

class BrowserSessionManager {
  private context: BrowserContext | null = null;

  async launch(): Promise<SessionStatus> {
    if (this.context) return this.status();
    this.context = await chromium.launchPersistentContext(browserProfileDirectory, {
      headless: false,
      viewport: null,
      args: ["--start-maximized", "--disable-notifications"],
      locale: process.env.HR_AUTO_LOCALE || "th-TH",
    });
    this.context.once("close", () => {
      this.context = null;
    });
    const page = this.context.pages()[0] || (await this.context.newPage());
    if (!page.url() || page.url() === "about:blank") {
      await page.goto("https://www.facebook.com/", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
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
    if (!this.context) await this.launch();
    if (!this.context) throw new Error("ไม่สามารถเปิด Browser session ได้");
    const pages = this.context.pages();
    const page = pages.find((candidate) => candidate.url().includes("facebook.com")) || pages[0];
    return page || this.context.newPage();
  }

  async newPage(): Promise<Page> {
    if (!this.context) await this.launch();
    if (!this.context) throw new Error("ไม่สามารถเปิด Browser session ได้");
    return this.context.newPage();
  }

  async close(): Promise<void> {
    const context = this.context;
    this.context = null;
    await context?.close().catch(() => undefined);
  }
}

export const browserSession = new BrowserSessionManager();
