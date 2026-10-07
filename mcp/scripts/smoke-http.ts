/**
 * The hosted server end to end against the TEST account: a real Garmin sign-in through the
 * sign-in form, PKCE token exchange, tools over streamable HTTP, a workout round trip, refresh,
 * revocation. Runs the server in-process on 127.0.0.1 with an in-memory grant store.
 *
 *   npm run smoke:http        (needs GARMIN_EMAIL, GARMIN_PASSWORD, GARMIN_TEST_PROFILE_ID in .env)
 */
import "../../scripts/load-env.js";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline/promises";
import { createHttpApp } from "../src/http/app.js";
import { garminAuth } from "../src/http/garmin-auth.js";
import { MemoryGrantStore } from "../src/http/grants.js";
import { Sealer } from "../src/http/seal.js";
import { loadConfig } from "../src/session.js";
import { mcpClient, signIn, tokenRequest } from "../tests/http/oauth-dance.js";

const { GARMIN_EMAIL: email, GARMIN_PASSWORD: password, GARMIN_TEST_PROFILE_ID: expected } = process.env;
if (!email || !password || !expected) {
  console.error("Refusing to run: GARMIN_EMAIL, GARMIN_PASSWORD and GARMIN_TEST_PROFILE_ID must be set. Nothing was written.");
  process.exit(1);
}

const app = createHttpApp({ publicUrl: new URL("http://127.0.0.1"), sealer: new Sealer([randomBytes(32)]), grants: new MemoryGrantStore(), auth: garminAuth(), mcp: loadConfig({}), version: "smoke", log: () => {} });
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
// The metadata advertises PUBLIC_URL; this run talks to the port directly, so only the endpoints matter.

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const text = (r: unknown) => (r as { content: { text?: string }[] }).content.map((c) => c.text ?? "").join("\n");

try {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const session = await signIn(base, { email, password, mfaCode: () => rl.question("Garmin MFA code: ") });
  rl.close();
  check("signed in through the form and exchanged the code", Boolean(session.accessToken));

  const client = await mcpClient(base, session.accessToken);
  const profile = JSON.parse(text(await client.callTool({ name: "get_user_profile", arguments: {} }))) as { profileId: unknown };
  // SAFETY GATE: identical to every other write script here. Nothing below runs on another account.
  if (String(profile.profileId) !== String(expected)) {
    console.error(`Refusing to continue: profile ${String(profile.profileId)} is not the test account. Nothing was written.`);
    process.exit(1);
  }
  check("tools run with the sealed Garmin session", true, `profile ${String(profile.profileId)}`);

  const spec = { name: `http smoke ${new Date().toISOString()}`, sport: "running", steps: [{ type: "warmup", lapButton: true }, { type: "cooldown", time: 300 }] };
  const created = text(await client.callTool({ name: "create_workout", arguments: { spec } }));
  const workoutId = /Created workout (\d+)/.exec(created)?.[1];
  check("create_workout over HTTP", workoutId !== undefined, created.split("\n")[0]);
  if (workoutId) {
    const stored = JSON.parse(text(await client.callTool({ name: "get_workout_by_id", arguments: { workoutId } }))) as { workoutName?: string };
    check("read the stored workout back", stored.workoutName === spec.name);
    await client.callTool({ name: "delete_workout", arguments: { workoutId } });
  }
  await client.close();

  const refreshed = await tokenRequest(base, { grant_type: "refresh_token", refresh_token: session.refreshToken, client_id: session.clientId });
  const next = (await refreshed.json()) as { access_token?: string; refresh_token?: string };
  check("refresh issued new tokens", refreshed.status === 200 && Boolean(next.access_token));
  const again = await mcpClient(base, next.access_token!);
  check("the refreshed access token works", !(await again.callTool({ name: "get_user_profile", arguments: {} })).isError);
  await again.close();

  await fetch(`${base}/mcp/oauth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: next.refresh_token!, client_id: session.clientId }) });
  const after = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${next.access_token!}`, "content-type": "application/json" }, body: "{}" });
  check("revocation disconnects the access token", after.status === 401, String(after.status));
} finally {
  server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
