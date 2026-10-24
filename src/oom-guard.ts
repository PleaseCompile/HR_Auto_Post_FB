/**
 * Out-of-memory priorities (Linux only).
 *
 * If a small server runs out of memory, the kernel kills the process with the
 * highest oom_score_adj. We want that to be a Chromium process, never the
 * HR Auto server itself: losing a tab is recoverable (the target goes back to
 * the queue and the browser is relaunched), losing the server stops every
 * queue at once.
 *
 * systemd starts the server with OOMScoreAdjust=-500; Chromium inherits that,
 * so every few seconds we raise our own Chromium processes to +600. Raising a
 * value needs no privileges, only lowering does.
 */
import fs from "node:fs";

const CHROMIUM_OOM_SCORE = 600;
const INTERVAL_MS = 10_000;
const chromiumNames = /^(chrome|chromium|headless_shell|chrome_crashpad)/;

function raiseChromiumPriority(uid: number): void {
  let entries: string[];
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const status = fs.readFileSync(`/proc/${entry}/status`, "utf8");
      const name = /^Name:\s*(\S+)/m.exec(status)?.[1] || "";
      const owner = Number(/^Uid:\s*(\d+)/m.exec(status)?.[1]);
      if (owner !== uid || !chromiumNames.test(name)) continue;
      const scorePath = `/proc/${entry}/oom_score_adj`;
      if (Number(fs.readFileSync(scorePath, "utf8")) >= CHROMIUM_OOM_SCORE) continue;
      fs.writeFileSync(scorePath, String(CHROMIUM_OOM_SCORE));
    } catch {
      // The process exited meanwhile, or is not ours: skip it.
    }
  }
}

export function startOomGuard(): void {
  if (process.platform !== "linux" || typeof process.getuid !== "function") return;
  const uid = process.getuid();
  const timer = setInterval(() => raiseChromiumPriority(uid), INTERVAL_MS);
  timer.unref();
  raiseChromiumPriority(uid);
}
