import { spawn } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";

const port = 4179;
const dataDirectory = path.resolve("test-results", `system-${Date.now()}`);

function startServer(extraEnv) {
  return spawn(process.execPath, ["dist/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HR_AUTO_DATA_DIR: dataDirectory,
      HR_AUTO_MIN_FREE_MEMORY_MB: "",
      HR_AUTO_MIN_FREE_MEMORY_RATIO: "",
      HR_AUTO_REMOTE_VIEW_URL: "",
      DISPLAY: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function getJson(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${url}`);
      if (response.ok) return response.json();
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Test server did not answer ${url}`);
}

async function withServer(extraEnv, check) {
  const server = startServer(extraEnv);
  try {
    await check();
  } finally {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
}

// Desktop defaults stay exactly as before when nothing is configured.
await withServer({}, async () => {
  const health = await getJson("/api/health");
  assert.equal(health.edition, "server");
  assert.match(health.version, /server/);

  const system = await getJson("/api/system");
  assert.equal(system.memoryGuard.minFreeBytes, 4096 * 1024 * 1024);
  assert.equal(system.memoryGuard.minFreeRatio, 0.12);
  assert.ok(system.memory.totalBytes > 0);
  assert.ok(system.memory.availableBytes > 0);
  assert.ok(system.memory.availableBytes <= system.memory.totalBytes);
  assert.equal(system.remoteViewUrl, null, "no display means no remote view link");
});

// Server overrides are honoured, and a display implies the default noVNC link.
await withServer(
  {
    HR_AUTO_MIN_FREE_MEMORY_MB: "512",
    HR_AUTO_MIN_FREE_MEMORY_RATIO: "0.05",
    DISPLAY: ":99",
  },
  async () => {
    const system = await getJson("/api/system");
    assert.equal(system.memoryGuard.minFreeBytes, 512 * 1024 * 1024);
    assert.equal(system.memoryGuard.minFreeRatio, 0.05);
    assert.equal(system.display, ":99");
    assert.match(system.remoteViewUrl, /\{host\}:6080\/vnc\.html/);
  },
);

// Garbage values fall back to the safe desktop defaults instead of disabling the guard.
await withServer({ HR_AUTO_MIN_FREE_MEMORY_MB: "abc", HR_AUTO_MIN_FREE_MEMORY_RATIO: "-1" }, async () => {
  const system = await getJson("/api/system");
  assert.equal(system.memoryGuard.minFreeBytes, 4096 * 1024 * 1024);
  assert.equal(system.memoryGuard.minFreeRatio, 0.12);
});

console.log("system-status: ok");
