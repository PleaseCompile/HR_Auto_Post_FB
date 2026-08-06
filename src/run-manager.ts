import os from "node:os";
import type { Page } from "playwright";
import { browserSession } from "./session.js";
import {
  captureEvidence,
  inspectGroup,
  preparePost,
  submitPreparedPost,
  SecurityCheckpointError,
  type PreparedPost,
} from "./facebook.js";
import {
  getRun,
  markGroupPosted,
  updateRunStatus,
  updateTarget,
} from "./db.js";
import type {
  DraftRecord,
  RunRecord,
  RunTargetRecord,
  RunWorkflow,
} from "./types.js";

type UserAction = "confirm" | "skip" | "mark-posted";
type AwaitingAction = UserAction | "stop";

interface ActionRequest {
  action: AwaitingAction;
  reason?: string;
}

interface PendingPrepared {
  prepared: PreparedPost | null;
  page: Page;
  target: RunTargetRecord;
  draft: DraftRecord;
}

interface Controller {
  stopped: boolean;
  paused: boolean;
  autoConfirm: boolean;
  workflow: RunWorkflow;
  tabLimit: number;
  maximumTabLimit: number;
  consecutivePreparationFailures: number;
  consecutiveAutoConfirmFailures: number;
  stablePreparations: number;
  pressurePaused: boolean;
  waitingTargetId: string | null;
  resolveAction: ((request: ActionRequest) => void) | null;
  prepared: Map<string, PendingPrepared>;
  acting: Set<string>;
}

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const DEFAULT_HYBRID_TAB_LIMIT = 10;
const MAX_HYBRID_WINDOWS_TAB_LIMIT = 30;
const MAX_HYBRID_TABS_LIMIT = Number(process.env.HR_AUTO_MAX_HYBRID_TABS_LIMIT || 250);
const MIN_AVAILABLE_MEMORY_BYTES = 4 * 1024 * 1024 * 1024;
const MIN_AVAILABLE_MEMORY_RATIO = 0.12;
const PREPARATION_COOLDOWN_MS = Math.max(
  0,
  Number(process.env.HR_AUTO_PREPARE_DELAY_MS ?? 1_000),
);

function readableMemory(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function classifyAutomationError(
  error: unknown,
  rendererCrashed = false,
): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
  if (
    error instanceof SecurityCheckpointError ||
    /checkpoint|security check|captcha|log in|เข้าสู่ระบบ|ถูกจำกัดการใช้งาน|ยืนยันตัวตน|ยืนยันบัญชี/i.test(
      raw,
    )
  ) {
    return {
      code: "SECURITY_CHECKPOINT",
      message: "Facebook ต้องการให้ยืนยันตัวตน (Security Check/CAPTCHA/Checkpoint) หรือบัญชีถูกจำกัดการใช้งาน",
    };
  }
  if (rendererCrashed || /\bcrash(?:ed)?\b|page crashed/i.test(raw)) {
    return {
      code: "RENDERER_CRASHED",
      message: "แท็บ Chromium หยุดทำงาน ระบบจะลดจำนวนแท็บพร้อมกัน",
    };
  }
  if (/profile is already in use|existing browser session|browser profile/i.test(raw)) {
    return {
      code: "PROFILE_LOCKED",
      message: "Browser profile ถูกใช้งานโดย HR Auto หรือ Chromium อีกหน้าต่าง",
    };
  }
  if (/target page, context or browser has been closed|browser has been closed|context closed/i.test(raw)) {
    return {
      code: "BROWSER_SESSION_CLOSED",
      message: "Browser session ถูกปิดหรือหลุดระหว่างทำงาน",
    };
  }
  if (/ERR_CONNECTION|net::|request failed|connection (?:closed|reset)/i.test(raw)) {
    return {
      code: "NETWORK_FAILED",
      message: `การเชื่อมต่อ Facebook ไม่สำเร็จ · ${raw}`,
    };
  }
  if (/timeout|timed out|เกินเวลา|หลังรอ/i.test(raw)) {
    return {
      code: "FACEBOOK_TIMEOUT",
      message: `Facebook ตอบสนองช้าหรือหน้าไม่สมบูรณ์ · ${raw}`,
    };
  }
  return { code: "AUTOMATION_FAILED", message: raw };
}

class RunManager {
  private controllers = new Map<string, Controller>();

  isBusy(): boolean {
    return this.controllers.size > 0;
  }

  isRunActive(runId: string): boolean {
    return this.controllers.has(runId);
  }

  start(runId: string): void {
    if (this.controllers.has(runId)) throw new Error("คิวนี้กำลังทำงานอยู่");
    if (this.controllers.size > 0) {
      throw new Error(
        "มีคิวอื่นกำลังควบคุม Facebook Browser อยู่ กรุณาทำคิวเดิมให้เสร็จหรือหยุดก่อนเริ่มคิวใหม่",
      );
    }
    const run = getRun(runId);
    if (!run) throw new Error("ไม่พบคิวงาน");
    if (!["queued", "interrupted", "stopped"].includes(run.status)) {
      throw new Error(`ไม่สามารถเริ่มคิวที่มีสถานะ ${run.status}`);
    }
    const requestedTabLimit =
      run.workflow === "hybrid-windows"
        ? Math.min(MAX_HYBRID_WINDOWS_TAB_LIMIT, Math.max(1, run.tabLimit || 30))
        : run.workflow === "hybrid-tabs"
          ? Math.min(
              MAX_HYBRID_TABS_LIMIT,
              Math.max(1, run.tabLimit || DEFAULT_HYBRID_TAB_LIMIT),
            )
          : 1;
    const controller: Controller = {
      stopped: false,
      paused: false,
      autoConfirm: Boolean(run.autoConfirm),
      workflow: run.workflow || "sequential",
      tabLimit: requestedTabLimit,
      maximumTabLimit: requestedTabLimit,
      consecutivePreparationFailures: 0,
      consecutiveAutoConfirmFailures: 0,
      stablePreparations: 0,
      pressurePaused: false,
      waitingTargetId: null,
      resolveAction: null,
      prepared: new Map(),
      acting: new Set(),
    };
    this.controllers.set(runId, controller);
    void this.execute(runId, controller);
  }

  pause(runId: string): void {
    const controller = this.requireController(runId);
    controller.paused = true;
    updateRunStatus(runId, "paused");
  }

  resume(runId: string): void {
    const controller = this.requireController(runId);
    controller.paused = false;
    updateRunStatus(
      runId,
      controller.prepared.size ? "awaiting_confirmation" : "running",
    );
  }

  stop(runId: string): void {
    const controller = this.requireController(runId);
    controller.stopped = true;
    controller.resolveAction?.({ action: "stop" });
  }

  async action(
    runId: string,
    targetId: string,
    action: UserAction,
    reason?: string,
  ): Promise<void> {
    const controller = this.requireController(runId);
    if (!controller.prepared.has(targetId)) {
      throw new Error("กลุ่มนี้ไม่ได้อยู่ในสถานะรอการยืนยัน");
    }
    if (controller.workflow === "sequential") {
      if (controller.waitingTargetId !== targetId || !controller.resolveAction) {
        throw new Error("กลุ่มนี้ไม่ได้อยู่ในสถานะรอการยืนยัน");
      }
      controller.resolveAction({ action, reason });
      return;
    }
    await this.settlePrepared(runId, controller, targetId, action, reason);
  }

  async markPostedBulk(
    runId: string,
    targetIds: string[],
  ): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{
      targetId: string;
      ok: boolean;
      status: string | null;
      message: string;
    }>;
  }> {
    const uniqueTargetIds = [...new Set(targetIds)];
    const results: Array<{
      targetId: string;
      ok: boolean;
      status: string | null;
      message: string;
    }> = [];

    for (const targetId of uniqueTargetIds) {
      try {
        await this.action(runId, targetId, "mark-posted");
        const target = getRun(runId)?.targets?.find(
          (item) => item.id === targetId,
        );
        const ok = target?.status === "published";
        results.push({
          targetId,
          ok,
          status: target?.status || null,
          message:
            target?.message ||
            (ok
              ? "บันทึกว่าโพสต์เองแล้วและเก็บหลักฐานเรียบร้อย"
              : "ไม่สามารถยืนยันผลหลังเก็บหลักฐาน"),
        });
      } catch (error) {
        results.push({
          targetId,
          ok: false,
          status: null,
          message:
            error instanceof Error
              ? error.message
              : "เกิดข้อผิดพลาดขณะบันทึกผล",
        });
      }
    }

    const succeeded = results.filter((result) => result.ok).length;
    return {
      total: uniqueTargetIds.length,
      succeeded,
      failed: uniqueTargetIds.length - succeeded,
      results,
    };
  }

  async focusTarget(runId: string, targetId: string): Promise<void> {
    const controller = this.requireController(runId);
    const pending = controller.prepared.get(targetId);
    if (!pending) throw new Error("ไม่พบแท็บ Facebook ของกลุ่มนี้");
    await pending.page.bringToFront();
  }

  async reconcilePosted(runId: string, targetId: string): Promise<void> {
    const active = this.controllers.get(runId);
    if (active?.prepared.has(targetId)) {
      await this.action(runId, targetId, "mark-posted");
      return;
    }
    const run = getRun(runId);
    const target = run?.targets?.find((item) => item.id === targetId);
    if (!run?.draft || !target?.group) throw new Error("ไม่พบข้อมูลกลุ่มสำหรับตรวจย้อนหลัง");
    if (!["manual_action_required", "awaiting_confirmation"].includes(target.status)) {
      throw new Error("รายการนี้ไม่ได้อยู่ในสถานะที่ต้องกระทบยอด");
    }
    const page = await browserSession.newPage();
    try {
      await page.goto(target.group.url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(2_000);
      const evidencePath = await captureEvidence({
        page,
        workDate: run.draft.workDate,
        slot: run.draft.slot,
        runId,
        groupName: target.group.name,
        suffix: "reconciled-manual-post",
        postText: run.draft.text,
      });
      updateTarget(target.id, "published", {
        message: "ผู้ใช้ยืนยันว่าโพสต์เอง ระบบเปิดกลุ่มและเก็บหลักฐานย้อนหลังแล้ว",
        evidencePath,
      });
      markGroupPosted(target.group.id);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private requireController(runId: string): Controller {
    const controller = this.controllers.get(runId);
    if (!controller) throw new Error("คิวนี้ไม่ได้กำลังทำงาน");
    return controller;
  }

  private async waitWhilePaused(controller: Controller): Promise<void> {
    while (controller.paused && !controller.stopped) await delay(250);
  }

  private hasMemoryPressure(controller: Controller): boolean {
    if (
      controller.prepared.size === 0 &&
      controller.workflow !== "hybrid-windows"
    ) {
      return false;
    }
    const free = os.freemem();
    const total = os.totalmem();
    return (
      free < MIN_AVAILABLE_MEMORY_BYTES ||
      (total > 0 && free / total < MIN_AVAILABLE_MEMORY_RATIO)
    );
  }

  private async waitForCapacity(
    controller: Controller,
    target?: RunTargetRecord,
    respectTabLimit = true,
  ): Promise<void> {
    let pressureMessageWritten = false;
    while (!controller.stopped) {
      const memoryPressure = this.hasMemoryPressure(controller);
      const atTabLimit =
        respectTabLimit && controller.prepared.size >= controller.tabLimit;
      if (!controller.paused && !memoryPressure && !atTabLimit) break;
      controller.pressurePaused = memoryPressure;
      if (memoryPressure && target && !pressureMessageWritten) {
        updateTarget(target.id, "queued", {
          message: `พักการเปิดแท็บใหม่ชั่วคราว · RAM ว่าง ${readableMemory(os.freemem())} · รอให้คุณจัดการแท็บที่เปิดอยู่`,
        });
        pressureMessageWritten = true;
      }
      await delay(500);
    }
    controller.pressurePaused = false;
  }

  private recordPreparationOutcome(
    controller: Controller,
    succeeded: boolean,
    errorCode?: string,
  ): void {
    if (succeeded) {
      controller.consecutivePreparationFailures = 0;
      controller.stablePreparations += 1;
      if (
        controller.stablePreparations >= 5 &&
        controller.tabLimit < controller.maximumTabLimit
      ) {
        controller.tabLimit += 1;
        controller.stablePreparations = 0;
      }
      return;
    }
    controller.stablePreparations = 0;
    if (
      !["RENDERER_CRASHED", "BROWSER_SESSION_CLOSED", "NETWORK_FAILED", "FACEBOOK_TIMEOUT", "SECURITY_CHECKPOINT"].includes(
        errorCode || "",
      )
    ) {
      return;
    }
    controller.consecutivePreparationFailures += 1;
    if (controller.consecutivePreparationFailures < 2) return;
    controller.tabLimit = Math.max(1, Math.floor(controller.tabLimit / 2));
    controller.consecutivePreparationFailures = 0;
  }

  private handlePreparedPageUnavailable(
    runId: string,
    controller: Controller,
    targetId: string,
    kind: "closed" | "crashed",
  ): void {
    const pending = controller.prepared.get(targetId);
    if (!pending || controller.acting.has(targetId) || controller.stopped) return;
    controller.prepared.delete(targetId);
    if (kind === "crashed") {
      this.recordPreparationOutcome(controller, false, "RENDERER_CRASHED");
      updateTarget(targetId, "failed", {
        message:
          "[RENDERER_CRASHED] แท็บ Chromium หยุดทำงาน รายการนี้ยังไม่ถูกโพสต์และสามารถลองใหม่ได้",
      });
    } else {
      updateTarget(targetId, "manual_action_required", {
        message:
          "[TAB_CLOSED] แท็บถูกปิดก่อนบันทึกผล กรุณาตรวจ Facebook แล้วเลือกยืนยันว่าโพสต์เอง หากโพสต์สำเร็จ",
      });
    }
    updateRunStatus(
      runId,
      controller.prepared.size ? "awaiting_confirmation" : "running",
    );
  }

  private waitForAction(controller: Controller, targetId: string): Promise<ActionRequest> {
    controller.waitingTargetId = targetId;
    return new Promise((resolve) => {
      controller.resolveAction = (request) => {
        controller.resolveAction = null;
        controller.waitingTargetId = null;
        resolve(request);
      };
    });
  }

  private async closePrepared(
    controller: Controller,
    pending: PendingPrepared,
  ): Promise<void> {
    if (controller.workflow === "hybrid-windows") return;
    await pending.page.keyboard.press("Escape").catch(() => undefined);
    await pending.page.close().catch(() => undefined);
  }

  private async abandonPrepared(
    runId: string,
    controller: Controller,
    targetId: string,
  ): Promise<void> {
    const pending = controller.prepared.get(targetId);
    if (!pending) return;
    const evidencePath = await captureEvidence({
      page: pending.page,
      workDate: pending.draft.workDate,
      slot: pending.draft.slot,
      runId,
      groupName: pending.target.group?.name || "group",
      suffix: "stopped-before-confirmation",
      postText: pending.draft.text,
    }).catch(() => null);
    updateTarget(targetId, "manual_action_required", {
      message:
        controller.workflow === "hybrid-windows"
          ? "หยุดคิวแล้ว แต่แท็บยังเปิดอยู่ตามที่กำหนด กรุณาจัดการและปิดแท็บด้วยตนเอง"
          : "หยุดคิวระหว่างรอยืนยัน เก็บหลักฐานแล้ว กรุณาตรวจว่าโพสต์ถูกส่งหรือไม่",
      evidencePath,
    });
    controller.prepared.delete(targetId);
    await this.closePrepared(controller, pending);
  }

  private async settlePrepared(
    runId: string,
    controller: Controller,
    targetId: string,
    action: UserAction,
    reason?: string,
  ): Promise<void> {
    const pending = controller.prepared.get(targetId);
    if (!pending) throw new Error("ไม่พบโพสต์ที่เตรียมไว้สำหรับกลุ่มนี้");
    if (controller.acting.has(targetId)) throw new Error("กลุ่มนี้กำลังประมวลผลอยู่");
    controller.acting.add(targetId);

    try {
      if (action === "skip") {
        const evidencePath = await captureEvidence({
          page: pending.page,
          workDate: pending.draft.workDate,
          slot: pending.draft.slot,
          runId,
          groupName: pending.target.group?.name || "group",
          suffix: "skipped",
          postText: pending.draft.text,
        });
        updateTarget(targetId, "skipped", {
          message: reason ? `ข้ามพร้อมหลักฐาน · ${reason}` : "ข้ามพร้อมเก็บหลักฐานแล้ว",
          evidencePath,
        });
        return;
      }

      if (action === "mark-posted") {
        await pending.page.waitForTimeout(800);
        const evidencePath = await captureEvidence({
          page: pending.page,
          workDate: pending.draft.workDate,
          slot: pending.draft.slot,
          runId,
          groupName: pending.target.group?.name || "group",
          suffix: "posted-manually",
          postText: pending.draft.text,
        });
        updateTarget(targetId, "published", {
          message: "ผู้ใช้ยืนยันว่าโพสต์เองใน Facebook และระบบเก็บหลักฐานแล้ว",
          evidencePath,
        });
        if (pending.target.group) markGroupPosted(pending.target.group.id);
        return;
      }

      if (!pending.prepared) {
        throw new Error(
          "ระบบเตรียมโพสต์ในแท็บนี้ไม่ครบ กรุณาจัดการใน Facebook แล้วเลือก “ฉันโพสต์เองแล้ว” หรือ “ข้าม”",
        );
      }
      updateTarget(targetId, "submitting", { message: "กำลังกดโพสต์ในแท็บนี้" });
      const result = await submitPreparedPost(pending.prepared);
      const evidencePath = await captureEvidence({
        page: pending.page,
        workDate: pending.draft.workDate,
        slot: pending.draft.slot,
        runId,
        groupName: pending.target.group?.name || "group",
        suffix: result.status,
        postText: pending.draft.text,
      });
      updateTarget(targetId, result.status, {
        message: result.message,
        evidencePath,
        permalink: result.permalink,
      });
      if (
        pending.target.group &&
        (result.status === "published" || result.status === "pending_review")
      ) {
        markGroupPosted(pending.target.group.id);
        controller.consecutiveAutoConfirmFailures = 0;
      }
    } catch (error) {
      const classified = classifyAutomationError(error);
      const message = `[${classified.code}] ${classified.message}`;
      const evidencePath = await captureEvidence({
        page: pending.page,
        workDate: pending.draft.workDate,
        slot: pending.draft.slot,
        runId,
        groupName: pending.target.group?.name || "group",
        suffix: "action-failed",
        postText: pending.draft.text,
      }).catch(() => null);
      updateTarget(targetId, "failed", { message, evidencePath });
      if (classified.code === "SECURITY_CHECKPOINT") {
        controller.paused = true;
        updateRunStatus(runId, "paused");
      } else if (controller.autoConfirm) {
        controller.consecutiveAutoConfirmFailures += 1;
        if (controller.consecutiveAutoConfirmFailures >= 2) {
          controller.paused = true;
          updateRunStatus(runId, "paused");
        }
      }
    } finally {
      controller.prepared.delete(targetId);
      controller.acting.delete(targetId);
      await this.closePrepared(controller, pending);
    }
  }

  private async recordPreparationFailure(
    page: Page,
    run: RunRecord,
    controller: Controller,
    target: RunTargetRecord,
    error: unknown,
    rendererCrashed = false,
  ): Promise<void> {
    const classified = classifyAutomationError(error, rendererCrashed);
    const message = `[${classified.code}] ${classified.message}`;
    this.recordPreparationOutcome(controller, false, classified.code);
    const evidencePath = await captureEvidence({
      page,
      workDate: run.draft!.workDate,
      slot: run.draft!.slot,
      runId: run.id,
      groupName: target.group?.name || "group",
      suffix: "failed",
      postText: run.draft!.text,
    }).catch(() => null);

    if (classified.code === "SECURITY_CHECKPOINT") {
      controller.paused = true;
      updateRunStatus(run.id, "paused");
      updateTarget(target.id, "failed", { message, evidencePath });
      await page.close().catch(() => undefined);
      return;
    }

    if (
      controller.workflow === "hybrid-windows" &&
      !page.isClosed() &&
      !["RENDERER_CRASHED", "BROWSER_SESSION_CLOSED"].includes(classified.code)
    ) {
      controller.prepared.set(target.id, {
        prepared: null,
        page,
        target,
        draft: run.draft!,
      });
      updateTarget(target.id, "manual_action_required", {
        message: `ระบบเตรียมไม่ครบ แต่เก็บแท็บไว้ให้จัดการเอง · ${message}`,
        evidencePath,
      });
      updateRunStatus(run.id, "awaiting_confirmation");
      return;
    }
    updateTarget(target.id, "failed", { message, evidencePath });
    await page.close().catch(() => undefined);
  }

  private async executeDryRun(run: RunRecord, controller: Controller): Promise<void> {
    const page = await browserSession.page();
    for (const target of run.targets || []) {
      if (controller.stopped) break;
      if (!["queued", "failed"].includes(target.status) || !target.group) continue;
      await this.waitWhilePaused(controller);
      if (controller.stopped) break;
      updateTarget(target.id, "opening", { message: "กำลังเปิดกลุ่มเพื่อตรวจสอบ" });
      try {
        const check = await inspectGroup(page, target.group);
        const evidencePath = await captureEvidence({
          page,
          workDate: run.draft!.workDate,
          slot: run.draft!.slot,
          runId: run.id,
          groupName: target.group.name,
          suffix: check.ready ? "dry-run-ready" : "dry-run-failed",
          postText: run.draft!.text,
        });
        updateTarget(target.id, check.ready ? "dry_run_ready" : "failed", {
          message: check.message,
          evidencePath,
        });
      } catch (error) {
        const classified = classifyAutomationError(error);
        if (classified.code === "SECURITY_CHECKPOINT") {
          controller.paused = true;
          updateRunStatus(run.id, "paused");
        }
        updateTarget(target.id, "failed", { message: `[${classified.code}] ${classified.message}` });
      }
    }
  }

  private async prepareInNewTab(
    run: RunRecord,
    controller: Controller,
    target: RunTargetRecord,
    existingPage?: Page,
  ): Promise<void> {
    if (!target.group || !run.draft) return;
    const page = existingPage || (await browserSession.newPage());
    let rendererCrashed = false;
    page.once("crash", () => {
      rendererCrashed = true;
    });
    updateTarget(target.id, "opening", { message: "กำลังเปิดแท็บใหม่สำหรับกลุ่มนี้" });
    try {
      updateTarget(target.id, "preparing", { message: "กำลังใส่ข้อความและรูปในแท็บใหม่" });
      const prepared = await preparePost(page, run.draft, target.group);
      controller.prepared.set(target.id, {
        prepared,
        page,
        target,
        draft: run.draft,
      });
      page.once("crash", () =>
        this.handlePreparedPageUnavailable(
          run.id,
          controller,
          target.id,
          "crashed",
        ),
      );
      page.once("close", () =>
        this.handlePreparedPageUnavailable(
          run.id,
          controller,
          target.id,
          "closed",
        ),
      );
      this.recordPreparationOutcome(controller, true);
      if (controller.stopped) {
        await this.abandonPrepared(run.id, controller, target.id);
        return;
      }
      updateTarget(target.id, "awaiting_confirmation", {
        message:
          controller.autoConfirm
            ? "พร้อมในแท็บใหม่ · กำลังเตรียมโพสต์อัตโนมัติ"
            : controller.workflow === "hybrid-windows"
            ? "พร้อมในหน้าต่างแบบแบ่งชุด · แท็บจะไม่ปิดเอง จัดการใน Facebook แล้วบันทึกผล"
            : controller.workflow === "hybrid-tabs"
            ? "พร้อมในแท็บใหม่ · ยืนยัน โพสต์เอง หรือข้ามพร้อมหลักฐานได้"
            : "พร้อมในแท็บใหม่ · คิวรอคำสั่งจากคุณก่อนทำกลุ่มถัดไป",
      });
      updateRunStatus(run.id, "awaiting_confirmation");

      if (controller.autoConfirm && !controller.paused && !controller.stopped) {
        const minDelay = Number(process.env.HR_AUTO_AUTO_CONFIRM_DELAY_MIN_MS ?? 5_000);
        const maxDelay = Number(process.env.HR_AUTO_AUTO_CONFIRM_DELAY_MAX_MS ?? 15_000);
        const autoDelayMs = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        setTimeout(() => {
          if (
            !controller.paused &&
            !controller.stopped &&
            controller.prepared.has(target.id) &&
            !controller.acting.has(target.id)
          ) {
            void this.action(run.id, target.id, "confirm").catch((err) => {
              const classified = classifyAutomationError(err);
              if (classified.code === "SECURITY_CHECKPOINT") {
                controller.paused = true;
                updateRunStatus(run.id, "paused");
              }
            });
          }
        }, autoDelayMs);
      }
    } catch (error) {
      await this.recordPreparationFailure(
        page,
        run,
        controller,
        target,
        error,
        rendererCrashed,
      );
    }
  }

  private async executeSequential(run: RunRecord, controller: Controller): Promise<void> {
    for (const target of run.targets || []) {
      if (controller.stopped) break;
      if (!["queued", "failed"].includes(target.status) || !target.group) continue;
      await this.waitWhilePaused(controller);
      if (controller.stopped) break;

      await this.prepareInNewTab(run, controller, target);
      if (!controller.prepared.has(target.id)) continue;
      const request = await this.waitForAction(controller, target.id);
      if (request.action === "stop") {
        await this.abandonPrepared(run.id, controller, target.id);
        break;
      }
      await this.settlePrepared(run.id, controller, target.id, request.action, request.reason);
      if (!controller.stopped) updateRunStatus(run.id, "running");
    }
  }

  private async executeHybrid(run: RunRecord, controller: Controller): Promise<void> {
    for (const target of run.targets || []) {
      if (!["queued", "failed"].includes(target.status) || !target.group) continue;
      await this.waitForCapacity(controller, target);
      if (controller.stopped) break;
      await this.prepareInNewTab(run, controller, target);
      if (!controller.stopped && PREPARATION_COOLDOWN_MS) {
        await delay(PREPARATION_COOLDOWN_MS);
      }
    }

    while (
      !controller.stopped &&
      (controller.prepared.size > 0 || controller.acting.size > 0)
    ) {
      await delay(250);
    }
    if (controller.stopped) {
      for (const targetId of [...controller.prepared.keys()]) {
        await this.abandonPrepared(run.id, controller, targetId);
      }
    }
  }

  private async executeHybridWindows(
    run: RunRecord,
    controller: Controller,
  ): Promise<void> {
    const targets = (run.targets || []).filter(
      (target) =>
        ["queued", "failed"].includes(target.status) && Boolean(target.group),
    );
    const tabsPerWindow = Math.min(30, Math.max(1, controller.tabLimit || 30));
    let windowAnchor: Page | null = null;
    let tabsInWindow = 0;

    for (const target of targets) {
      await this.waitForCapacity(controller, target, false);
      if (controller.stopped) break;

      let page: Page;
      if (!windowAnchor || windowAnchor.isClosed() || tabsInWindow >= tabsPerWindow) {
        page = await browserSession.newWindow();
        windowAnchor = page;
        tabsInWindow = 1;
      } else {
        page = await browserSession.newPageInWindow(windowAnchor);
        windowAnchor = page;
        tabsInWindow += 1;
      }
      await this.prepareInNewTab(run, controller, target, page);
      if (!controller.stopped && PREPARATION_COOLDOWN_MS) {
        await delay(PREPARATION_COOLDOWN_MS);
      }
    }

    while (
      !controller.stopped &&
      (controller.prepared.size > 0 || controller.acting.size > 0)
    ) {
      await delay(250);
    }
    if (controller.stopped) {
      for (const targetId of [...controller.prepared.keys()]) {
        await this.abandonPrepared(run.id, controller, targetId);
      }
    }
  }

  private async execute(runId: string, controller: Controller): Promise<void> {
    try {
      const session = await browserSession.status();
      if (!session.authenticated) throw new Error("กรุณาเปิด Browser และล็อกอิน Facebook ก่อน");
      updateRunStatus(runId, "running", { start: true });
      const run = getRun(runId);
      if (!run?.draft || !run.targets) throw new Error("ข้อมูลคิวไม่ครบ");

      if (run.mode === "dry-run") {
        await this.executeDryRun(run, controller);
      } else if (controller.workflow === "hybrid-windows") {
        await this.executeHybridWindows(run, controller);
      } else if (controller.workflow === "hybrid-tabs") {
        await this.executeHybrid(run, controller);
      } else {
        await this.executeSequential(run, controller);
      }

      const finishedRun = getRun(runId);
      const hasFailedTargets = finishedRun?.targets?.some((target) => target.status === "failed");
      updateRunStatus(
        runId,
        controller.stopped ? "stopped" : hasFailedTargets ? "failed" : "completed",
        { finish: true },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
      const run = getRun(runId);
      run?.targets
        ?.filter((target) => target.status === "queued")
        .forEach((target) => updateTarget(target.id, "failed", { message }));
      updateRunStatus(runId, "failed", { finish: true });
    } finally {
      this.controllers.delete(runId);
    }
  }
}

export const runManager = new RunManager();
