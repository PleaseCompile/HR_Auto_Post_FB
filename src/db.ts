import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { databasePath } from "./config.js";
import type {
  DraftRecord,
  DraftStatus,
  GroupRecord,
  GroupScanState,
  ManualEvidenceRecord,
  MediaRecord,
  RunMode,
  RunRecord,
  RunWorkflow,
  RunTargetRecord,
  Slot,
  TargetStatus,
} from "./types.js";

const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    work_date TEXT NOT NULL,
    slot TEXT NOT NULL CHECK(slot IN ('morning', 'midday', 'evening')),
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS groups_list (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    province TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]',
    can_post TEXT NOT NULL DEFAULT 'unknown',
    requires_approval INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    last_posted_at TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    external_id TEXT,
    scanned_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES drafts(id),
    mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS run_targets (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES groups_list(id),
    position INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    message TEXT NOT NULL DEFAULT '',
    evidence_path TEXT,
    permalink TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(run_id, group_id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_scan_runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    found_count INTEGER NOT NULL DEFAULT 0,
    new_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    unchanged_count INTEGER NOT NULL DEFAULT 0,
    scroll_count INTEGER NOT NULL DEFAULT 0,
    snapshot_path TEXT,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS manual_evidence (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL REFERENCES run_targets(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_drafts_work_date ON drafts(work_date);
  CREATE INDEX IF NOT EXISTS idx_targets_run ON run_targets(run_id, position);
  CREATE INDEX IF NOT EXISTS idx_groups_active ON groups_list(active);
  CREATE INDEX IF NOT EXISTS idx_manual_evidence_target ON manual_evidence(target_id, created_at);
`);

function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("groups_list", "source", "TEXT NOT NULL DEFAULT 'manual'");
ensureColumn("groups_list", "external_id", "TEXT");
ensureColumn("groups_list", "scanned_at", "TEXT");
ensureColumn("runs", "workflow", "TEXT NOT NULL DEFAULT 'sequential'");
ensureColumn("runs", "tab_limit", "INTEGER NOT NULL DEFAULT 3");
db.exec("CREATE INDEX IF NOT EXISTS idx_groups_external_id ON groups_list(external_id)");
db.prepare(
  `UPDATE group_scan_runs
   SET status = 'failed', finished_at = ?, error = 'แอปถูกปิดระหว่างการสแกน'
   WHERE status IN ('running', 'stopping')`,
).run(new Date().toISOString());

db.prepare(
  "UPDATE runs SET status = 'interrupted', finished_at = ? WHERE status IN ('running', 'awaiting_confirmation', 'paused')",
).run(new Date().toISOString());
db.prepare(
  `UPDATE run_targets
   SET status = 'manual_action_required',
       message = 'แอปถูกปิดระหว่างทำงาน กรุณาตรวจ Facebook ก่อนสร้างคิวใหม่',
       updated_at = ?
   WHERE status IN ('opening', 'preparing', 'awaiting_confirmation', 'submitting')`,
).run(new Date().toISOString());

function parseTags(value: string): string[] {
  try {
    const tags = JSON.parse(value) as unknown;
    return Array.isArray(tags) ? tags.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeFacebookGroupUrl(value: string): {
  url: string;
  externalId: string | null;
} {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments[0] === "groups" && segments[1]) {
      return {
        url: `https://www.facebook.com/groups/${segments[1]}/`,
        externalId: segments[1],
      };
    }
  } catch {
    // Validation happens at the API boundary; retain the original value here.
  }
  return { url: value, externalId: null };
}

function rowToMedia(row: any): MediaRecord {
  return {
    id: row.id,
    draftId: row.draft_id,
    fileName: row.file_name,
    storedPath: row.stored_path,
    mimeType: row.mime_type,
    position: row.position,
  };
}

function rowToDraft(row: any, withMedia = true): DraftRecord {
  return {
    id: row.id,
    workDate: row.work_date,
    slot: row.slot,
    text: row.text,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    media: withMedia
      ? (db
          .prepare("SELECT * FROM media WHERE draft_id = ? ORDER BY position")
          .all(row.id) as any[]).map(rowToMedia)
      : [],
  };
}

function rowToGroup(row: any): GroupRecord {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    province: row.province,
    tags: parseTags(row.tags_json),
    canPost: row.can_post,
    requiresApproval: Boolean(row.requires_approval),
    note: row.note,
    active: Boolean(row.active),
    lastPostedAt: row.last_posted_at,
    source: row.source || "manual",
    externalId: row.external_id || null,
    scannedAt: row.scanned_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTarget(row: any): RunTargetRecord {
  return {
    id: row.id,
    runId: row.run_id,
    groupId: row.group_id,
    position: row.position,
    status: row.status,
    message: row.message,
    evidencePath: row.evidence_path,
    permalink: row.permalink,
    updatedAt: row.updated_at,
    group: row.group_name
      ? rowToGroup({
          id: row.group_id,
          name: row.group_name,
          url: row.group_url,
          province: row.group_province,
          tags_json: row.group_tags_json,
          can_post: row.group_can_post,
          requires_approval: row.group_requires_approval,
          note: row.group_note,
          active: row.group_active,
          last_posted_at: row.group_last_posted_at,
          source: row.group_source,
          external_id: row.group_external_id,
          scanned_at: row.group_scanned_at,
          created_at: row.group_created_at,
          updated_at: row.group_updated_at,
        })
      : undefined,
  };
}

function rowToManualEvidence(row: any): ManualEvidenceRecord {
  return {
    id: row.id,
    targetId: row.target_id,
    fileName: row.file_name,
    storedPath: row.stored_path,
    mimeType: row.mime_type,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: any, expanded = false): RunRecord {
  const run: RunRecord = {
    id: row.id,
    draftId: row.draft_id,
    mode: row.mode,
    workflow: row.workflow || "sequential",
    tabLimit:
      Number(row.tab_limit) === 0
        ? 0
        : Math.max(1, Math.round(Number(row.tab_limit) || 3)),
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
  if (expanded) {
    run.draft = getDraft(row.draft_id) || undefined;
    run.targets = listRunTargets(row.id);
  }
  return run;
}

export function createDraft(input: {
  workDate: string;
  slot: Slot;
  text: string;
  status?: DraftStatus;
}): DraftRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO drafts(id, work_date, slot, text, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.workDate, input.slot, input.text, input.status || "draft", now, now);
  return getDraft(id)!;
}

export function updateDraft(
  id: string,
  input: Partial<{
    workDate: string;
    slot: Slot;
    text: string;
    status: DraftStatus;
  }>,
): DraftRecord | null {
  const current = getDraft(id);
  if (!current) return null;
  db.prepare(
    `UPDATE drafts
     SET work_date = ?, slot = ?, text = ?, status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.workDate ?? current.workDate,
    input.slot ?? current.slot,
    input.text ?? current.text,
    input.status ?? current.status,
    new Date().toISOString(),
    id,
  );
  return getDraft(id);
}

export function getDraft(id: string): DraftRecord | null {
  const row = db.prepare("SELECT * FROM drafts WHERE id = ?").get(id);
  return row ? rowToDraft(row) : null;
}

export function listDrafts(limit = 100): DraftRecord[] {
  return (db
    .prepare("SELECT * FROM drafts ORDER BY work_date DESC, created_at DESC LIMIT ?")
    .all(limit) as any[]).map((row) => rowToDraft(row));
}

export function addMedia(input: {
  draftId: string;
  fileName: string;
  storedPath: string;
  mimeType: string;
}): MediaRecord {
  const id = randomUUID();
  const next = db
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM media WHERE draft_id = ?")
    .get(input.draftId) as { position: number };
  db.prepare(
    `INSERT INTO media(id, draft_id, file_name, stored_path, mime_type, position)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.draftId, input.fileName, input.storedPath, input.mimeType, next.position);
  return rowToMedia(db.prepare("SELECT * FROM media WHERE id = ?").get(id));
}

export function getMedia(id: string): MediaRecord | null {
  const row = db.prepare("SELECT * FROM media WHERE id = ?").get(id);
  return row ? rowToMedia(row) : null;
}

export function deleteMedia(id: string): MediaRecord | null {
  const row = db.prepare("SELECT * FROM media WHERE id = ?").get(id);
  if (!row) return null;
  db.prepare("DELETE FROM media WHERE id = ?").run(id);
  return rowToMedia(row);
}

export function upsertGroup(input: {
  id?: string;
  name: string;
  url: string;
  province?: string;
  tags?: string[];
  canPost?: "yes" | "no" | "unknown";
  requiresApproval?: boolean;
  note?: string;
  active?: boolean;
  source?: "manual" | "csv" | "automatic_scan";
  externalId?: string | null;
  scannedAt?: string | null;
}): GroupRecord {
  const normalized = normalizeFacebookGroupUrl(input.url);
  const requestedExternalId =
    input.externalId === undefined ? normalized.externalId : input.externalId;
  const existing = db
    .prepare(
      `SELECT * FROM groups_list
       WHERE url = ? OR (? IS NOT NULL AND external_id = ?)
       ORDER BY CASE WHEN url = ? THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .get(
      normalized.url,
      requestedExternalId,
      requestedExternalId,
      normalized.url,
    ) as any | undefined;
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(
      `UPDATE groups_list SET
        name = ?, url = ?, province = ?, tags_json = ?, can_post = ?, requires_approval = ?,
        note = ?, active = ?, source = ?, external_id = ?, scanned_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.name || existing.name,
      normalized.url,
      input.province ?? existing.province,
      JSON.stringify(input.tags ?? parseTags(existing.tags_json)),
      input.canPost ?? existing.can_post,
      Number(input.requiresApproval ?? Boolean(existing.requires_approval)),
      input.note ?? existing.note,
      Number(input.active ?? Boolean(existing.active)),
      input.source ?? existing.source ?? "manual",
      requestedExternalId ?? existing.external_id,
      input.scannedAt === undefined ? existing.scanned_at : input.scannedAt,
      now,
      existing.id,
    );
    return getGroup(existing.id)!;
  }

  const id = input.id || randomUUID();
  db.prepare(
    `INSERT INTO groups_list(
      id, name, url, province, tags_json, can_post, requires_approval, note, active,
      source, external_id, scanned_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    normalized.url,
    input.province || "",
    JSON.stringify(input.tags || []),
    input.canPost || "unknown",
    Number(input.requiresApproval || false),
    input.note || "",
    Number(input.active ?? true),
    input.source || "manual",
    requestedExternalId || null,
    input.scannedAt || null,
    now,
    now,
  );
  return getGroup(id)!;
}

export function getGroup(id: string): GroupRecord | null {
  const row = db.prepare("SELECT * FROM groups_list WHERE id = ?").get(id);
  return row ? rowToGroup(row) : null;
}

export function listGroups(): GroupRecord[] {
  return (db
    .prepare("SELECT * FROM groups_list ORDER BY active DESC, name COLLATE NOCASE")
    .all() as any[]).map(rowToGroup);
}

export function upsertScannedGroup(input: {
  name: string;
  url: string;
  externalId: string;
  scannedAt: string;
}): { group: GroupRecord; created: boolean; updated: boolean } {
  const existing = db
    .prepare(
      `SELECT * FROM groups_list
       WHERE url = ? OR (external_id IS NOT NULL AND external_id = ?)
       ORDER BY CASE WHEN url = ? THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .get(input.url, input.externalId, input.url) as any;
  if (!existing) {
    const group = upsertGroup({
      name: input.name,
      url: input.url,
      externalId: input.externalId,
      scannedAt: input.scannedAt,
      source: "automatic_scan",
    });
    return { group, created: true, updated: false };
  }

  const changed = existing.name !== input.name || existing.url !== input.url;
  db.prepare(
    `UPDATE groups_list
     SET name = ?, url = ?, external_id = ?, scanned_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.name,
    input.url,
    input.externalId,
    input.scannedAt,
    new Date().toISOString(),
    existing.id,
  );
  return { group: getGroup(existing.id)!, created: false, updated: changed };
}

function rowToGroupScan(row: any): GroupScanState {
  const message =
    row.status === "completed"
      ? `สแกนเสร็จ พบ ${row.found_count} กลุ่ม`
      : row.status === "failed"
        ? "สแกนไม่สำเร็จ"
        : row.status === "running" || row.status === "stopping"
          ? `พบ ${row.found_count} กลุ่ม · รอบที่ ${row.scroll_count}`
          : "พร้อมสแกนเมื่อคุณต้องการเพิ่มกลุ่ม";
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    foundCount: row.found_count,
    newCount: row.new_count,
    updatedCount: row.updated_count,
    unchangedCount: row.unchanged_count,
    scrollCount: row.scroll_count,
    message,
    snapshotPath: row.snapshot_path,
    error: row.error,
  };
}

export function createGroupScanRun(): GroupScanState {
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO group_scan_runs(id, status, started_at)
     VALUES (?, 'running', ?)`,
  ).run(id, startedAt);
  return rowToGroupScan(db.prepare("SELECT * FROM group_scan_runs WHERE id = ?").get(id));
}

export function updateGroupScanRun(
  id: string,
  state: Pick<
    GroupScanState,
    | "status"
    | "finishedAt"
    | "foundCount"
    | "newCount"
    | "updatedCount"
    | "unchangedCount"
    | "scrollCount"
    | "snapshotPath"
    | "error"
  >,
): void {
  db.prepare(
    `UPDATE group_scan_runs SET
      status = ?, finished_at = ?, found_count = ?, new_count = ?, updated_count = ?,
      unchanged_count = ?, scroll_count = ?, snapshot_path = ?, error = ?
     WHERE id = ?`,
  ).run(
    state.status,
    state.finishedAt,
    state.foundCount,
    state.newCount,
    state.updatedCount,
    state.unchangedCount,
    state.scrollCount,
    state.snapshotPath,
    state.error,
    id,
  );
}

export function getLatestGroupScanRun(): GroupScanState | null {
  const row = db
    .prepare("SELECT * FROM group_scan_runs ORDER BY started_at DESC LIMIT 1")
    .get();
  return row ? rowToGroupScan(row) : null;
}

export function createRun(input: {
  draftId: string;
  groupIds: string[];
  mode: RunMode;
  workflow?: RunWorkflow;
  tabLimit?: number;
}): RunRecord {
  const uniqueGroupIds = [...new Set(input.groupIds)];
  if (input.mode === "assisted" && uniqueGroupIds.length) {
    const placeholders = uniqueGroupIds.map(() => "?").join(", ");
    const previous = db
      .prepare(
        `SELECT DISTINCT g.name
         FROM run_targets rt
         JOIN runs r ON r.id = rt.run_id
         JOIN groups_list g ON g.id = rt.group_id
         WHERE r.draft_id = ?
           AND rt.group_id IN (${placeholders})
           AND rt.status IN ('published', 'pending_review', 'manual_action_required')`,
      )
      .all(input.draftId, ...uniqueGroupIds) as Array<{ name: string }>;
    if (previous.length) {
      const names = previous
        .slice(0, 3)
        .map((item) => item.name)
        .join(", ");
      throw new Error(
        `Draft นี้อาจถูกส่งไปแล้ว ${previous.length} กลุ่ม (${names}${
          previous.length > 3 ? "…" : ""
        }) กรุณาสร้าง Draft ใหม่หากต้องการโพสต์ซ้ำ`,
      );
    }
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const workflow = input.mode === "dry-run" ? "sequential" : input.workflow || "sequential";
  const tabLimit =
    input.tabLimit === undefined || input.tabLimit === 0
      ? 0
      : Math.max(1, Math.round(input.tabLimit));
  const insertRun = db.prepare(
    `INSERT INTO runs(id, draft_id, mode, workflow, tab_limit, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
  );
  const insertTarget = db.prepare(
    `INSERT INTO run_targets(id, run_id, group_id, position, status, updated_at)
     VALUES (?, ?, ?, ?, 'queued', ?)`,
  );
  const transaction = db.transaction(() => {
    insertRun.run(id, input.draftId, input.mode, workflow, tabLimit, now);
    uniqueGroupIds.forEach((groupId, position) => {
      insertTarget.run(randomUUID(), id, groupId, position, now);
    });
  });
  transaction();
  return getRun(id)!;
}

export function listRuns(limit = 100): RunRecord[] {
  return (db
    .prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as any[]).map((row) => rowToRun(row, true));
}

export function getRun(id: string): RunRecord | null {
  const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id);
  return row ? rowToRun(row, true) : null;
}

export function deleteRun(
  id: string,
  options: {
    acknowledgedUncertain?: boolean;
    acknowledgedPosted?: boolean;
  } = {},
): { runId: string; targetCount: number; evidencePaths: string[] } | null {
  const run = getRun(id);
  if (!run) return null;
  if (["running", "awaiting_confirmation", "paused"].includes(run.status)) {
    throw new Error("กรุณาหยุดคิวและรอให้แท็บ Facebook ปิดครบก่อนลบ");
  }
  const targets = run.targets || [];
  const submittingTargets = targets.filter(
    (target) => target.status === "submitting",
  );
  if (submittingTargets.length) {
    throw new Error(
      `ลบคิวนี้ไม่ได้ เพราะมี ${submittingTargets.length} รายการที่กำลังส่ง กรุณารอหรือหยุดและตรวจ Facebook ก่อน`,
    );
  }
  const postedTargets = targets.filter((target) =>
    ["published", "pending_review"].includes(target.status),
  );
  if (postedTargets.length && !options.acknowledgedPosted) {
    throw new Error(
      `คิวนี้มี ${postedTargets.length} รายการที่เผยแพร่หรือรอแอดมิน กรุณายืนยันว่าต้องการลบประวัติทั้งคิวและยอมรับความเสี่ยงโพสต์ซ้ำ`,
    );
  }
  const uncertainTargets = targets.filter(
    (target) => target.status === "manual_action_required",
  );
  if (uncertainTargets.length && !options.acknowledgedUncertain) {
    throw new Error(
      `มี ${uncertainTargets.length} รายการที่ต้องตรวจด้วยตนเอง กรุณาตรวจ Facebook ว่ายังไม่ได้โพสต์และยืนยันก่อนลบ`,
    );
  }

  const evidencePaths = new Set<string>();
  targets.forEach((target) => {
    if (target.evidencePath) evidencePaths.add(target.evidencePath);
  });
  const manualPaths = db
    .prepare(
      `SELECT me.stored_path
       FROM manual_evidence me
       JOIN run_targets rt ON rt.id = me.target_id
       WHERE rt.run_id = ?`,
    )
    .all(id) as Array<{ stored_path: string }>;
  manualPaths.forEach((item) => evidencePaths.add(item.stored_path));

  db.prepare("DELETE FROM runs WHERE id = ?").run(id);
  return {
    runId: id,
    targetCount: targets.length,
    evidencePaths: [...evidencePaths],
  };
}

export function updateRunWorkflow(
  id: string,
  workflow: RunWorkflow,
  tabLimit = 0,
): RunRecord | null {
  const run = getRun(id);
  if (!run) return null;
  if (!["queued", "interrupted", "stopped"].includes(run.status)) {
    throw new Error("เปลี่ยนรูปแบบได้เฉพาะคิวที่ยังไม่เริ่ม ถูกขัดจังหวะ หรือหยุดแล้ว");
  }
  db.prepare("UPDATE runs SET workflow = ?, tab_limit = ? WHERE id = ?").run(
    workflow,
    tabLimit === 0 ? 0 : Math.max(1, Math.round(tabLimit)),
    id,
  );
  return getRun(id);
}

export function listRunTargets(runId: string): RunTargetRecord[] {
  return (db
    .prepare(
      `SELECT
        rt.*,
        g.name AS group_name, g.url AS group_url, g.province AS group_province,
        g.tags_json AS group_tags_json, g.can_post AS group_can_post,
        g.requires_approval AS group_requires_approval, g.note AS group_note,
        g.active AS group_active, g.last_posted_at AS group_last_posted_at,
        g.source AS group_source, g.external_id AS group_external_id,
        g.scanned_at AS group_scanned_at,
        g.created_at AS group_created_at, g.updated_at AS group_updated_at
       FROM run_targets rt
       JOIN groups_list g ON g.id = rt.group_id
       WHERE rt.run_id = ?
       ORDER BY rt.position`,
    )
    .all(runId) as any[]).map(rowToTarget);
}

export function getRunTarget(id: string): RunTargetRecord | null {
  const row = db
    .prepare(
      `SELECT
        rt.*,
        g.name AS group_name, g.url AS group_url, g.province AS group_province,
        g.tags_json AS group_tags_json, g.can_post AS group_can_post,
        g.requires_approval AS group_requires_approval, g.note AS group_note,
        g.active AS group_active, g.last_posted_at AS group_last_posted_at,
        g.source AS group_source, g.external_id AS group_external_id,
        g.scanned_at AS group_scanned_at,
        g.created_at AS group_created_at, g.updated_at AS group_updated_at
       FROM run_targets rt
       JOIN groups_list g ON g.id = rt.group_id
       WHERE rt.id = ?`,
    )
    .get(id);
  return row ? rowToTarget(row) : null;
}

export function listManualEvidence(targetId?: string): ManualEvidenceRecord[] {
  const rows = targetId
    ? db
        .prepare("SELECT * FROM manual_evidence WHERE target_id = ? ORDER BY created_at DESC")
        .all(targetId)
    : db.prepare("SELECT * FROM manual_evidence ORDER BY created_at DESC").all();
  return (rows as any[]).map(rowToManualEvidence);
}

export function getManualEvidence(id: string): ManualEvidenceRecord | null {
  const row = db.prepare("SELECT * FROM manual_evidence WHERE id = ?").get(id);
  return row ? rowToManualEvidence(row) : null;
}

export function addManualEvidence(input: {
  targetId: string;
  fileName: string;
  storedPath: string;
  mimeType: string;
  note?: string;
}): ManualEvidenceRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO manual_evidence(
      id, target_id, file_name, stored_path, mime_type, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.targetId,
    input.fileName,
    input.storedPath,
    input.mimeType,
    input.note || "",
    now,
    now,
  );
  return getManualEvidence(id)!;
}

export function updateManualEvidence(
  id: string,
  input: Partial<{
    fileName: string;
    storedPath: string;
    mimeType: string;
    note: string;
  }>,
): ManualEvidenceRecord | null {
  const current = getManualEvidence(id);
  if (!current) return null;
  db.prepare(
    `UPDATE manual_evidence
     SET file_name = ?, stored_path = ?, mime_type = ?, note = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.fileName ?? current.fileName,
    input.storedPath ?? current.storedPath,
    input.mimeType ?? current.mimeType,
    input.note ?? current.note,
    new Date().toISOString(),
    id,
  );
  return getManualEvidence(id);
}

export function deleteManualEvidence(id: string): ManualEvidenceRecord | null {
  const current = getManualEvidence(id);
  if (!current) return null;
  db.prepare("DELETE FROM manual_evidence WHERE id = ?").run(id);
  return current;
}

export function updateRunStatus(
  id: string,
  status: RunRecord["status"],
  options: { start?: boolean; finish?: boolean } = {},
): void {
  const current = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as any;
  if (!current) return;
  db.prepare(
    "UPDATE runs SET status = ?, started_at = ?, finished_at = ? WHERE id = ?",
  ).run(
    status,
    options.start ? new Date().toISOString() : current.started_at,
    options.finish ? new Date().toISOString() : current.finished_at,
    id,
  );
}

export function updateTarget(
  id: string,
  status: TargetStatus,
  input: {
    message?: string;
    evidencePath?: string | null;
    permalink?: string | null;
  } = {},
): void {
  const current = db.prepare("SELECT * FROM run_targets WHERE id = ?").get(id) as any;
  if (!current) return;
  db.prepare(
    `UPDATE run_targets
     SET status = ?, message = ?, evidence_path = ?, permalink = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    status,
    input.message ?? current.message,
    input.evidencePath === undefined ? current.evidence_path : input.evidencePath,
    input.permalink === undefined ? current.permalink : input.permalink,
    new Date().toISOString(),
    id,
  );
}

export function markGroupPosted(groupId: string): void {
  db.prepare("UPDATE groups_list SET last_posted_at = ?, updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    new Date().toISOString(),
    groupId,
  );
}

export function dashboardSummary() {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.HR_AUTO_TIMEZONE || "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const draftCount = (
    db.prepare("SELECT COUNT(*) AS count FROM drafts WHERE work_date = ?").get(today) as any
  ).count as number;
  const groupCount = (
    db.prepare("SELECT COUNT(*) AS count FROM groups_list WHERE active = 1").get() as any
  ).count as number;
  const runCount = (
    db
      .prepare("SELECT COUNT(*) AS count FROM runs WHERE date(created_at, '+7 hours') = ?")
      .get(today) as any
  ).count as number;
  const successCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM run_targets WHERE status IN ('published', 'pending_review')",
      )
      .get() as any
  ).count as number;
  return { today, draftCount, groupCount, runCount, successCount };
}

export function closeDatabase(): void {
  db.close();
}
