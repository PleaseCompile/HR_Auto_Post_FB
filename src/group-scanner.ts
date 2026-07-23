import fs from "node:fs";
import path from "node:path";
import { browserSession } from "./session.js";
import type { Page } from "playwright";
import { groupScanDirectory } from "./config.js";
import {
  createGroupScanRun,
  getLatestGroupScanRun,
  updateGroupScanRun,
  upsertScannedGroup,
} from "./db.js";
import type { GroupScanState } from "./types.js";

interface ScanCandidate {
  name: string;
  url: string;
  externalId: string;
}

interface ScanOptions {
  maxScrolls: number;
  pauseMs: number;
  idleRounds: number;
}

const excludedGroupRoutes = [
  "feed",
  "joins",
  "discover",
  "create",
  "notifications",
  "for_you",
  "categories",
  "search",
];

function emptyState(): GroupScanState {
  return {
    id: null,
    status: "idle",
    startedAt: null,
    finishedAt: null,
    foundCount: 0,
    newCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    scrollCount: 0,
    message: "พร้อมสแกนเมื่อคุณต้องการเพิ่มกลุ่ม",
    snapshotPath: null,
    error: null,
  };
}

function fileTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

export async function extractVisibleGroups(page: Page): Promise<ScanCandidate[]> {
  return page.evaluate(
    ({ excluded }) => {
      const generic = /^(view group|visit group|ดูกลุ่ม|เข้าชมกลุ่ม|joined|เข้าร่วมแล้ว|see more|ดูเพิ่มเติม)$/i;
      const clean = (value: string | null | undefined) =>
        (value || "").replace(/\s+/g, " ").trim();
      const output: Array<{ name: string; url: string; externalId: string }> = [];
      const anchors = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[href*="/groups/"]'),
      );
      for (const anchor of anchors) {
        if (!anchor.getClientRects().length) continue;
        let parsed: URL;
        try {
          parsed = new URL(anchor.href, location.href);
        } catch {
          continue;
        }
        if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) continue;
        const segments = parsed.pathname.split("/").filter(Boolean);
        if (segments[0] !== "groups" || !segments[1] || segments.length > 2) continue;
        const externalId = segments[1];
        if (excluded.includes(externalId.toLowerCase())) continue;

        const nameCandidates: string[] = [
          clean(anchor.innerText),
          clean(anchor.getAttribute("aria-label")),
          clean(anchor.getAttribute("title")),
          clean(anchor.querySelector("img")?.getAttribute("alt")),
        ];
        let parent: HTMLElement | null = anchor.parentElement;
        for (let depth = 0; parent && depth < 5; depth += 1) {
          const lines = (parent.innerText || "")
            .split("\n")
            .map(clean)
            .filter(Boolean);
          nameCandidates.push(...lines.slice(0, 4));
          if (parent.innerText.length > 800) break;
          parent = parent.parentElement;
        }
        const name =
          nameCandidates.find(
            (item) =>
              item.length >= 2 &&
              item.length <= 220 &&
              !generic.test(item) &&
              !/members?|สมาชิก|last visited|เยี่ยมชมล่าสุด/i.test(item),
          ) || "";
        if (!name) continue;
        output.push({
          name,
          externalId,
          url: `https://www.facebook.com/groups/${externalId}/`,
        });
      }
      return output;
    },
    { excluded: excludedGroupRoutes },
  );
}

class GroupScanner {
  private current: GroupScanState = getLatestGroupScanRun() || emptyState();
  private stopRequested = false;

  status(): GroupScanState {
    return { ...this.current };
  }

  isBusy(): boolean {
    return this.current.status === "running" || this.current.status === "stopping";
  }

  async start(options: Partial<ScanOptions> = {}): Promise<GroupScanState> {
    if (this.isBusy()) throw new Error("กำลังสแกนกลุ่มอยู่แล้ว");
    const session = await browserSession.status();
    if (!session.authenticated) {
      throw new Error("กรุณาเชื่อมต่อและล็อกอิน Facebook ก่อนเริ่มสแกน");
    }
    const stored = createGroupScanRun();
    this.current = {
      ...stored,
      status: "running",
      message: "กำลังเปิดหน้ากลุ่มที่คุณเข้าร่วม",
    };
    this.stopRequested = false;
    const normalized: ScanOptions = {
      maxScrolls: Math.min(500, Math.max(10, options.maxScrolls || 250)),
      pauseMs: Math.min(3_000, Math.max(500, options.pauseMs || 1_100)),
      idleRounds: Math.min(15, Math.max(3, options.idleRounds || 6)),
    };
    void this.execute(normalized);
    return this.status();
  }

  stop(): GroupScanState {
    if (!this.isBusy()) throw new Error("ไม่มีการสแกนที่กำลังทำงาน");
    this.stopRequested = true;
    this.current.status = "stopping";
    this.current.message = "กำลังหยุดหลังจบรอบปัจจุบัน";
    this.persist();
    return this.status();
  }

  private persist(): void {
    if (!this.current.id) return;
    updateGroupScanRun(this.current.id, this.current);
  }

  private async execute(options: ScanOptions): Promise<void> {
    const page = await browserSession.newPage();
    const candidates = new Map<string, ScanCandidate>();
    let idleRounds = 0;
    let previousCount = 0;
    try {
      await page.goto("https://www.facebook.com/groups/joins/", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(1_500);
      const body = await page.locator("body").innerText().catch(() => "");
      if (/log in|เข้าสู่ระบบ|checkpoint|security check|ตรวจสอบความปลอดภัย/i.test(body)) {
        throw new Error("Facebook ต้องการให้ยืนยันการล็อกอินหรือผ่าน Security Check");
      }

      for (let round = 0; round < options.maxScrolls; round += 1) {
        if (this.stopRequested) break;
        const visible = await extractVisibleGroups(page);

        for (const item of visible) {
          const current = candidates.get(item.externalId);
          if (!current || item.name.length < current.name.length) {
            candidates.set(item.externalId, item);
          }
        }

        this.current.foundCount = candidates.size;
        this.current.scrollCount = round + 1;
        this.current.message = `พบ ${candidates.size.toLocaleString()} กลุ่ม · กำลังเลื่อนรอบที่ ${
          round + 1
        }`;

        if (candidates.size === previousCount) idleRounds += 1;
        else idleRounds = 0;
        previousCount = candidates.size;
        this.persist();
        if (idleRounds >= options.idleRounds) break;

        await page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight);
          const scrollables = Array.from(document.querySelectorAll<HTMLElement>("div"))
            .filter((item) => item.scrollHeight > item.clientHeight + 300)
            .sort((a, b) => b.scrollHeight - a.scrollHeight)
            .slice(0, 3);
          for (const item of scrollables) item.scrollTop = item.scrollHeight;
        });
        await page.waitForTimeout(options.pauseMs);
      }

      if (!candidates.size) {
        const diagnosticPath = path.join(
          groupScanDirectory,
          `${fileTimestamp()}__no-groups-found.png`,
        );
        await page.screenshot({ path: diagnosticPath, fullPage: false });
        throw new Error(
          "ไม่พบลิงก์กลุ่มในหน้า Joined Groups โปรดตรวจหน้าต่าง Facebook และภาพ diagnostic",
        );
      }

      const scannedAt = new Date().toISOString();
      const results = [...candidates.values()]
        .sort((a, b) => a.name.localeCompare(b.name, "th"))
        .map((candidate) => {
          const result = upsertScannedGroup({ ...candidate, scannedAt });
          if (result.created) this.current.newCount += 1;
          else if (result.updated) this.current.updatedCount += 1;
          else this.current.unchangedCount += 1;
          return {
            ...candidate,
            databaseId: result.group.id,
            result: result.created ? "created" : result.updated ? "updated" : "unchanged",
          };
        });

      const snapshotPath = path.join(
        groupScanDirectory,
        `${fileTimestamp()}__joined-groups.json`,
      );
      fs.writeFileSync(
        snapshotPath,
        `${JSON.stringify(
          {
            scanId: this.current.id,
            sourceUrl: page.url(),
            startedAt: this.current.startedAt,
            finishedAt: scannedAt,
            stoppedByUser: this.stopRequested,
            counts: {
              found: results.length,
              created: this.current.newCount,
              updated: this.current.updatedCount,
              unchanged: this.current.unchangedCount,
            },
            groups: results,
          },
          null,
          2,
        )}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      this.current.status = "completed";
      this.current.finishedAt = scannedAt;
      this.current.snapshotPath = snapshotPath;
      this.current.message = this.stopRequested
        ? `หยุดตามคำขอและบันทึก ${results.length} กลุ่มที่พบแล้ว`
        : `สแกนเสร็จ พบ ${results.length} กลุ่ม`;
      this.current.error = null;
      this.persist();
    } catch (error) {
      this.current.status = "failed";
      this.current.finishedAt = new Date().toISOString();
      this.current.error =
        error instanceof Error ? error.message : "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
      this.current.message = "สแกนไม่สำเร็จ";
      this.persist();
    } finally {
      await page.close().catch(() => undefined);
      this.stopRequested = false;
    }
  }
}

export const groupScanner = new GroupScanner();
