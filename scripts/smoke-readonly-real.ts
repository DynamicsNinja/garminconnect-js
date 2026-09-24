/**
 * READ-ONLY probes against a real, personal Garmin account.
 *
 *   npm run login:real     # once — writes ./tokens-real, leaves ./tokens alone
 *   npm run smoke:real
 *
 * Why this exists: a dozen methods in AGENTS.md are marked `no` or `partially` live-verified for
 * one reason — the dedicated test account structurally CANNOT produce the data. It has no paired
 * device, no personal records, no golf rounds, no health snapshots, no phased training plan. No
 * amount of write-probing creates them; only an account that has actually been used has them.
 *
 * Three things keep this safe, and none of them is "the probe list only contains reads":
 *
 *  1. THE TRANSPORT REFUSES NON-GET. `createReadOnlyFetch` (scripts/readonly-fetch.ts, unit-tested
 *     in tests/readonly-fetch.test.ts) throws on any method except GET, with one narrow exception
 *     for the OAuth token-refresh POST. A write cannot leave this process even if a later edit
 *     adds one to the list by mistake. That is the guarantee; the probe list is only the intent.
 *  2. ITS OWN TOKEN DIRECTORY. `./tokens-real`, never `./tokens` — the test-account session stays
 *     intact, and neither account's harness can pick up the other's tokens.
 *  3. IT REFUSES TO RUN ON THE TEST ACCOUNT. The inverse of every other script here: those refuse
 *     unless the profile matches GARMIN_TEST_PROFILE_ID, this one refuses if it DOES. A mixed-up
 *     token directory stops the run instead of producing a confusing report.
 *
 * OUTPUT IS SHAPES, NEVER VALUES. It prints key names, types and array lengths — the things that
 * are actually unverified — and no field contents, so the report carries no personal health data
 * and is safe to paste into an issue. There is deliberately no `--raw` flag.
 */
import "./load-env.js";
import { GarminClient, Garmin, FileTokenStore, GarminHttpError } from "../src/index.js";
import { createReadOnlyFetch } from "./readonly-fetch.js";

const TOKEN_DIR = "./tokens-real";

const transport = createReadOnlyFetch();
const client = new GarminClient({
  tokenStore: new FileTokenStore(TOKEN_DIR),
  fetchImpl: transport,
  // `retries: 0` for two reasons. A read-only sweep of someone's real account has no business
  // hammering Garmin. And the transport treats the read-only refusal as a network error — it is
  // thrown from `fetch` — so with the default retries a mistakenly-added write is attempted four
  // times and surfaces as "failed after 4 attempts", which reads like flakiness rather than the
  // deliberate block it is. The refusal itself is still on `error.cause`.
  retries: 0,
});
if (!(await client.loadTokens())) {
  console.error(
    `No tokens in ${TOKEN_DIR}. Run \`npm run login:real\` first — it reads ` +
      "GARMIN_REAL_EMAIL / GARMIN_REAL_PASSWORD from .env (see the commented block there).",
  );
  process.exit(1);
}
const g = new Garmin(client);

// INVERSE SAFETY GATE — refuse the TEST account, the opposite of every other script here.
const profile = await g.getUserProfile();
const testId = process.env["GARMIN_TEST_PROFILE_ID"];
if (testId && String(profile.profileId) === String(testId)) {
  console.error(
    `Refusing to run: ${TOKEN_DIR} holds the TEST account (${String(profile.profileId)}).\n` +
      "This probe is for a real account; the test account has none of the data it looks for.",
  );
  process.exit(1);
}
const expectedReal = process.env["GARMIN_REAL_PROFILE_ID"];
if (expectedReal && String(profile.profileId) !== String(expectedReal)) {
  console.error("Refusing to run: live profile does not match GARMIN_REAL_PROFILE_ID.");
  process.exit(1);
}
console.log("Read-only probe against a real account. Transport is GET-only.\n");

/** Describes a value by SHAPE only — key names, types, lengths. Never field contents. */
function shape(v: unknown, depth = 0): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) {
    if (v.length === 0) return "array[0]";
    return depth >= 2 ? `array[${v.length}]` : `array[${v.length}] of ${shape(v[0], depth + 1)}`;
  }
  if (Buffer.isBuffer(v)) return `Buffer(${String(v.length)} bytes)`;
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    if (depth >= 2) return `{${String(entries.length)} keys}`;
    const shown = entries.slice(0, 40).map(([k, val]) => `${k}: ${shape(val, depth + 1)}`);
    const more = entries.length > 40 ? `, …${String(entries.length - 40)} more` : "";
    return `{${shown.join(", ")}${more}}`;
  }
  return typeof v; // the TYPE, never the value
}

let pass = 0;
let fail = 0;
let skip = 0;

async function probe(label: string, run: () => Promise<unknown>): Promise<unknown> {
  try {
    const result = await run();
    pass++;
    console.log(`  OK    ${label.padEnd(30)} ${shape(result).slice(0, 300)}`);
    return result;
  } catch (e) {
    fail++;
    const msg =
      e instanceof GarminHttpError
        ? `HTTP ${String(e.status)} ${e.body.slice(0, 100)}`
        : `${(e as Error).constructor.name}: ${(e as Error).message.slice(0, 140)}`;
    console.log(`  FAIL  ${label.padEnd(30)} ${msg}`);
    return undefined;
  }
}

function skipped(label: string, why: string): void {
  skip++;
  console.log(`  SKIP  ${label.padEnd(30)} ${why}`);
}

const today = new Date().toISOString().slice(0, 10);

// --- devices: the largest block the test account can never verify -----------------------------
console.log("devices");
const devices = (await probe("getDevices", () => g.getDevices())) as { deviceId?: number }[] | null;
await probe("getDeviceLastUsed", () => g.getDeviceLastUsed());
await probe("getPrimaryTrainingDevice", () => g.getPrimaryTrainingDevice());
const deviceId = devices?.find((d) => d.deviceId !== undefined)?.deviceId;
if (deviceId === undefined) {
  skipped("getDeviceSettings", "no paired device on this account");
  skipped("getDeviceSolarData", "no paired device on this account");
} else {
  await probe("getDeviceSettings", () => g.getDeviceSettings(deviceId));
  await probe("getDeviceSolarData", () => g.getDeviceSolarData(deviceId, today));
}
await probe("getDeviceAlarms", () => g.getDeviceAlarms());

// --- personal records and settings: row shapes the empty account could not show ---------------
console.log("\nrecords & profile");
await probe("getPersonalRecord", () => g.getPersonalRecord());
await probe("getUserSettings", () => g.getUserSettings());
await probe("getUserprofileSettings", () => g.getUserprofileSettings());

// --- health snapshot: never once observed succeeding, anywhere ---------------------------------
console.log("\nhealth snapshot");
let snapshotFound = false;
for (let i = 0; i < 7 && !snapshotFound; i++) {
  const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
  try {
    const buf = await g.downloadHealthSnapshot(d);
    pass++;
    snapshotFound = true;
    console.log(`  OK    ${`downloadHealthSnapshot (-${String(i)}d)`.padEnd(30)} ${shape(buf)}`);
  } catch {
    /* keep looking through the week */
  }
}
if (!snapshotFound) skipped("downloadHealthSnapshot", "none recorded in the last 7 days");

// --- golf: every row shape below the envelope is unverified ------------------------------------
console.log("\ngolf");
const golf = (await probe("getGolfSummary", () => g.getGolfSummary())) as {
  scorecardSummaries?: { id?: number }[];
} | null;
await probe("getGolfUserStats", () => g.getGolfUserStats());
await probe("getGolfClubStats", () => g.getGolfClubStats());
const scorecardId = golf?.scorecardSummaries?.find((s) => s.id !== undefined)?.id;
if (scorecardId === undefined) {
  skipped("getGolfScorecard", "no scorecard on this account");
  skipped("getGolfShotData", "no scorecard — would settle the unexplained 410");
} else {
  await probe("getGolfScorecard", () => g.getGolfScorecard(scorecardId));
  await probe("getGolfShotData", () => g.getGolfShotData(scorecardId));
}

// --- training plans: getTrainingPlanById needs a PHASED plan -----------------------------------
console.log("\ntraining plans");
const plans = (await probe("getTrainingPlans", () => g.getTrainingPlans())) as {
  trainingPlanList?: { trainingPlanId?: number; trainingPlanCategory?: string }[];
} | null;
const list = plans?.trainingPlanList ?? [];
const phasedId = list.find((p) => p.trainingPlanCategory === "PHASED")?.trainingPlanId;
const anyPlanId = list.find((p) => p.trainingPlanId !== undefined)?.trainingPlanId;
if (phasedId === undefined) {
  skipped("getTrainingPlanById", `no PHASED plan (${String(list.length)} enrolled)`);
} else {
  await probe("getTrainingPlanById (PHASED)", () => g.getTrainingPlanById(phasedId));
}
if (anyPlanId === undefined) {
  skipped("getAdaptiveTrainingPlanById", "no plan enrolled");
} else {
  await probe("getAdaptiveTrainingPlanById", () => g.getAdaptiveTrainingPlanById(anyPlanId));
}

// --- gear: success paths only ever seen as 404s on the test account -----------------------------
console.log("\ngear");
const gear = (await probe("getGear", () => g.getGear(profile.profileId))) as
  | { uuid?: string }[]
  | null;
await probe("getGearDefaults", () => g.getGearDefaults(profile.profileId));
const gearUuid = gear?.find((x) => x.uuid !== undefined)?.uuid;
if (gearUuid === undefined) {
  skipped("getGearStats", "no gear on this account");
  skipped("getGearActivities", "no gear on this account");
} else {
  await probe("getGearStats", () => g.getGearStats(gearUuid));
  await probe("getGearActivities", () => g.getGearActivities(gearUuid));
}
const lastActivity = await g.getLastActivity();
if (lastActivity?.activityId === undefined) {
  skipped("getActivityGear", "no activities on this account");
} else {
  await probe("getActivityGear", () => g.getActivityGear(lastActivity.activityId));
}

console.log(
  `\n${String(pass)} ok, ${String(fail)} failed, ${String(skip)} skipped. ` +
    "Shapes only — no field values were printed.",
);

// The read-only claim as EVIDENCE rather than assertion: every request this process actually
// sent, counted by method. Anything here other than GET and the OAuth refresh is a defect.
const { sent, refused } = transport.audit();
const summary = Object.entries(sent)
  .map(([m, n]) => `${m}=${String(n)}`)
  .join(", ");
console.log(`Requests sent: ${summary}. Refused as writes: ${String(refused)}.`);
