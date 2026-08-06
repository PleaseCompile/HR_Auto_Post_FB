import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const dataDirectory = path.resolve("test-results", `window-session-${Date.now()}`);
fs.mkdirSync(dataDirectory, { recursive: true });
process.env.HR_AUTO_DATA_DIR = dataDirectory;

const mockServer = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end("<!doctype html><title>Window session test</title><body>ready</body>");
});
await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
const address = mockServer.address();
if (!address || typeof address === "string") throw new Error("Mock server did not start");
process.env.HR_AUTO_SESSION_HOME_URL = `http://127.0.0.1:${address.port}/`;

const { browserSession } = await import("../dist/session.js");

async function browserWindowId(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { targetInfo } = await cdp.send("Target.getTargetInfo");
    const { windowId } = await cdp.send("Browser.getWindowForTarget", {
      targetId: targetInfo.targetId,
    });
    return windowId;
  } finally {
    await cdp.detach();
  }
}

try {
  const lockPath = path.join(dataDirectory, "browser-session.lock");
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      pid: process.ppid,
      startedAt: new Date().toISOString(),
      profile: path.join(dataDirectory, "browser-profile"),
    }),
  );
  let lockWasEnforced = false;
  try {
    await browserSession.launch();
  } catch (error) {
    lockWasEnforced = String(error).includes(`PID ${process.ppid}`);
  }
  if (!lockWasEnforced) {
    throw new Error("Browser profile ownership lock did not block another live process");
  }
  fs.rmSync(lockPath, { force: true });

  await browserSession.launch();
  const status = await browserSession.status();
  if (!status.browserOpen || status.ownerPid !== process.pid || !status.profileLocked) {
    throw new Error("Browser session health did not expose its profile owner");
  }
  const firstWindow = await browserSession.newWindow();
  const firstWindowSecondTab = await browserSession.newPageInWindow(firstWindow);
  const secondWindow = await browserSession.newWindow();

  const firstWindowId = await browserWindowId(firstWindow);
  const firstWindowSecondTabId = await browserWindowId(firstWindowSecondTab);
  const secondWindowId = await browserWindowId(secondWindow);
  if (firstWindowId !== firstWindowSecondTabId) {
    throw new Error("A tab created for the first window was placed in another window");
  }
  if (firstWindowId === secondWindowId) {
    throw new Error("Creating a new window reused the previous Chrome window");
  }
  console.log("Browser window and same-window tab control test passed");
} finally {
  await browserSession.close();
  if (fs.existsSync(path.join(dataDirectory, "browser-session.lock"))) {
    throw new Error("Browser profile ownership lock was not released on close");
  }
  const eventLogPath = path.join(dataDirectory, "browser-events.jsonl");
  const eventLog = fs.readFileSync(eventLogPath, "utf8");
  if (!eventLog.includes('"event":"session_launched"') || !eventLog.includes('"event":"context_closed"')) {
    throw new Error("Browser session lifecycle was not written to the event log");
  }
  mockServer.close();
}
