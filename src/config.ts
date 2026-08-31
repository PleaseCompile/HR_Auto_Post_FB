import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const srcDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(srcDirectory, "..");
export const publicDirectory = path.join(projectRoot, "public");
export const dataDirectory = path.resolve(
  process.env.HR_AUTO_DATA_DIR || path.join(projectRoot, "data"),
);
export const databasePath = path.join(dataDirectory, "hr-auto.sqlite");
export const uploadDirectory = path.join(dataDirectory, "uploads");
export const evidenceDirectory = path.join(dataDirectory, "evidence");
export const manualEvidenceDirectory = path.join(evidenceDirectory, "manual");
export const groupScanDirectory = path.join(dataDirectory, "group-scans");
export const pendingCleanupDirectory = path.join(dataDirectory, "pending-cleanup");
export const browserProfileDirectory = path.join(dataDirectory, "browser-profile");
export const browserSessionLockPath = path.join(dataDirectory, "browser-session.lock");
export const browserEventLogPath = path.join(dataDirectory, "browser-events.jsonl");
export const port = Number(process.env.PORT || 4173);
export const timezone = process.env.HR_AUTO_TIMEZONE || "Asia/Bangkok";

for (const directory of [
  dataDirectory,
  uploadDirectory,
  evidenceDirectory,
  manualEvidenceDirectory,
  groupScanDirectory,
  pendingCleanupDirectory,
  browserProfileDirectory,
]) {
  fs.mkdirSync(directory, { recursive: true });
}
