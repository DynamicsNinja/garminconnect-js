/**
 * One-time interactive login.
 *   GARMIN_EMAIL=… GARMIN_PASSWORD=… npx tsx scripts/login.ts ./tokens
 * Prompts for an MFA code on stdin when Garmin asks for one.
 */
import { createInterface } from "node:readline/promises";
import { GarminClient } from "../src/client.js";
import { FileTokenStore } from "../src/auth/token-store.js";

const dir = process.argv[2] ?? "./tokens";
const email = process.env["GARMIN_EMAIL"];
const password = process.env["GARMIN_PASSWORD"];

if (!email || !password) {
  console.error("Set GARMIN_EMAIL and GARMIN_PASSWORD");
  process.exit(1);
}

const client = new GarminClient({ tokenStore: new FileTokenStore(dir) });
const result = await client.login(email, password);

if (result.state === "mfa_required") {
  if (!process.stdin.isTTY) {
    console.error("MFA required but stdin is not interactive; cannot prompt for a code.");
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = (await rl.question(`MFA code (sent via ${result.mfaState.mfaMethod}): `)).trim();
  rl.close();
  if (!code) {
    console.error("No MFA code entered.");
    process.exit(1);
  }
  await client.resumeLogin(result.mfaState, code);
}

console.log(`Tokens written to ${dir}`);
