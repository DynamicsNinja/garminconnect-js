/**
 * One-time interactive login.
 *   GARMIN_EMAIL=… GARMIN_PASSWORD=… npx tsx scripts/login.ts ./tokens
 * Prompts for an MFA code on stdin when Garmin asks for one.
 *
 * A second argument picks a different pair of env vars, so two accounts can live in one .env
 * without commenting one out to use the other:
 *   npx tsx scripts/login.ts ./tokens-real GARMIN_REAL   # GARMIN_REAL_EMAIL / _PASSWORD
 */
import "./load-env.js";
import { createInterface } from "node:readline/promises";
import { GarminClient } from "../src/client.js";
import { FileTokenStore } from "../src/auth/token-store.js";

const dir = process.argv[2] ?? "./tokens";
const prefix = process.argv[3] ?? "GARMIN";
const email = process.env[`${prefix}_EMAIL`];
const password = process.env[`${prefix}_PASSWORD`];

if (!email || !password) {
  console.error(`Set ${prefix}_EMAIL and ${prefix}_PASSWORD`);
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
