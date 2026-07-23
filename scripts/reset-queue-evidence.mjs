import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const projectRoot = path.resolve(import.meta.dirname, "..");
const dataDirectory = path.resolve(
  process.env.HR_AUTO_DATA_DIR || path.join(projectRoot, "data"),
);
const databasePath = path.join(dataDirectory, "hr-auto.sqlite");
const evidenceDirectory = path.join(dataDirectory, "evidence");
const expectedEvidenceDirectory = path.resolve(dataDirectory, "evidence");

if (
  path.resolve(evidenceDirectory) !== expectedEvidenceDirectory ||
  evidenceDirectory === dataDirectory ||
  !evidenceDirectory.startsWith(`${dataDirectory}${path.sep}`)
) {
  throw new Error(`Refusing to clear unexpected evidence path: ${evidenceDirectory}`);
}
if (!fs.existsSync(databasePath)) {
  throw new Error(`Database not found: ${databasePath}`);
}

const db = new Database(databasePath);
db.pragma("foreign_keys = ON");
const tables = [
  "runs",
  "run_targets",
  "manual_evidence",
  "drafts",
  "media",
  "groups_list",
];
const tableExists = (table) =>
  Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
const counts = () =>
  Object.fromEntries(
    tables.map((table) => [
      table,
      tableExists(table)
        ? db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
        : 0,
    ]),
  );

const before = counts();
db.transaction(() => {
  if (tableExists("manual_evidence")) db.prepare("DELETE FROM manual_evidence").run();
  db.prepare("DELETE FROM run_targets").run();
  db.prepare("DELETE FROM runs").run();
})();
const after = counts();
db.close();

const evidenceFilesBefore = fs.existsSync(evidenceDirectory)
  ? fs.readdirSync(evidenceDirectory, { recursive: true, withFileTypes: true }).filter(
      (entry) => entry.isFile(),
    ).length
  : 0;

fs.mkdirSync(evidenceDirectory, { recursive: true });
for (const entry of fs.readdirSync(evidenceDirectory, { withFileTypes: true })) {
  const target = path.join(evidenceDirectory, entry.name);
  if (path.dirname(target) !== evidenceDirectory) {
    throw new Error(`Refusing to remove path outside evidence directory: ${target}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
}
fs.mkdirSync(path.join(evidenceDirectory, "manual"), { recursive: true });

const evidenceFilesAfter = fs.readdirSync(evidenceDirectory, {
  recursive: true,
  withFileTypes: true,
}).filter((entry) => entry.isFile()).length;

console.log(
  JSON.stringify(
    {
      databasePath,
      evidenceDirectory,
      before,
      after,
      evidenceFilesBefore,
      evidenceFilesAfter,
    },
    null,
    2,
  ),
);
