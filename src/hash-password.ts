/**
 * Prints a password hash for HR_AUTO_PASSWORD_HASH.
 *
 *   printf '%s' "$PASSWORD" | node dist/hash-password.js
 *
 * Reads the password from stdin (never from the command line, which would
 * leave it in shell history and the process list).
 */
import { hashPassword } from "./auth.js";

const MIN_LENGTH = 10;

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");

if (password.length < MIN_LENGTH) {
  console.error(`Password must be at least ${MIN_LENGTH} characters.`);
  process.exit(1);
}
process.stdout.write(`${hashPassword(password)}\n`);
