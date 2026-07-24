import type { Page } from "playwright";
import { browserSession } from "./session.js";
import {
  captureEvidence,
  inspectGroup,
  preparePost,
  submitPreparedPost,
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
  prepared: PreparedPost;
  target: RunTargetRecord;
  draft: DraftRecord;
}

interface Controller {
  stopped: boolean;
  paused: boolean;
  workflow: RunWorkflow;
  tabLimit: number;
  waitingTargetId: string | null;
  resolveAction: ((request: ActionRequest) => void) | null;
  prepared: Map<string, PendingPrepared>;
  acting: Set<string>;
}

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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
    const run = getRun(runId);
    if (!run) throw new Error("ไม่พบคิวงาน");
    if (!["queued", "interrupted", "stopped"].includes(run.status)) {
      throw new Error(`ไม่สามารถเริ่มคิวที่มีสถานะ ${run.status}`);
    }
    const controller: Controller = {
      stopped: false,
      paused: false,
      workflow: run.workflow || "sequential",
      tabLimit:
        run.tabLimit === 0
          ? Number.POSITIVE_INFINITY
          : Math.max(1, run.tabLimit || 3),
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

  async focusTarget(runId: string, targetId: string): Promise<void> {
    const controller = this.requireController(runId);
    const pending = controller.prepared.get(targetId);
    if (!pending) throw new Error("ไม่พบแท็บ Facebook ของกลุ่มนี้");
    await pending.prepared.page.bringToFront();
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

  private async closePrepared(pending: PendingPrepared): Promise<void> {
    await pending.prepared.page.keyboard.press("Escape").catch(() => undefined);
    await pending.prepared.page.close().catch(() => undefined);
  }

  private async abandonPrepared(
    runId: string,
    controller: Controller,
    targetId: string,
  ): Promise<void> {
    const pending = controller.prepared.get(targetId);
    if (!pending) return;
    const evidencePath = await captureEvidence({
      page: pending.prepared.page,
      workDate: pending.draft.workDate,
      slot: pending.draft.slot,
      runId,
      groupName: pending.target.group?.name || "group",
      suffix: "stopped-before-confirmation",
      postText: pending.draft.text,
    }).catch(() => null);
    updateTarget(targetId, "manual_action_required", {
      message: "หยุดคิวระหว่างรอยืนยัน เก็บหลักฐานแล้ว กรุณาตรวจว่าโพสต์ถูกส่งหรือไม่",
      evidencePath,
    });
    await this.closePrepared(pending);
    controller.prepared.delete(targetId);
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
          page: pending.prepared.page,
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
        await pending.prepared.page.waitForTimeout(800);
        const evidencePath = await captureEvidence({
          page: pending.prepared.page,
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

      updateTarget(targetId, "submitting", { message: "กำลังกดโพสต์ในแท็บนี้" });
      const result = await submitPreparedPost(pending.prepared);
      const evidencePath = await captureEvidence({
        page: pending.prepared.page,
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
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
      const evidencePath = await captureEvidence({
        page: pending.prepared.page,
        workDate: pending.draft.workDate,
        slot: pending.draft.slot,
        runId,
        groupName: pending.target.group?.name || "group",
        suffix: "action-failed",
        postText: pending.draft.text,
      }).catch(() => null);
      updateTarget(targetId, "failed", { message, evidencePath });
    } finally {
      await this.closePrepared(pending);
      controller.prepared.delete(targetId);
      controller.acting.delete(targetId);
    }
  }

  private async recordPreparationFailure(
    page: Page,
    run: RunRecord,
    target: RunTargetRecord,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
    const evidencePath = await captureEvidence({
      page,
      workDate: run.draft!.workDate,
      slot: run.draft!.slot,
      runId: run.id,
      groupName: target.group?.name || "group",
      suffix: "failed",
      postText: run.draft!.text,
    }).catch(() => null);
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
        const message = error instanceof Error ? error.message : "ตรวจสอบกลุ่มไม่สำเร็จ";
        updateTarget(target.id, "failed", { message });
      }
    }
  }

  private async prepareInNewTab(
    run: RunRecord,
    controller: Controller,
    target: RunTargetRecord,
  ): Promise<void> {
    if (!target.group || !run.draft) return;
    const page = await browserSession.newPage();
    updateTarget(target.id, "opening", { message: "กำลังเปิดแท็บใหม่สำหรับกลุ่มนี้" });
    try {
      updateTarget(target.id, "preparing", { message: "กำลังใส่ข้อความและรูปในแท็บใหม่" });
      const prepared = await preparePost(page, run.draft, target.group);
      controller.prepared.set(target.id, { prepared, target, draft: run.draft });
      if (controller.stopped) {
        await this.abandonPrepared(run.id, controller, target.id);
        return;
      }
      updateTarget(target.id, "awaiting_confirmation", {
        message:
          controller.workflow === "hybrid-tabs"
            ? "พร้อมในแท็บใหม่ · ยืนยัน โพสต์เอง หรือข้ามพร้อมหลักฐานได้"
            : "พร้อมในแท็บใหม่ · คิวรอคำสั่งจากคุณก่อนทำกลุ่มถัดไป",
      });
      updateRunStatus(run.id, "awaiting_confirmation");
    } catch (error) {
      await this.recordPreparationFailure(page, run, target, error);
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
      while (
        !controller.stopped &&
        (controller.paused || controller.prepared.size >= controller.tabLimit)
      ) {
        await delay(250);
      }
      if (controller.stopped) break;
      await this.prepareInNewTab(run, controller, target);
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
