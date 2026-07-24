import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";
import {
  addMedia,
  addManualEvidence,
  createDraft,
  createRun,
  dashboardSummary,
  deleteRun,
  deleteManualEvidence,
  deleteMedia,
  getDraft,
  getManualEvidence,
  getMedia,
  getRun,
  getRunTarget,
  listDrafts,
  listGroups,
  listManualEvidence,
  listRuns,
  restartDraftRun,
  updateDraft,
  updateManualEvidence,
  updateRunWorkflow,
  upsertGroup,
} from "./db.js";
import {
  dataDirectory,
  evidenceDirectory,
  groupScanDirectory,
  manualEvidenceDirectory,
  port,
  projectRoot,
  publicDirectory,
  uploadDirectory,
} from "./config.js";
import { browserSession } from "./session.js";
import { runManager } from "./run-manager.js";
import type { GroupRecord } from "./types.js";
import { groupScanner } from "./group-scanner.js";

const app = express();
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
  fileFilter: (_request, file, callback) => {
    callback(
      null,
      ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype),
    );
  },
});
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter: (_request, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype)) {
      return callback(new Error("รองรับเฉพาะไฟล์ JPG, PNG, WebP และ GIF"));
    }
    callback(null, true);
  },
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(publicDirectory));

const draftSchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(["morning", "midday", "evening"]),
  text: z.string().trim().min(1).max(20_000),
  status: z.enum(["draft", "ready", "archived"]).optional(),
});

const groupSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(300),
  url: z
    .string()
    .url()
    .refine((value) => {
      const host = new URL(value).hostname.toLowerCase();
      return host === "facebook.com" || host.endsWith(".facebook.com");
    }, "URL ต้องเป็น Facebook"),
  province: z.string().trim().max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  canPost: z.enum(["yes", "no", "unknown"]).optional(),
  requiresApproval: z.boolean().optional(),
  note: z.string().max(2_000).optional(),
  active: z.boolean().optional(),
});

function asyncRoute(
  handler: (request: express.Request, response: express.Response) => Promise<void>,
) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    handler(request, response).catch(next);
  };
}

const evidenceExtensionByMime: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function isValidImageBuffer(file: Express.Multer.File): boolean {
  const buffer = file.buffer;
  if (file.mimetype === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (file.mimetype === "image/png") {
    return (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  if (file.mimetype === "image/gif") {
    return buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6));
  }
  if (file.mimetype === "image/webp") {
    return (
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    );
  }
  return false;
}

function publicManualEvidence(evidence: ReturnType<typeof getManualEvidence>) {
  if (!evidence) return null;
  const { storedPath: _storedPath, ...safeEvidence } = evidence;
  return {
    ...safeEvidence,
    url: `/api/manual-evidence/${evidence.id}/file`,
  };
}

function deleteEvidenceFiles(storedPaths: string[]): number {
  const safeRoots = [evidenceDirectory, manualEvidenceDirectory].map(
    (directory) => `${path.resolve(directory)}${path.sep}`,
  );
  let deleted = 0;
  for (const storedPath of storedPaths) {
    const resolved = path.resolve(storedPath);
    if (safeRoots.some((root) => resolved.startsWith(root)) && fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
      deleted += 1;
    }
  }
  return deleted;
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, version: "0.1.0", dataDirectory });
});

app.get("/api/dashboard", asyncRoute(async (_request, response) => {
  response.json({
    summary: dashboardSummary(),
    session: await browserSession.status(),
    drafts: listDrafts(12),
    recentRuns: listRuns(5),
  });
}));

app.get("/api/session", asyncRoute(async (_request, response) => {
  response.json(await browserSession.status());
}));

app.post("/api/session/connect", asyncRoute(async (_request, response) => {
  response.json(await browserSession.launch());
}));

app.post("/api/session/close", asyncRoute(async (_request, response) => {
  await browserSession.close();
  response.json({ ok: true });
}));

app.get("/api/drafts", (_request, response) => {
  response.json(listDrafts());
});

app.post("/api/drafts", (request, response) => {
  const input = draftSchema.parse(request.body);
  response.status(201).json(createDraft(input));
});

app.put("/api/drafts/:id", (request, response) => {
  const input = draftSchema.partial().parse(request.body);
  const draft = updateDraft(String(request.params.id), input);
  if (!draft) return response.status(404).json({ error: "ไม่พบ Draft" });
  response.json(draft);
});

app.post("/api/drafts/:id/media", imageUpload.array("images", 10), (request, response) => {
  const draft = getDraft(String(request.params.id));
  if (!draft) return response.status(404).json({ error: "ไม่พบ Draft" });
  const files = (request.files || []) as Express.Multer.File[];
  if (!files.length) return response.status(400).json({ error: "กรุณาเลือกรูป" });
  const draftFolder = path.join(uploadDirectory, draft.id);
  fs.mkdirSync(draftFolder, { recursive: true });
  const added = files.map((file) => {
    const extension = path.extname(file.originalname).toLowerCase().slice(0, 10);
    const storedPath = path.join(draftFolder, `${randomUUID()}${extension}`);
    fs.writeFileSync(storedPath, file.buffer, { mode: 0o600 });
    return addMedia({
      draftId: draft.id,
      fileName: file.originalname,
      storedPath,
      mimeType: file.mimetype,
    });
  });
  response.status(201).json(added);
});

app.get("/api/media/:id", (request, response) => {
  const media = getMedia(String(request.params.id));
  if (!media || !fs.existsSync(media.storedPath)) {
    return response.status(404).json({ error: "ไม่พบรูป" });
  }
  response.type(media.mimeType).sendFile(path.resolve(media.storedPath));
});

app.delete("/api/media/:id", (request, response) => {
  const media = deleteMedia(String(request.params.id));
  if (!media) return response.status(404).json({ error: "ไม่พบรูป" });
  const resolved = path.resolve(media.storedPath);
  const safeRoot = `${path.resolve(uploadDirectory)}${path.sep}`;
  if (resolved.startsWith(safeRoot) && fs.existsSync(resolved)) fs.unlinkSync(resolved);
  response.json({ ok: true });
});

app.get("/api/groups", (_request, response) => {
  response.json(listGroups());
});

app.post("/api/groups", (request, response) => {
  const input = groupSchema.parse(request.body);
  response.status(201).json(upsertGroup(input));
});

app.post("/api/groups/import", csvUpload.single("file"), (request, response) => {
  if (!request.file) return response.status(400).json({ error: "กรุณาเลือกไฟล์ CSV" });
  const rows = parseCsv(request.file.buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];
  const imported: GroupRecord[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  rows.forEach((row, index) => {
    try {
      const tags = (row.tags || "")
        .split(/[|,]/)
        .map((tag) => tag.trim())
        .filter(Boolean);
      const parsed = groupSchema.parse({
        name: row.name,
        url: row.url,
        province: row.province || "",
        tags,
        canPost: ["yes", "no", "unknown"].includes(row.can_post || "")
          ? row.can_post
          : "unknown",
        requiresApproval: ["yes", "true", "1"].includes(
          (row.requires_approval || "").toLowerCase(),
        ),
        note: row.note || "",
        active: !["no", "false", "0"].includes((row.active || "yes").toLowerCase()),
      });
      imported.push(upsertGroup({ ...parsed, source: "csv" }));
    } catch (error) {
      errors.push({
        row: index + 2,
        message: error instanceof Error ? error.message : "ข้อมูลไม่ถูกต้อง",
      });
    }
  });
  response.json({ imported: imported.length, errors, groups: imported });
});

app.get("/api/groups/scan", (_request, response) => {
  response.json(groupScanner.status());
});

app.post("/api/groups/scan/start", asyncRoute(async (request, response) => {
  const input = z
    .object({
      acknowledged: z.literal(true, {
        error: "กรุณายืนยันว่าใช้กับบัญชีและกลุ่มที่คุณมีสิทธิ์เข้าถึง",
      }),
      maxScrolls: z.number().int().min(10).max(500).optional(),
    })
    .parse(request.body);
  if (runManager.isBusy()) {
    throw new Error("มีคิวโพสต์กำลังทำงาน กรุณาหยุดหรือรอให้คิวจบก่อนสแกนกลุ่ม");
  }
  response.status(202).json(await groupScanner.start({ maxScrolls: input.maxScrolls }));
}));

app.post("/api/groups/scan/stop", (_request, response) => {
  response.json(groupScanner.stop());
});

app.get("/api/groups/scan/snapshot", (_request, response) => {
  const snapshotPath = groupScanner.status().snapshotPath;
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    return response.status(404).json({ error: "ยังไม่มี JSON snapshot" });
  }
  const resolved = path.resolve(snapshotPath);
  const safeRoot = `${path.resolve(groupScanDirectory)}${path.sep}`;
  if (!resolved.startsWith(safeRoot)) return response.status(403).end();
  response.download(resolved);
});

app.get("/api/runs", (_request, response) => {
  response.json(listRuns());
});

app.get("/api/runs/:id", (request, response) => {
  const run = getRun(String(request.params.id));
  if (!run) return response.status(404).json({ error: "ไม่พบคิวงาน" });
  response.json(run);
});

app.delete("/api/runs/:id", (request, response) => {
  const runId = String(request.params.id);
  if (runManager.isRunActive(runId)) {
    return response.status(409).json({ error: "คิวนี้ยังทำงานอยู่ กรุณาหยุดคิวก่อนลบ" });
  }
  const input = z
    .object({
      acknowledgedUncertain: z.boolean().optional().default(false),
      acknowledgedPosted: z.boolean().optional().default(false),
    })
    .parse(request.body || {});
  const deleted = deleteRun(runId, input);
  if (!deleted) return response.status(404).json({ error: "ไม่พบคิวงาน" });

  const deletedEvidenceFiles = deleteEvidenceFiles(deleted.evidencePaths);
  response.json({
    ok: true,
    runId: deleted.runId,
    targetCount: deleted.targetCount,
    deletedEvidenceFiles,
  });
});

app.post("/api/runs", (request, response) => {
  const input = z
    .object({
      draftId: z.string().uuid(),
      groupIds: z.array(z.string().uuid()).min(1).max(250),
      mode: z.enum(["assisted", "dry-run"]),
      workflow: z.enum(["sequential", "hybrid-tabs"]).optional(),
      tabLimit: z.number().int().min(0).max(250).optional(),
    })
    .parse(request.body);
  if (!getDraft(input.draftId)) return response.status(404).json({ error: "ไม่พบ Draft" });
  response.status(201).json(createRun(input));
});

app.post("/api/runs/restart-draft", (request, response) => {
  const input = z
    .object({
      draftId: z.string().uuid(),
      groupIds: z.array(z.string().uuid()).min(1).max(250),
      mode: z.enum(["assisted", "dry-run"]),
      workflow: z.enum(["sequential", "hybrid-tabs"]).optional(),
      tabLimit: z.number().int().min(0).max(250).optional(),
      acknowledgedUncertain: z.boolean(),
      acknowledgedPosted: z.boolean(),
    })
    .parse(request.body);
  if (!getDraft(input.draftId)) {
    return response.status(404).json({ error: "ไม่พบ Draft" });
  }
  if (runManager.isBusy()) {
    return response.status(409).json({
      error: "ยังมีคิวกำลังทำงาน กรุณาหยุดคิวและรอให้แท็บ Facebook ปิดครบก่อนเริ่มใหม่ทั้งหมด",
    });
  }
  const restarted = restartDraftRun(
    {
      draftId: input.draftId,
      groupIds: input.groupIds,
      mode: input.mode,
      workflow: input.workflow,
      tabLimit: input.tabLimit,
    },
    {
      acknowledgedUncertain: input.acknowledgedUncertain,
      acknowledgedPosted: input.acknowledgedPosted,
    },
  );
  const deletedEvidenceFiles = deleteEvidenceFiles(restarted.evidencePaths);
  response.status(201).json({
    ...restarted.run,
    reset: {
      deletedRunCount: restarted.deletedRunCount,
      deletedTargetCount: restarted.deletedTargetCount,
      deletedEvidenceFiles,
    },
  });
});

app.post("/api/runs/:id/start", (request, response) => {
  if (groupScanner.isBusy()) {
    return response.status(409).json({ error: "กำลังสแกนกลุ่ม กรุณารอให้สแกนจบก่อนเริ่มคิว" });
  }
  runManager.start(String(request.params.id));
  response.status(202).json({ ok: true });
});

app.post("/api/runs/:id/workflow", (request, response) => {
  const input = z
    .object({
      workflow: z.enum(["sequential", "hybrid-tabs"]),
      tabLimit: z.number().int().min(0).max(250).default(0),
    })
    .parse(request.body);
  const run = updateRunWorkflow(
    String(request.params.id),
    input.workflow,
    input.tabLimit,
  );
  if (!run) return response.status(404).json({ error: "ไม่พบคิวงาน" });
  response.json(run);
});

app.post("/api/runs/:id/pause", (request, response) => {
  runManager.pause(String(request.params.id));
  response.json({ ok: true });
});

app.post("/api/runs/:id/resume", (request, response) => {
  runManager.resume(String(request.params.id));
  response.json({ ok: true });
});

app.post("/api/runs/:id/stop", (request, response) => {
  runManager.stop(String(request.params.id));
  response.json({ ok: true });
});

app.post("/api/runs/:runId/targets/:targetId/action", asyncRoute(async (request, response) => {
  const input = z
    .object({
      action: z.enum(["confirm", "skip", "mark-posted"]),
      reason: z.string().trim().max(500).optional(),
    })
    .parse(request.body);
  await runManager.action(
    String(request.params.runId),
    String(request.params.targetId),
    input.action,
    input.reason,
  );
  response.json({ ok: true });
}));

app.post("/api/runs/:runId/targets/:targetId/focus", asyncRoute(async (request, response) => {
  await runManager.focusTarget(String(request.params.runId), String(request.params.targetId));
  response.json({ ok: true });
}));

app.post("/api/runs/:runId/targets/:targetId/reconcile-posted", asyncRoute(async (request, response) => {
  await runManager.reconcilePosted(
    String(request.params.runId),
    String(request.params.targetId),
  );
  response.json({ ok: true });
}));

app.get("/api/evidence/:targetId", (request, response) => {
  const target = listRuns()
    .flatMap((run) => run.targets || [])
    .find((item) => item.id === String(request.params.targetId));
  if (!target?.evidencePath || !fs.existsSync(target.evidencePath)) {
    return response.status(404).json({ error: "ไม่พบหลักฐาน" });
  }
  const resolved = path.resolve(target.evidencePath);
  const safeRoot = `${path.resolve(evidenceDirectory)}${path.sep}`;
  if (!resolved.startsWith(safeRoot)) return response.status(403).end();
  response.sendFile(resolved);
});

app.get("/api/manual-evidence", (request, response) => {
  const targetId =
    typeof request.query.targetId === "string"
      ? z.string().uuid().parse(request.query.targetId)
      : undefined;
  response.json(listManualEvidence(targetId).map((item) => publicManualEvidence(item)));
});

app.get("/api/run-targets/:targetId/evidence", (request, response) => {
  const target = getRunTarget(String(request.params.targetId));
  if (!target) return response.status(404).json({ error: "ไม่พบรายการกลุ่ม" });
  response.json({
    system: target.evidencePath
      ? {
          targetId: target.id,
          fileName: path.basename(target.evidencePath),
          url: `/api/evidence/${target.id}`,
        }
      : null,
    manual: listManualEvidence(target.id).map((item) => publicManualEvidence(item)),
  });
});

app.post(
  "/api/run-targets/:targetId/evidence",
  evidenceUpload.array("files", 5),
  (request, response) => {
    const target = getRunTarget(String(request.params.targetId));
    if (!target) return response.status(404).json({ error: "ไม่พบรายการกลุ่ม" });
    const files = (request.files || []) as Express.Multer.File[];
    if (!files.length) return response.status(400).json({ error: "กรุณาเลือกรูปหลักฐาน" });
    if (files.some((file) => !isValidImageBuffer(file))) {
      return response.status(400).json({
        error: "ไฟล์รูปไม่ถูกต้องหรือเนื้อหาไฟล์ไม่ตรงกับชนิด JPG, PNG, WebP หรือ GIF",
      });
    }
    const note = z.string().trim().max(500).catch("").parse(request.body.note);
    const folder = path.join(manualEvidenceDirectory, target.id);
    fs.mkdirSync(folder, { recursive: true });
    const added = files.map((file) => {
      const storedPath = path.join(
        folder,
        `${randomUUID()}${evidenceExtensionByMime[file.mimetype]}`,
      );
      fs.writeFileSync(storedPath, file.buffer, { mode: 0o600 });
      return addManualEvidence({
        targetId: target.id,
        fileName: file.originalname,
        storedPath,
        mimeType: file.mimetype,
        note,
      });
    });
    response.status(201).json(added.map((item) => publicManualEvidence(item)));
  },
);

app.get("/api/manual-evidence/:id/file", (request, response) => {
  const evidence = getManualEvidence(String(request.params.id));
  if (!evidence || !fs.existsSync(evidence.storedPath)) {
    return response.status(404).json({ error: "ไม่พบไฟล์หลักฐาน" });
  }
  const resolved = path.resolve(evidence.storedPath);
  const safeRoot = `${path.resolve(manualEvidenceDirectory)}${path.sep}`;
  if (!resolved.startsWith(safeRoot)) return response.status(403).end();
  response.type(evidence.mimeType).sendFile(resolved);
});

app.put(
  "/api/manual-evidence/:id",
  evidenceUpload.single("file"),
  (request, response) => {
    const current = getManualEvidence(String(request.params.id));
    if (!current) return response.status(404).json({ error: "ไม่พบหลักฐาน" });
    const note =
      request.body.note === undefined
        ? current.note
        : z.string().trim().max(500).parse(request.body.note);
    const file = request.file;
    if (file && !isValidImageBuffer(file)) {
      return response.status(400).json({
        error: "ไฟล์รูปไม่ถูกต้องหรือเนื้อหาไฟล์ไม่ตรงกับชนิด JPG, PNG, WebP หรือ GIF",
      });
    }
    let storedPath: string | undefined;
    if (file) {
      const folder = path.join(manualEvidenceDirectory, current.targetId);
      fs.mkdirSync(folder, { recursive: true });
      storedPath = path.join(
        folder,
        `${randomUUID()}${evidenceExtensionByMime[file.mimetype]}`,
      );
      fs.writeFileSync(storedPath, file.buffer, { mode: 0o600 });
    }
    const updated = updateManualEvidence(current.id, {
      note,
      ...(file && storedPath
        ? {
            fileName: file.originalname,
            storedPath,
            mimeType: file.mimetype,
          }
        : {}),
    });
    if (file && storedPath) {
      const oldResolved = path.resolve(current.storedPath);
      const safeRoot = `${path.resolve(manualEvidenceDirectory)}${path.sep}`;
      if (oldResolved.startsWith(safeRoot) && fs.existsSync(oldResolved)) {
        fs.unlinkSync(oldResolved);
      }
    }
    response.json(publicManualEvidence(updated));
  },
);

app.delete("/api/manual-evidence/:id", (request, response) => {
  const evidence = deleteManualEvidence(String(request.params.id));
  if (!evidence) return response.status(404).json({ error: "ไม่พบหลักฐาน" });
  const resolved = path.resolve(evidence.storedPath);
  const safeRoot = `${path.resolve(manualEvidenceDirectory)}${path.sep}`;
  if (resolved.startsWith(safeRoot) && fs.existsSync(resolved)) fs.unlinkSync(resolved);
  response.json({ ok: true });
});

app.use((_request, response) => {
  response.sendFile(path.join(publicDirectory, "index.html"));
});

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    const message =
      error instanceof z.ZodError
        ? error.issues.map((issue) => issue.message).join(", ")
        : error instanceof Error
          ? error.message
          : "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
    console.error(error);
    response.status(400).json({ error: message });
  },
);

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`HR Auto พร้อมใช้งานที่ http://127.0.0.1:${port}`);
  console.log(`ข้อมูลถูกเก็บไว้ที่ ${dataDirectory}`);
});

async function shutdown() {
  await browserSession.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

process.on("uncaughtException", (error) => {
  console.error(error);
});

console.log(`Project root: ${projectRoot}`);
