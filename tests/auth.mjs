// Shared-password login: everything is locked without a session, sessions are
// signed and survive restarts, guessing is rate limited, cross-site writes are
// refused, and the audit log records who did what.
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";

const port = 4186;
const base = `http://127.0.0.1:${port}`;
const dataDirectory = path.resolve("test-results", `auth-${Date.now()}`);
const password = "correct horse battery";
const makeHash = (value) =>
  execFileSync(process.execPath, ["dist/hash-password.js"], { input: value }).toString().trim();
const passwordHash = makeHash(password);

let server;
async function startServer(hash) {
  server = spawn(process.execPath, ["dist/server.js"], {
    env: { ...process.env, PORT: String(port), HR_AUTO_DATA_DIR: dataDirectory, HR_AUTO_PASSWORD_HASH: hash },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("server did not start");
}
async function stopServer() {
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill();
  await exited;
}

const request = (url, { headers = {}, ...options } = {}) =>
  fetch(`${base}${url}`, { redirect: "manual", ...options, headers: { "Content-Type": "application/json", ...headers } });
const login = (body, headers = {}) =>
  request("/api/auth/login", { method: "POST", body: JSON.stringify(body), headers });
const cookieFrom = (response) => (response.headers.get("set-cookie") || "").split(";")[0];

let failures = 0;
async function check(name, task) {
  try {
    await task();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ ${name}\n    ${error.message}`);
  }
}

console.log("Shared-password login");
assert.match(passwordHash, /^scrypt:32768:8:1:/);
assert.throws(
  () => execFileSync(process.execPath, ["dist/hash-password.js"], { input: "short", stdio: "pipe" }),
  "passwords under 10 characters are refused",
);
await startServer(passwordHash);
let cookie = "";

await check("everything is locked without a session", async () => {
  const api = await request("/api/runs");
  assert.equal(api.status, 401);
  assert.equal((await api.json()).code, "AUTH_REQUIRED");
  const page = await request("/");
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "/login");
  assert.equal((await request("/app.js")).status, 302);
  assert.equal((await request("/api/auth/check")).status, 401);
  assert.equal((await request("/login")).status, 200);
});

await check("health is open locally but locked through Nginx", async () => {
  assert.equal((await request("/api/health")).status, 200);
  assert.equal((await request("/api/health", { headers: { "X-Real-IP": "203.0.113.9" } })).status, 401);
});

await check("wrong password is refused and guessing gets locked per address", async () => {
  const attacker = { "X-Real-IP": "198.51.100.7" };
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await login({ password: `wrong-${attempt}` }, attacker);
    assert.equal(response.status, 401);
  }
  const locked = await login({ password }, attacker);
  assert.equal(locked.status, 429, "even the right password is refused while locked");
  const otherAddress = await login({ password: "nope" }, { "X-Real-IP": "198.51.100.8" });
  assert.equal(otherAddress.status, 401, "other addresses are not locked out");
});

await check("right password signs in with a strict, http-only cookie", async () => {
  const response = await login({ password, name: "ต้น" }, { "X-Real-IP": "192.0.2.10" });
  assert.equal(response.status, 200);
  const header = response.headers.get("set-cookie") || "";
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.doesNotMatch(header, /Secure/, "no Secure flag over plain http");
  cookie = cookieFrom(response);
  const https = await login({ password, name: "ต้น" }, { "X-Real-IP": "192.0.2.10", "X-Forwarded-Proto": "https" });
  assert.match(https.headers.get("set-cookie") || "", /Secure/, "Secure flag behind HTTPS");
});

await check("a session opens the app, the API and the browser view", async () => {
  assert.equal((await request("/api/runs", { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await request("/", { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await request("/api/auth/check", { headers: { Cookie: cookie } })).status, 204);
  const me = await (await request("/api/auth/me", { headers: { Cookie: cookie } })).json();
  assert.deepEqual(me, { enabled: true, signedIn: true, name: "ต้น" });
});

await check("a tampered cookie is rejected", async () => {
  const [payload, signature] = cookie.split("=")[1].split(".");
  const forged = Buffer.from(JSON.stringify({ name: "admin", issuedAt: Date.now(), expiresAt: Date.now() + 1e9 })).toString("base64url");
  for (const value of [`${forged}.${signature}`, `${payload}.AAAA`, "garbage"]) {
    const response = await request("/api/runs", { headers: { Cookie: `hr_auto_session=${value}` } });
    assert.equal(response.status, 401, `cookie ${value.slice(0, 12)}… must be rejected`);
  }
});

await check("writes from another site are refused", async () => {
  const draft = JSON.stringify({ workDate: "2026-10-25", slot: "evening", text: "csrf test" });
  const evil = await request("/api/drafts", {
    method: "POST",
    body: draft,
    headers: { Cookie: cookie, Origin: "https://evil.example" },
  });
  assert.equal(evil.status, 403);
  const own = await request("/api/drafts", {
    method: "POST",
    body: draft,
    headers: { Cookie: cookie, Origin: base },
  });
  assert.equal(own.status, 201);
});

await check("the audit log records who did what", async () => {
  const entries = await (await request("/api/audit?limit=50", { headers: { Cookie: cookie } })).json();
  assert.ok(entries.some((entry) => entry.event === "login" && entry.user === "ต้น"));
  assert.ok(entries.some((entry) => entry.event === "login_failed"));
  assert.ok(entries.some((entry) => entry.event === "login_locked"));
  assert.ok(
    entries.some((entry) => entry.event === "action" && entry.user === "ต้น" && entry.path === "/api/drafts" && entry.status === 201),
  );
});

await check("sessions survive a restart, but not a password change", async () => {
  await stopServer();
  await startServer(passwordHash);
  assert.equal((await request("/api/runs", { headers: { Cookie: cookie } })).status, 200);
  await stopServer();
  await startServer(makeHash("a brand new team password"));
  assert.equal((await request("/api/runs", { headers: { Cookie: cookie } })).status, 401);
});

await check("logout clears the cookie", async () => {
  const response = await request("/api/auth/logout", { method: "POST", headers: { Cookie: cookie } });
  assert.match(response.headers.get("set-cookie") || "", /Max-Age=0/);
});

await stopServer();
fs.rmSync(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
if (failures) {
  console.log(`\nAuth test: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("Auth test passed");
