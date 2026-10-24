/**
 * Keeps evidence screenshots from filling a small server disk.
 *
 *   HR_AUTO_EVIDENCE_RETENTION_DAYS  delete system screenshots older than this
 *   HR_AUTO_MIN_FREE_DISK_MB         below this much free space, delete the
 *                                    oldest screenshots until there is room
 *
 * Both default to 0 (off), so the desktop build keeps every file as before.
 * Files the team uploaded by hand (evidence/manual) are never touched.
 */
import fs from "node:fs";
import path from "node:path";
import {
  dataDirectory,
  evidenceDirectory,
  manualEvidenceDirectory,
  pendingCleanupDirectory,
} from "./config.js";
import { forgetMissingEvidence } from "./db.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;

const numberFromEnv = (name: string) => {
  const value = Number(process.env[name] || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

export const retentionSettings = {
  days: numberFromEnv("HR_AUTO_EVIDENCE_RETENTION_DAYS"),
  minFreeDiskBytes: numberFromEnv("HR_AUTO_MIN_FREE_DISK_MB") * 1024 * 1024,
};

export interface RetentionResult {
  ranAt: string;
  deletedFiles: number;
  freedBytes: number;
  clearedReferences: number;
  reason: string;
}

export let lastRetention: RetentionResult | null = null;

interface FileInfo {
  filePath: string;
  size: number;
  modifiedAt: number;
}

function collectFiles(directory: string, files: FileInfo[] = []): FileInfo[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (path.resolve(fullPath) === path.resolve(manualEvidenceDirectory)) continue;
      collectFiles(fullPath, files);
    } else if (entry.isFile()) {
      try {
        const stats = fs.statSync(fullPath);
        files.push({ filePath: fullPath, size: stats.size, modifiedAt: stats.mtimeMs });
      } catch {
        // Removed meanwhile.
      }
    }
  }
  return files;
}

function removeEmptyDirectories(directory: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) removeEmptyDirectories(path.join(directory, entry.name));
  }
  const isRoot = [evidenceDirectory, pendingCleanupDirectory, manualEvidenceDirectory]
    .map((item) => path.resolve(item))
    .includes(path.resolve(directory));
  if (!isRoot && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
}

function freeDiskBytes(): number {
  try {
    const stats = fs.statfsSync(dataDirectory);
    return stats.bavail * stats.bsize;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function runRetention(now = Date.now()): RetentionResult {
  const files = [...collectFiles(evidenceDirectory), ...collectFiles(pendingCleanupDirectory)].sort(
    (left, right) => left.modifiedAt - right.modifiedAt,
  );
  let deletedFiles = 0;
  let freedBytes = 0;
  const reasons: string[] = [];
  const remove = (file: FileInfo) => {
    try {
      fs.rmSync(file.filePath, { force: true });
      deletedFiles += 1;
      freedBytes += file.size;
    } catch {
      // Keep going with the rest.
    }
  };

  const remaining: FileInfo[] = [];
  if (retentionSettings.days) {
    const cutoff = now - retentionSettings.days * DAY_MS;
    for (const file of files) {
      if (file.modifiedAt < cutoff) remove(file);
      else remaining.push(file);
    }
    if (deletedFiles) reasons.push(`older than ${retentionSettings.days} days`);
  } else {
    remaining.push(...files);
  }

  if (retentionSettings.minFreeDiskBytes) {
    const target = retentionSettings.minFreeDiskBytes;
    let removedForSpace = 0;
    while (remaining.length && freeDiskBytes() < target) {
      remove(remaining.shift()!);
      removedForSpace += 1;
    }
    if (removedForSpace) reasons.push(`low disk space (${removedForSpace} oldest files)`);
  }

  for (const root of [evidenceDirectory, pendingCleanupDirectory]) removeEmptyDirectories(root);
  const clearedReferences = deletedFiles ? forgetMissingEvidence((filePath) => fs.existsSync(filePath)) : 0;
  lastRetention = {
    ranAt: new Date(now).toISOString(),
    deletedFiles,
    freedBytes,
    clearedReferences,
    reason: reasons.join(", ") || "nothing to delete",
  };
  if (deletedFiles) {
    console.log(
      `[retention] deleted ${deletedFiles} screenshots (${(freedBytes / 1024 / 1024).toFixed(1)} MB): ${lastRetention.reason}`,
    );
  }
  return lastRetention;
}

export function startRetention(): void {
  if (!retentionSettings.days && !retentionSettings.minFreeDiskBytes) return;
  const run = () => {
    try {
      runRetention();
    } catch (error) {
      console.error("[retention] failed", error);
    }
  };
  setTimeout(run, FIRST_RUN_DELAY_MS).unref();
  setInterval(run, INTERVAL_MS).unref();
}
