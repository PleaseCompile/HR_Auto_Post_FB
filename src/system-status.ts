import fs from "node:fs";
import os from "node:os";
import { dataDirectory } from "./config.js";

const MEBIBYTE = 1024 * 1024;

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// Defaults match the desktop build so Windows behaviour is unchanged unless
// a server operator sets these explicitly.
export const memoryGuard = {
  minFreeBytes: numberFromEnv("HR_AUTO_MIN_FREE_MEMORY_MB", 4096) * MEBIBYTE,
  minFreeRatio: numberFromEnv("HR_AUTO_MIN_FREE_MEMORY_RATIO", 0.12),
};

/**
 * Memory a new Chromium tab can actually use. On Linux os.freemem() may report
 * MemFree, which excludes reclaimable page cache and makes a healthy server
 * look nearly full, so MemAvailable is read from /proc/meminfo directly.
 */
export function availableMemoryBytes(): number {
  if (process.platform === "linux") {
    try {
      const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(
        fs.readFileSync("/proc/meminfo", "utf8"),
      );
      if (match) return Number(match[1]) * 1024;
    } catch {
      // Fall back to Node's figure below.
    }
  }
  return os.freemem();
}

export function hasMemoryPressure(): boolean {
  const available = availableMemoryBytes();
  const total = os.totalmem();
  return (
    available < memoryGuard.minFreeBytes ||
    (total > 0 && available / total < memoryGuard.minFreeRatio)
  );
}

export function systemStatus() {
  let disk: { freeBytes: number; totalBytes: number } | null = null;
  try {
    const stats = fs.statfsSync(dataDirectory);
    disk = {
      freeBytes: stats.bavail * stats.bsize,
      totalBytes: stats.blocks * stats.bsize,
    };
  } catch {
    disk = null;
  }
  return {
    edition: "server",
    platform: process.platform,
    hostname: os.hostname(),
    uptimeSeconds: Math.round(os.uptime()),
    appUptimeSeconds: Math.round(process.uptime()),
    loadAverage: os.loadavg(),
    cpuCount: os.cpus().length,
    memory: {
      availableBytes: availableMemoryBytes(),
      totalBytes: os.totalmem(),
    },
    memoryGuard,
    disk,
    display: process.env.DISPLAY || null,
    headless: process.env.HR_AUTO_HEADLESS === "true",
    remoteViewUrl:
      process.env.HR_AUTO_REMOTE_VIEW_URL ||
      (process.env.DISPLAY ? "http://{host}:6080/vnc.html?autoconnect=1&resize=scale" : null),
  };
}
