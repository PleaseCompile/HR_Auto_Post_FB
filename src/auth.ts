/**
 * Shared-password login for the server edition.
 *
 * One password for the whole team (HR_AUTO_PASSWORD_HASH, set by the
 * installer). When it is not set, login is disabled: the desktop build and
 * the test suite keep working exactly as before, and the server is still only
 * reachable on 127.0.0.1.
 *
 * Sessions are stateless signed cookies, so a restart or update does not log
 * the team out. Changing the password changes the signing key and logs
 * everyone out.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type express from "express";
import { dataDirectory } from "./config.js";

const COOKIE_NAME = "hr_auto_session";
const SESSION_DAYS = 30;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const AUDIT_MAX_BYTES = 5 * 1024 * 1024;
export const auditLogPath = path.join(dataDirectory, "audit.jsonl");

// ---- password hashing (scrypt) ----------------------------------------------
// Format: scrypt:N:r:p:<salt base64url>:<hash base64url>  (no "$" so systemd
// EnvironmentFile and shells never try to expand it).
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), hash.toString("base64url")].join(":");
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltText = "", hashText = ""] = parts;
  const expected = Buffer.from(hashText, "base64url");
  if (!expected.length) return false;
  const actual = crypto.scryptSync(password, Buffer.from(saltText, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT_MAXMEM,
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// ---- configuration -----------------------------------------------------------
const passwordHash = (process.env.HR_AUTO_PASSWORD_HASH || "").trim();
export const authEnabled = passwordHash.length > 0;

function loadSecret(): Buffer {
  const secretPath = path.join(dataDirectory, "session-secret");
  try {
    const existing = fs.readFileSync(secretPath);
    if (existing.length >= 32) return existing;
  } catch {
    // Created below.
  }
  const secret = crypto.randomBytes(48);
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

// Key depends on the password hash: a new password invalidates every session.
const signingKey = authEnabled
  ? crypto.createHmac("sha256", loadSecret()).update(passwordHash).digest()
  : Buffer.alloc(0);

interface Session {
  name: string;
  issuedAt: number;
  expiresAt: number;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", signingKey).update(payload).digest("base64url");
}

function encodeSession(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decodeSession(value: string | undefined): Session | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (typeof session.expiresAt !== "number" || session.expiresAt < Date.now()) return null;
    return { name: String(session.name || "").slice(0, 40), issuedAt: session.issuedAt, expiresAt: session.expiresAt };
  } catch {
    return null;
  }
}

function readCookie(request: express.Request, name: string): string | undefined {
  const header = request.headers.cookie || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

function isHttps(request: express.Request): boolean {
  return request.headers["x-forwarded-proto"] === "https";
}

function setSessionCookie(request: express.Request, response: express.Response, session: Session) {
  const parts = [
    `${COOKIE_NAME}=${encodeSession(session)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor((session.expiresAt - Date.now()) / 1000)}`,
  ];
  if (isHttps(request)) parts.push("Secure");
  response.append("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(request: express.Request, response: express.Response) {
  const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (isHttps(request)) parts.push("Secure");
  response.append("Set-Cookie", parts.join("; "));
}

/** Client address. The app only listens on 127.0.0.1, so headers come from Nginx. */
export function clientIp(request: express.Request): string {
  const real = request.headers["x-real-ip"];
  if (typeof real === "string" && real) return real;
  return request.socket.remoteAddress || "unknown";
}

// ---- brute-force protection --------------------------------------------------
const failures = new Map<string, number[]>();

function recentFailures(ip: string): number[] {
  const now = Date.now();
  const list = (failures.get(ip) || []).filter((time) => now - time < FAILURE_WINDOW_MS);
  failures.set(ip, list);
  return list;
}

// ---- audit log ---------------------------------------------------------------
export function audit(entry: Record<string, unknown>): void {
  try {
    if (fs.existsSync(auditLogPath) && fs.statSync(auditLogPath).size > AUDIT_MAX_BYTES) {
      fs.renameSync(auditLogPath, `${auditLogPath}.previous`);
    }
    fs.appendFileSync(auditLogPath, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`, {
      mode: 0o600,
    });
  } catch {
    // Auditing must never break the request that triggered it.
  }
}

export function readAudit(limit = 50): Array<Record<string, unknown>> {
  try {
    const lines = fs.readFileSync(auditLogPath, "utf8").trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

declare module "express-serve-static-core" {
  interface Request {
    session?: Session;
  }
}

// ---- routes and middleware ---------------------------------------------------
const PUBLIC_PATHS = new Set(["/login", "/login.html", "/api/auth/login", "/api/auth/check", "/api/auth/me"]);

export function registerAuth(app: express.Express, publicDirectory: string): void {
  app.get(["/login", "/login.html"], (_request, response) => {
    response.setHeader("Cache-Control", "no-cache");
    response.sendFile(path.join(publicDirectory, "login.html"));
  });

  app.get("/api/auth/me", (request, response) => {
    const session = authEnabled ? decodeSession(readCookie(request, COOKIE_NAME)) : null;
    response.json({
      enabled: authEnabled,
      signedIn: !authEnabled || Boolean(session),
      name: session?.name || null,
    });
  });

  // Used by Nginx auth_request to guard the noVNC browser view.
  app.get("/api/auth/check", (request, response) => {
    if (!authEnabled || decodeSession(readCookie(request, COOKIE_NAME))) {
      response.status(204).end();
    } else {
      response.status(401).end();
    }
  });

  app.post("/api/auth/login", (request, response) => {
    if (!authEnabled) {
      response.json({ ok: true });
      return;
    }
    const ip = clientIp(request);
    const recent = recentFailures(ip);
    if (recent.length >= MAX_FAILURES) {
      const oldest = recent[0] ?? Date.now();
      const waitMinutes = Math.max(1, Math.ceil((FAILURE_WINDOW_MS - (Date.now() - oldest)) / 60000));
      audit({ event: "login_locked", ip });
      response.status(429).json({
        error: `ใส่รหัสผิดหลายครั้งเกินไป กรุณารอ ${waitMinutes} นาทีแล้วลองใหม่`,
        retryAfterMinutes: waitMinutes,
      });
      return;
    }
    const password = String(request.body?.password || "");
    const name = String(request.body?.name || "").trim().slice(0, 40) || "ไม่ระบุชื่อ";
    if (!password || !verifyPassword(password, passwordHash)) {
      recent.push(Date.now());
      failures.set(ip, recent);
      audit({ event: "login_failed", ip, name });
      const left = MAX_FAILURES - recent.length;
      // A short fixed delay slows down guessing without locking the team out.
      setTimeout(() => {
        response.status(401).json({
          error:
            left > 0
              ? `รหัสผ่านไม่ถูกต้อง (ลองได้อีก ${left} ครั้ง)`
              : "รหัสผ่านไม่ถูกต้อง ถูกล็อกชั่วคราว 15 นาที",
        });
      }, 800);
      return;
    }
    failures.delete(ip);
    const now = Date.now();
    setSessionCookie(request, response, {
      name,
      issuedAt: now,
      expiresAt: now + SESSION_DAYS * 24 * 60 * 60 * 1000,
    });
    audit({ event: "login", ip, user: name });
    response.json({ ok: true, name });
  });

  app.post("/api/auth/logout", (request, response) => {
    const session = decodeSession(readCookie(request, COOKIE_NAME));
    clearSessionCookie(request, response);
    if (session) audit({ event: "logout", ip: clientIp(request), user: session.name });
    response.json({ ok: true });
  });

  // Everything else requires a session when login is enabled.
  app.use((request, response, next) => {
    if (!authEnabled) return next();
    if (PUBLIC_PATHS.has(request.path)) return next();
    // Local health checks (installer, doctor.sh) come straight from 127.0.0.1
    // without Nginx headers; through Nginx, health is protected like the rest.
    if (request.path === "/api/health" && !request.headers["x-real-ip"]) return next();

    const session = decodeSession(readCookie(request, COOKIE_NAME));
    if (!session) {
      if (request.path.startsWith("/api/")) {
        response.status(401).json({ error: "กรุณาเข้าสู่ระบบ", code: "AUTH_REQUIRED" });
      } else {
        response.redirect(302, "/login");
      }
      return;
    }

    // Cross-site protection on top of SameSite=Strict: a state-changing request
    // must come from this site's own pages.
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.origin;
      const host = request.headers["x-forwarded-host"] || request.headers.host;
      if (origin && host && new URL(origin).host !== host) {
        response.status(403).json({ error: "คำขอนี้ไม่ได้มาจากหน้า HR Auto" });
        return;
      }
    }

    request.session = session;
    // Sliding expiry: phones stay signed in while the team keeps using the app.
    if (Date.now() - session.issuedAt > RENEW_AFTER_MS) {
      const now = Date.now();
      setSessionCookie(request, response, {
        name: session.name,
        issuedAt: now,
        expiresAt: now + SESSION_DAYS * 24 * 60 * 60 * 1000,
      });
    }
    next();
  });

  // Record every change the team makes (who, from where, what, result).
  app.use("/api", (request, response, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
    response.on("finish", () => {
      audit({
        event: "action",
        user: request.session?.name || (authEnabled ? null : "local"),
        ip: clientIp(request),
        method: request.method,
        path: request.originalUrl.split("?")[0],
        status: response.statusCode,
      });
    });
    next();
  });
}
