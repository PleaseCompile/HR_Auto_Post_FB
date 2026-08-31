import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { pendingCleanupDirectory, timezone } from "./config.js";
import { checkSecurityCheckpoint, SecurityCheckpointError } from "./facebook.js";
import { browserSession } from "./session.js";
import {
  addPendingCleanupGroups,
  createPendingCleanupRun,
  getLatestPendingCleanupRun,
  listGroupsForPendingScope,
  listPendingCleanupGroups,
  listPendingCleanupPosts,
  replacePendingCleanupPosts,
  setPendingCleanupSelection,
  updatePendingCleanupGroup,
  updatePendingCleanupPost,
  updatePendingCleanupRun,
} from "./db.js";
import type {
  PendingCleanupGroupRecord,
  PendingCleanupScope,
  PendingCleanupState,
  PendingDeleteMode,
} from "./types.js";

/** One raw pending card lifted out of the DOM, keyed by the marker we stamped on it. */
export interface PendingCardSnapshot {
  marker: number;
  snippet: string;
  rawDate: string;
}

interface ScanOptions {
  scope: PendingCleanupScope;
  groupIds: string[];
  deleteMode: PendingDeleteMode;
  olderThanDays: number;
}

const SCAN_DELAY_MS = Math.max(
  0,
  Number(process.env.HR_AUTO_PENDING_SCAN_DELAY_MS ?? 1_500),
);
const DELETE_DELAY_MS = Math.max(
  0,
  Number(process.env.HR_AUTO_PENDING_DELETE_DELAY_MS ?? 2_500),
);
const PAGE_TIMEOUT_MS = Number(
  process.env.HR_AUTO_FACEBOOK_LOAD_TIMEOUT_MS || 45_000,
);
const CONFIRM_DIALOG_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.HR_AUTO_PENDING_CONFIRM_TIMEOUT_MS ?? 10_000),
);

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const MARKER_ATTRIBUTE = "data-hrauto-pending";
const DELETE_ATTRIBUTE = "data-hrauto-pending-delete";

function safeName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function fileTimestamp(): string {
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
  )}-${pick("second")}`;
}

const englishMonths = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const thaiMonths = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

const thaiShortMonths = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

function monthIndexFrom(token: string): number | null {
  const lower = token.toLowerCase();
  const english = englishMonths.findIndex(
    (month) => month === lower || month.slice(0, 3) === lower.replace(/\.$/, ""),
  );
  if (english >= 0) return english;
  const thai = thaiMonths.findIndex((month) => token.startsWith(month));
  if (thai >= 0) return thai;
  const thaiShort = thaiShortMonths.findIndex((month) => token.startsWith(month));
  if (thaiShort >= 0) return thaiShort;
  return null;
}

/**
 * Facebook renders pending timestamps in a handful of shapes depending on age and
 * locale ("25 August at 08:33", "25 สิงหาคม", "3d", "Yesterday"). Anything we cannot
 * read confidently returns null so the age filter can skip the post instead of
 * guessing at it — deletions are irreversible.
 */
export function parsePendingDate(
  rawDate: string,
  now: Date = new Date(),
): Date | null {
  const value = rawDate.replace(/\s+/g, " ").trim();
  if (!value) return null;

  if (/^(just now|เมื่อสักครู่|ไม่กี่วินาที)/i.test(value)) return new Date(now);
  if (/^(yesterday|เมื่อวาน|เมื่อวานนี้)/i.test(value)) {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    return date;
  }

  // Spelled-out units come first so "5 March" cannot match the bare "m" branch, and
  // the single letters carry their own lookahead because \b does not fire after Thai
  // characters and would let "5 มีนาคม" read as five minutes.
  const relative = value.match(
    /^(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|นาที|ชั่วโมง|ชม\.?|สัปดาห์|วัน|[mhdw](?![A-Za-z฀-๿]))/i,
  );
  if (relative) {
    const amount = Number(relative[1]);
    const unit = (relative[2] || "").toLowerCase();
    const date = new Date(now);
    if (/^(m|min|mins|minute|minutes|นาที)$/.test(unit)) {
      date.setMinutes(date.getMinutes() - amount);
    } else if (/^(h|hr|hrs|hour|hours|ชม\.?|ชั่วโมง)$/.test(unit)) {
      date.setHours(date.getHours() - amount);
    } else if (/^(d|day|days|วัน)$/.test(unit)) {
      date.setDate(date.getDate() - amount);
    } else {
      date.setDate(date.getDate() - amount * 7);
    }
    return date;
  }

  // "25 August at 08:33", "25 August 2025", "25 สิงหาคม 2025 เวลา 08:33"
  const dayFirst = value.match(
    /^(\d{1,2})\s+([^\s\d]+)\s*(\d{4})?(?:.*?(\d{1,2}):(\d{2}))?/,
  );
  // "August 25 at 08:33"
  const monthFirst = value.match(
    /^([^\s\d]+)\s+(\d{1,2})(?:,)?\s*(\d{4})?(?:.*?(\d{1,2}):(\d{2}))?/,
  );

  for (const [match, dayIndex, monthIndex] of [
    [dayFirst, 1, 2] as const,
    [monthFirst, 2, 1] as const,
  ]) {
    if (!match) continue;
    const dayToken = match[dayIndex];
    const monthToken = match[monthIndex];
    if (!dayToken || !monthToken) continue;
    const month = monthIndexFrom(monthToken);
    if (month === null) continue;
    const day = Number(dayToken);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;

    const yearToken = match[3];
    let year = yearToken ? Number(yearToken) : now.getFullYear();
    // Facebook renders Thai locale years in the Buddhist era.
    if (year > 2400) year -= 543;
    const hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const parsed = new Date(year, month, day, hour, minute, 0, 0);
    if (Number.isNaN(parsed.getTime())) continue;
    // A date with no year that lands in the future belongs to last year.
    if (!yearToken && parsed.getTime() > now.getTime() + 86_400_000) {
      parsed.setFullYear(parsed.getFullYear() - 1);
    }
    return parsed;
  }

  const native = new Date(value);
  return Number.isNaN(native.getTime()) ? null : native;
}

export function ageInDays(postedAt: Date | null, now: Date = new Date()): number | null {
  if (!postedAt) return null;
  return (now.getTime() - postedAt.getTime()) / 86_400_000;
}

/**
 * Stamps a marker on every pending post and returns what each one says.
 *
 * Facebook has no per-post container on this page: probing the live DOM showed the
 * action row ("Edit Delete") sitting as a SIBLING of the post body, with the nearest
 * shared ancestor already spanning every post on screen. So there is nothing to climb
 * to — the Delete button itself is the only reliable per-post anchor, and the body is
 * reached by stepping back to the previous sibling.
 */
export async function markPendingCards(page: Page): Promise<PendingCardSnapshot[]> {
  return page.evaluate(
    ({ markerAttribute, deleteAttribute }) => {
      const clean = (value: string | null | undefined) =>
        (value || "").replace(/\s+/g, " ").trim();
      // Some of these buttons carry their label only in aria-label; innerText is "".
      const labelOf = (element: Element) =>
        clean((element as HTMLElement).innerText) ||
        clean(element.getAttribute("aria-label"));
      const isDelete = (element: Element) => /^(delete|ลบ)$/i.test(labelOf(element));
      const isEdit = (element: Element) => /^(edit|แก้ไข)$/i.test(labelOf(element));
      const buttonsIn = (root: Element) =>
        Array.from(root.querySelectorAll<HTMLElement>('[role="button"], button'));

      for (const stale of Array.from(
        document.querySelectorAll(`[${markerAttribute}], [${deleteAttribute}]`),
      )) {
        stale.removeAttribute(markerAttribute);
        stale.removeAttribute(deleteAttribute);
      }

      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>('[role="button"], button'),
      ).filter((button) => {
        // Facebook renders a hidden duplicate of this button with a real 230x36 box,
        // so measuring alone is not enough — computed visibility decides which copy
        // can actually be clicked. `visibility` inherits, so this also rules out any
        // button sitting inside a hidden ancestor.
        const style = getComputedStyle(button);
        if (
          style.visibility === "hidden" ||
          style.display === "none" ||
          Number(style.opacity) === 0
        ) {
          return false;
        }
        const box = button.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          // A "Delete post?" modal carries its own Delete button.
          !button.closest('[role="dialog"]') &&
          isDelete(button)
        );
      });
      // role="button" nests inside role="button" here, so keep only the outer element
      // of any such pair — otherwise one post would be counted twice.
      const buttons = candidates.filter(
        (button) => !candidates.some((other) => other !== button && other.contains(button)),
      );

      const datePattern =
        /(\d{1,2}\s+\S+(\s+\d{4})?(\s+(at|เวลา)\s+\d{1,2}:\d{2})?|\S+\s+\d{1,2}(,)?(\s+\d{4})?(\s+at\s+\d{1,2}:\d{2})?|^\d+\s*(m|h|d|w|นาที|ชม\.?|วัน|สัปดาห์)\b|yesterday|เมื่อวาน)/i;

      return buttons.map((button, marker) => {
        button.setAttribute(deleteAttribute, String(marker));

        // Step 1: the action row — nearest ancestor that also holds this post's Edit.
        let row: HTMLElement | null = button.parentElement;
        for (let depth = 0; row && depth < 12; depth += 1) {
          if (buttonsIn(row).some(isEdit)) break;
          row = row.parentElement;
        }
        // Step 2: widen while the block is still nothing but those buttons.
        let block = row;
        while (
          block?.parentElement &&
          clean(block.parentElement.innerText).length < 200 &&
          block.parentElement !== document.body
        ) {
          block = block.parentElement;
        }
        // Step 3: the post body is what sits immediately before that block.
        let body: Element | null = block?.previousElementSibling || null;
        while (body && clean((body as HTMLElement).innerText).length < 20) {
          body = body.previousElementSibling;
        }

        const source = (body || block || button) as HTMLElement;
        // Screenshots and "is it gone yet" checks want the post, not the tiny button.
        source.setAttribute(markerAttribute, String(marker));

        let rawDate = "";
        for (const candidate of Array.from(
          source.querySelectorAll<HTMLElement>('a[href*="/posts/"], a[role="link"], abbr, span'),
        )) {
          const label =
            clean(candidate.getAttribute("aria-label")) ||
            clean(candidate.getAttribute("title")) ||
            clean(candidate.innerText);
          if (!label || label.length > 60) continue;
          if (datePattern.test(label)) {
            rawDate = label;
            break;
          }
        }

        const lines = clean(source.innerText)
          .split("\n")
          .map(clean)
          .filter(Boolean);
        const snippet =
          lines
            .filter(
              (line) =>
                line.length > 12 &&
                !/^(edit|delete|แก้ไข|ลบ|see more|ดูเพิ่มเติม|facebook)$/i.test(line),
            )
            .slice(0, 3)
            .join(" ") || clean(source.innerText).slice(0, 160);

        return { marker, snippet: snippet.slice(0, 300), rawDate };
      });
    },
    { markerAttribute: MARKER_ATTRIBUTE, deleteAttribute: DELETE_ATTRIBUTE },
  );
}

/**
 * Reads how many posts the page claims are pending. The sidebar lists Pending,
 * Published, Declined and Removed together and prints a number only for the rows that
 * have one, so the count has to be tied to the Pending label: a bare "N posts" match
 * picked up the Published total and reported an already-clean group as unreadable.
 */
async function readPendingHeaderCount(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const clean = (value: string | null | undefined) =>
      (value || "").replace(/\s+/g, " ").trim();
    const label = /(?:pending|รอ(?:การ)?อนุมัติ|รอดำเนินการ)/i;
    const scopes = Array.from(
      document.querySelectorAll<HTMLElement>('h1, h2, h3, [role="heading"], [role="navigation"] a, [role="tab"]'),
    );
    for (const scope of scopes) {
      if (!scope.getClientRects().length) continue;
      const text = clean(scope.innerText);
      const at = text.search(label);
      if (at < 0) continue;
      // Only read digits that follow the Pending label inside this one element.
      const match = text.slice(at).match(/^[^\d]{0,40}(\d+)/);
      if (match && match[1] !== undefined) return Number(match[1]);
    }
    return null;
  });
}


/**
 * Facebook streams the pending list in after the document is ready, so a fixed pause
 * regularly reads an empty page. This polls until a card, the empty state, or the
 * timeout shows up before anything tries to extract.
 */
export async function waitForPendingList(
  page: Page,
): Promise<"cards" | "empty" | "unknown"> {
  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const seen = await page
      .evaluate(() => {
        const clean = (value: string | null | undefined) =>
          (value || "").replace(/\s+/g, " ").trim();
        const cards = Array.from(
          document.querySelectorAll<HTMLElement>('[role="button"], button'),
        ).filter(
          (button) =>
            !button.closest('[role="dialog"]') &&
            /^(delete|ลบ)$/i.test(
              clean(button.innerText) || clean(button.getAttribute("aria-label")),
            ),
        ).length;
        // Wording taken from the live page: an empty queue renders "No posts to show".
        const empty =
          /no posts to show|no pending posts|nothing to show|ไม่มีโพสต์ที่จะแสดง|ไม่มีโพสต์ที่รอ|ยังไม่มีโพสต์|ไม่มีเนื้อหา/i.test(
            document.body.innerText || "",
          );
        return { cards, empty };
      })
      .catch(() => ({ cards: 0, empty: false }));
    if (seen.cards > 0) return "cards";
    if (seen.empty) return "empty";
    await page.waitForTimeout(600);
  }
  return "unknown";
}

/**
 * Clicks one card's Delete button, confirms Facebook's modal, and reports whether the
 * post actually left the page. Exported so tests can drive the same path the sweep uses.
 */
export async function deletePendingCard(
  page: Page,
  marker: number,
): Promise<{ removed: boolean; note: string }> {
  const button = page.locator(`[${DELETE_ATTRIBUTE}="${marker}"]`).first();
  const clickable = await button
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!clickable) {
    return { removed: false, note: "ไม่พบปุ่มลบบนโพสต์นี้แล้ว" };
  }
  await button.scrollIntoViewIfNeeded({ timeout: 8_000 }).catch(() => undefined);
  await button.click({ timeout: 15_000 });

  const confirmed = await confirmDeleteDialog(page);

  // The Delete button is the anchor that definitely belongs to this one post, so its
  // disappearance is the signal that the post is gone.
  const target = page.locator(`[${DELETE_ATTRIBUTE}="${marker}"]`).first();
  const removed = await target
    .waitFor({ state: "detached", timeout: 20_000 })
    .then(() => true)
    // Facebook sometimes leaves the node in place and only hides it.
    .catch(async () => !(await target.isVisible().catch(() => true)));

  await dismissOpenDialog(page);
  await page.waitForTimeout(500);
  await checkSecurityCheckpoint(page);
  return {
    removed,
    note: removed
      ? "ลบแล้ว"
      : confirmed
        ? "กดยืนยันในกล่อง Delete post? แล้วแต่โพสต์ยังอยู่ กรุณาตรวจด้วยตนเอง"
        : "กดลบแล้วแต่ไม่พบปุ่มยืนยันในกล่อง Delete post? กรุณาตรวจด้วยตนเอง",
  };
}

/**
 * Facebook answers the card's Delete with a "Delete post?" modal carrying Cancel and
 * Delete. The modal is rendered asynchronously, and `isVisible()` does NOT wait — it
 * reports the state right now — so this waits explicitly. Getting that wrong silently
 * skipped every confirmation and left the posts in place.
 */
async function confirmDeleteDialog(page: Page): Promise<boolean> {
  const confirm = page
    .locator(`[role="dialog"] :is([role="button"], button):not([${DELETE_ATTRIBUTE}])`)
    .filter({ hasText: /^\s*(delete|ลบ|confirm|ยืนยัน|ตกลง)\s*$/i })
    .last();
  const appeared = await confirm
    .waitFor({ state: "visible", timeout: CONFIRM_DIALOG_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return false;
  await confirm.click({ timeout: 10_000 }).catch(() => undefined);
  return true;
}

/** Leaves no modal behind: an open dialog would poison the next card scan. */
async function dismissOpenDialog(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"]').last();
  if (!(await dialog.isVisible().catch(() => false))) return;
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(400);
  if (!(await dialog.isVisible().catch(() => false))) return;
  const cancel = dialog
    .locator(':is([role="button"], button)')
    .filter({ hasText: /^\s*(cancel|ยกเลิก|ปิด)\s*$/i })
    .last();
  await cancel.click({ timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

class PendingCleaner {
  private current: PendingCleanupState =
    getLatestPendingCleanupRun() || this.emptyState();
  private stopRequested = false;

  private emptyState(): PendingCleanupState {
    return {
      id: null,
      status: "idle",
      scope: "known-pending",
      deleteMode: "all",
      olderThanDays: 7,
      startedAt: null,
      scanFinishedAt: null,
      finishedAt: null,
      groupsTotal: 0,
      groupsScanned: 0,
      groupsWithPending: 0,
      pendingFound: 0,
      deleteGroupsTotal: 0,
      deleteGroupsDone: 0,
      deletedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      message: "พร้อมตรวจหาโพสต์ที่ค้างรออนุมัติ",
      snapshotPath: null,
      error: null,
    };
  }

  status(withGroups = false): PendingCleanupState {
    // Always prefer the stored row: it carries progress written by the running
    // sweep and survives a restart, so the in-memory copy is only a fallback for
    // the very first run when no cleanup exists yet.
    const stored = getLatestPendingCleanupRun() || this.current;
    const state: PendingCleanupState = { ...stored };
    if (withGroups && state.id) {
      state.groups = listPendingCleanupGroups(state.id, {
        withPosts: true,
        onlyWithPending: false,
      });
    }
    return state;
  }

  isBusy(): boolean {
    return ["scanning", "stopping-scan", "deleting", "stopping-delete"].includes(
      this.current.status,
    );
  }

  isScanning(): boolean {
    return ["scanning", "stopping-scan"].includes(this.current.status);
  }

  async startScan(options: ScanOptions): Promise<PendingCleanupState> {
    if (this.isBusy()) throw new Error("การล้าง Pending กำลังทำงานอยู่แล้ว");
    const session = await browserSession.status();
    if (!session.authenticated) {
      throw new Error("กรุณาเชื่อมต่อและล็อกอิน Facebook ก่อนตรวจหาโพสต์ค้าง");
    }
    const groups = listGroupsForPendingScope(options.scope, options.groupIds);
    if (!groups.length) {
      throw new Error(
        "ไม่พบกลุ่มที่ตรงกับขอบเขตที่เลือก (กลุ่มต้องมี external_id จากการสแกนหรือ import)",
      );
    }

    const created = createPendingCleanupRun({
      scope: options.scope,
      deleteMode: options.deleteMode,
      olderThanDays: options.olderThanDays,
      groupsTotal: groups.length,
    });
    addPendingCleanupGroups(
      created.id!,
      groups.map((group) => ({
        groupId: group.id,
        externalId: group.externalId || "",
        name: group.name,
        url: group.url,
      })),
    );
    this.current = created;
    this.stopRequested = false;
    void this.executeScan();
    return this.status();
  }

  stopScan(): PendingCleanupState {
    if (!this.isScanning()) throw new Error("ไม่มีการตรวจที่กำลังทำงาน");
    this.stopRequested = true;
    this.patch({ status: "stopping-scan" });
    return this.status();
  }

  stopDelete(): PendingCleanupState {
    if (!["deleting", "stopping-delete"].includes(this.current.status)) {
      throw new Error("ไม่มีการลบที่กำลังทำงาน");
    }
    this.stopRequested = true;
    this.patch({ status: "stopping-delete" });
    return this.status();
  }

  select(groupIds: string[]): number {
    if (!this.current.id) throw new Error("ยังไม่มีผลการตรวจให้เลือก");
    if (this.isBusy()) throw new Error("กำลังทำงานอยู่ ไม่สามารถแก้รายการที่เลือกได้");
    return setPendingCleanupSelection(this.current.id, groupIds);
  }

  async startDelete(input: {
    deleteMode: PendingDeleteMode;
    olderThanDays: number;
    acknowledged: true;
  }): Promise<PendingCleanupState> {
    if (this.isBusy()) throw new Error("การล้าง Pending กำลังทำงานอยู่แล้ว");
    if (!this.current.id) throw new Error("ยังไม่มีผลการตรวจ กรุณาตรวจหาโพสต์ค้างก่อน");
    const session = await browserSession.status();
    if (!session.authenticated) {
      throw new Error("กรุณาเชื่อมต่อและล็อกอิน Facebook ก่อนเริ่มลบ");
    }
    const selected = listPendingCleanupGroups(this.current.id).filter(
      (group) => group.selected && group.pendingCount > 0,
    );
    if (!selected.length) {
      throw new Error("ยังไม่ได้เลือกกลุ่มที่ต้องการลบ");
    }
    this.patch({
      status: "deleting",
      deleteMode: input.deleteMode,
      olderThanDays: input.olderThanDays,
      deleteGroupsTotal: selected.length,
      deleteGroupsDone: 0,
      deletedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      finishedAt: null,
      error: null,
    });
    this.stopRequested = false;
    void this.executeDelete(selected);
    return this.status();
  }

  private patch(patch: Parameters<typeof updatePendingCleanupRun>[1]): void {
    if (!this.current.id) return;
    updatePendingCleanupRun(this.current.id, patch);
    const refreshed = getLatestPendingCleanupRun();
    if (refreshed && refreshed.id === this.current.id) this.current = refreshed;
  }

  private async executeScan(): Promise<void> {
    const cleanupId = this.current.id!;
    const page = await browserSession.newPage();
    let scanned = 0;
    let withPending = 0;
    let found = 0;
    try {
      const groups = listPendingCleanupGroups(cleanupId);
      for (const group of groups) {
        if (this.stopRequested) break;
        updatePendingCleanupGroup(group.id, {
          status: "scanning",
          message: "กำลังเปิดหน้าโพสต์ที่รออนุมัติ",
        });
        try {
          const result = await this.scanGroup(page, group);
          found += result.count;
          if (result.count > 0) withPending += 1;
          updatePendingCleanupGroup(group.id, {
            status: "scanned",
            pendingCount: result.count,
            selected: result.count > 0,
            scannedAt: new Date().toISOString(),
            message:
              result.count > 0
                ? `พบ ${result.count} โพสต์ค้างรออนุมัติ`
                : "ไม่มีโพสต์ค้าง",
          });
        } catch (error) {
          if (error instanceof SecurityCheckpointError) throw error;
          updatePendingCleanupGroup(group.id, {
            status: "failed",
            scannedAt: new Date().toISOString(),
            message:
              error instanceof Error ? error.message : "เปิดหน้ากลุ่มไม่สำเร็จ",
          });
        }
        scanned += 1;
        this.patch({
          groupsScanned: scanned,
          groupsWithPending: withPending,
          pendingFound: found,
        });
        if (!this.stopRequested && SCAN_DELAY_MS) await delay(SCAN_DELAY_MS);
      }

      const finishedAt = new Date().toISOString();
      const snapshotPath = this.writeSnapshot(cleanupId, "scan");
      this.patch({
        status: "scanned",
        scanFinishedAt: finishedAt,
        groupsScanned: scanned,
        groupsWithPending: withPending,
        pendingFound: found,
        snapshotPath,
        error: null,
      });
    } catch (error) {
      this.patch({
        status: "failed",
        finishedAt: new Date().toISOString(),
        error:
          error instanceof Error ? error.message : "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ",
      });
    } finally {
      await page.close().catch(() => undefined);
      this.stopRequested = false;
    }
  }

  private async scanGroup(
    page: Page,
    group: PendingCleanupGroupRecord,
  ): Promise<{ count: number }> {
    await page.goto(
      `https://www.facebook.com/groups/${group.externalId}/my_pending_content`,
      { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS },
    );
    await page.waitForTimeout(1_500);
    await checkSecurityCheckpoint(page);

    const listState = await this.waitForPendingList(page);
    if (listState === "empty") {
      replacePendingCleanupPosts(group.id, []);
      return { count: 0 };
    }

    await this.scrollPendingList(page);
    const cards = await markPendingCards(page);
    const headerCount = await readPendingHeaderCount(page);
    const now = new Date();

    replacePendingCleanupPosts(
      group.id,
      cards.map((card, index) => {
        const postedAt = parsePendingDate(card.rawDate, now);
        return {
          position: index,
          snippet: card.snippet,
          rawDate: card.rawDate,
          postedAt: postedAt ? postedAt.toISOString() : null,
          ageDays: ageInDays(postedAt, now),
        };
      }),
    );

    // The rendered cards are what we can actually act on, but a header that claims
    // pending posts while no card was parsed means the extractor missed them —
    // surface that instead of silently reporting the group as clean.
    if (!cards.length && headerCount !== null && headerCount > 0) {
      const diagnostic = await this.captureDiagnostic(page, group, "scan-no-cards");
      throw new Error(
        `หน้าบอกว่ามี ${headerCount} โพสต์ค้าง แต่ระบบอ่านการ์ดไม่ได้ · Facebook โหลดไม่ทันหรือเปลี่ยนหน้าจอ${
          diagnostic ? " · เก็บภาพหน้าจอไว้แล้ว" : ""
        }`,
      );
    }
    if (!cards.length && listState === "unknown") {
      const diagnostic = await this.captureDiagnostic(page, group, "scan-timeout");
      throw new Error(
        `รอโพสต์ค้างโหลดจนหมดเวลา ${Math.round(PAGE_TIMEOUT_MS / 1000)} วินาทีแล้วยังไม่ขึ้น${
          diagnostic ? " · เก็บภาพหน้าจอไว้แล้ว" : ""
        }`,
      );
    }
    return { count: cards.length };
  }

  private async waitForPendingList(
    page: Page,
  ): Promise<"cards" | "empty" | "unknown"> {
    return waitForPendingList(page);
  }

  private async scrollPendingList(page: Page): Promise<void> {
    const countCards = () =>
      page.evaluate(() => {
        const clean = (value: string | null | undefined) =>
          (value || "").replace(/\s+/g, " ").trim();
        return Array.from(
          document.querySelectorAll<HTMLElement>('[role="button"], button'),
        ).filter(
          (button) =>
            !button.closest('[role="dialog"]') &&
            /^(delete|ลบ)$/i.test(
              clean(button.innerText) || clean(button.getAttribute("aria-label")),
            ),
        ).length;
      });

    let previous = await countCards();
    for (let round = 0; round < 12; round += 1) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1_200);
      const count = await countCards();
      // A count that is still zero means the list has not arrived yet, never that it
      // has stopped growing — treating those as equal used to end the wait after one
      // round and hand an empty page to the extractor.
      if (count > 0 && count === previous) break;
      previous = count;
    }
  }

  private async executeDelete(
    selected: PendingCleanupGroupRecord[],
  ): Promise<void> {
    const cleanupId = this.current.id!;
    const page = await browserSession.newPage();
    let groupsDone = 0;
    let deleted = 0;
    let failed = 0;
    let skipped = 0;
    try {
      for (const group of selected) {
        if (this.stopRequested) break;
        updatePendingCleanupGroup(group.id, {
          status: "deleting",
          message: "กำลังเปิดหน้าเพื่อลบโพสต์ค้าง",
        });
        try {
          const result = await this.deleteGroupPending(page, group);
          deleted += result.deleted;
          failed += result.failed;
          skipped += result.skipped;
          updatePendingCleanupGroup(group.id, {
            status: "done",
            deletedCount: result.deleted,
            failedCount: result.failed,
            skippedCount: result.skipped,
            pendingCount: Math.max(0, group.pendingCount - result.deleted),
            message: `ลบ ${result.deleted} · ข้าม ${result.skipped} · ไม่สำเร็จ ${result.failed}`,
          });
        } catch (error) {
          if (error instanceof SecurityCheckpointError) throw error;
          failed += 1;
          updatePendingCleanupGroup(group.id, {
            status: "failed",
            message: error instanceof Error ? error.message : "ลบไม่สำเร็จ",
          });
        }
        groupsDone += 1;
        this.patch({
          deleteGroupsDone: groupsDone,
          deletedCount: deleted,
          failedCount: failed,
          skippedCount: skipped,
        });
      }

      const snapshotPath = this.writeSnapshot(cleanupId, "delete");
      this.patch({
        status: "completed",
        finishedAt: new Date().toISOString(),
        deleteGroupsDone: groupsDone,
        deletedCount: deleted,
        failedCount: failed,
        skippedCount: skipped,
        snapshotPath,
        error: null,
      });
    } catch (error) {
      this.patch({
        status: "failed",
        finishedAt: new Date().toISOString(),
        deletedCount: deleted,
        failedCount: failed,
        skippedCount: skipped,
        error:
          error instanceof Error ? error.message : "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ",
      });
    } finally {
      await page.close().catch(() => undefined);
      this.stopRequested = false;
    }
  }

  private async deleteGroupPending(
    page: Page,
    group: PendingCleanupGroupRecord,
  ): Promise<{ deleted: number; failed: number; skipped: number }> {
    await page.goto(
      `https://www.facebook.com/groups/${group.externalId}/my_pending_content`,
      { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS },
    );
    await page.waitForTimeout(1_500);
    await checkSecurityCheckpoint(page);
    const listState = await this.waitForPendingList(page);
    await this.scrollPendingList(page);

    // The scan said this group had posts, so an empty page here means the list never
    // rendered — reporting "done, 0 deleted" would look like success.
    if (listState !== "empty" && !(await markPendingCards(page)).length) {
      const diagnostic = await this.captureDiagnostic(page, group, "delete-no-cards");
      throw new Error(
        `เปิดหน้าแล้วแต่ไม่พบโพสต์ค้างให้ลบ (ตรวจเจอ ${group.pendingCount} โพสต์) · Facebook โหลดไม่ทัน${
          diagnostic ? " · เก็บภาพหน้าจอไว้แล้ว" : ""
        }`,
      );
    }

    const records = listPendingCleanupPosts(group.id);
    const mode = this.current.deleteMode;
    const olderThanDays = this.current.olderThanDays;
    const now = new Date();

    let deleted = 0;
    let failed = 0;
    let skipped = 0;
    // A deleted card leaves the DOM while a kept one stays, so the two indexes drift
    // apart: `cursor` is the DOM slot of the next unprocessed card (only kept posts
    // push it forward) and `recordIndex` walks the stored posts one per pass.
    let cursor = 0;
    let recordIndex = 0;

    for (let guard = 0; guard < 400; guard += 1) {
      if (this.stopRequested) break;
      const cards = await markPendingCards(page);
      if (cursor >= cards.length) break;
      const card = cards[cursor];
      if (!card) break;

      const postedAt = parsePendingDate(card.rawDate, now);
      const age = ageInDays(postedAt, now);
      const record = records[recordIndex];
      const keep = (message: string) => {
        skipped += 1;
        cursor += 1;
        recordIndex += 1;
        if (record) {
          updatePendingCleanupPost(record.id, { status: "skipped", message });
        }
      };

      if (mode === "older-than") {
        if (age === null) {
          keep(`อ่านวันที่ไม่ได้ (${card.rawDate || "ไม่พบวันที่"}) จึงไม่ลบ`);
          continue;
        }
        if (age < olderThanDays) {
          keep(`อายุ ${age.toFixed(1)} วัน ยังไม่ถึง ${olderThanDays} วัน`);
          continue;
        }
      }

      const evidencePath = await this.captureCard(page, group, card.marker).catch(
        () => null,
      );

      const outcome = await this.clickDelete(page, card.marker);
      recordIndex += 1;
      if (outcome.removed) {
        deleted += 1;
        if (record) {
          updatePendingCleanupPost(record.id, {
            status: "deleted",
            evidencePath,
            message: outcome.note,
          });
        }
      } else {
        failed += 1;
        cursor += 1;
        if (record) {
          updatePendingCleanupPost(record.id, {
            status: "failed",
            evidencePath,
            message: outcome.note,
          });
        }
      }

      if (!this.stopRequested && DELETE_DELAY_MS) await delay(DELETE_DELAY_MS);
    }

    return { deleted, failed, skipped };
  }

  /** Saves what the page actually showed so a parsing failure can be diagnosed later. */
  private async captureDiagnostic(
    page: Page,
    group: PendingCleanupGroupRecord,
    suffix: string,
  ): Promise<string | null> {
    try {
      const folder = path.join(
        pendingCleanupDirectory,
        this.current.id || "unknown",
        "diagnostics",
      );
      fs.mkdirSync(folder, { recursive: true });
      const base = `${fileTimestamp()}__${safeName(group.groupName) || group.externalId}__${suffix}`;
      await page.screenshot({
        path: path.join(folder, `${base}.png`),
        fullPage: false,
        timeout: 10_000,
      });
      const text = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      fs.writeFileSync(
        path.join(folder, `${base}.txt`),
        `${page.url()}

${text.slice(0, 20_000)}
`,
        { encoding: "utf8", mode: 0o600 },
      );
      return folder;
    } catch {
      return null;
    }
  }

  private async captureCard(
    page: Page,
    group: PendingCleanupGroupRecord,
    marker: number,
  ): Promise<string | null> {
    const folder = path.join(
      pendingCleanupDirectory,
      this.current.id || "unknown",
      safeName(group.groupName) || group.externalId,
    );
    fs.mkdirSync(folder, { recursive: true });
    const target = path.join(
      folder,
      `${fileTimestamp()}__pending-${marker}.png`,
    );
    const locator = page.locator(`[${MARKER_ATTRIBUTE}="${marker}"]`).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.screenshot({ path: target, timeout: 10_000 });
      return target;
    }
    // No post body was located; the viewport still records what was on screen.
    await page.screenshot({ path: target, fullPage: false, timeout: 10_000 });
    return target;
  }

  private async clickDelete(
    page: Page,
    marker: number,
  ): Promise<{ removed: boolean; note: string }> {
    return deletePendingCard(page, marker);
  }

  private writeSnapshot(cleanupId: string, phase: "scan" | "delete"): string | null {
    try {
      const groups = listPendingCleanupGroups(cleanupId, { withPosts: true });
      const folder = path.join(pendingCleanupDirectory, cleanupId);
      fs.mkdirSync(folder, { recursive: true });
      const target = path.join(folder, `${fileTimestamp()}__${phase}.json`);
      fs.writeFileSync(
        target,
        `${JSON.stringify(
          {
            cleanupId,
            phase,
            scope: this.current.scope,
            deleteMode: this.current.deleteMode,
            olderThanDays: this.current.olderThanDays,
            startedAt: this.current.startedAt,
            writtenAt: new Date().toISOString(),
            stoppedByUser: this.stopRequested,
            groups,
          },
          null,
          2,
        )}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      return target;
    } catch {
      return null;
    }
  }
}

export const pendingCleaner = new PendingCleaner();
