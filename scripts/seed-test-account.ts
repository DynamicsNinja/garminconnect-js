/**
 * Seeds a realistic multi-week dataset onto the dedicated Garmin TEST account, so that read
 * endpoints return real payloads instead of empty envelopes.
 *
 *   npx tsx scripts/seed-test-account.ts          # seed
 *   npx tsx scripts/seed-test-account.ts --report # show what is on the account, write nothing
 *
 * WHY THIS EXISTS
 * ---------------
 * Most of this library was verified against an EMPTY account, so dozens of methods are recorded in
 * AGENTS.md as "endpoint works, no data" rather than genuinely verified. An empty 200 cannot tell
 * you whether a response type is right — Task 13 found the inventory's `returns` column wrong in
 * BOTH directions (a `list` that was an envelope object, a `dict` that was an array), and only a
 * populated response exposes that. Seeding converts a large block of those rows into real
 * verification.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 *  - `logout` is excluded: it clears the TokenStore, and ./tokens holds the live session every
 *    probe depends on; wiping it costs an interactive MFA re-login.
 *  - `pushWorkoutToDevice` is excluded: the account has no paired device and none can be created.
 *
 * The five womensHealth writes WERE excluded by the same standing rule, and are now INCLUDED under
 * an explicit, account-scoped exemption granted by the repo owner on 2026-09-23 (a blank throwaway
 * account, where permanent residue does not matter). They have no delete endpoint anywhere in
 * upstream, so what they write here is permanent by design. The gate below is what keeps that
 * exemption scoped to this one account; src/services/womensHealth.ts records the same.
 *
 * EVERYTHING IT CREATES IS TAGGED with SEED_TAG below, so teardown can find its own fixtures and
 * never touches anything it did not create.
 */
import "./load-env.js";
import { GarminClient, Garmin, FileTokenStore } from "../src/index.js";

/** Every seeded record carries this, so teardown can identify its own work. */
export const SEED_TAG = "[seed]";

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
if (!(await client.loadTokens())) {
  console.error("No tokens. Run `npm run login` first.");
  process.exit(1);
}
const g = new Garmin(client);

// ---------------------------------------------------------------------------
// SAFETY GATE — identical in spirit and strictness to scripts/smoke-writes.ts.
//
// ./tokens has held a real person's Garmin session earlier in this project, and
// `npm run login` can swap it back at any moment. This script writes a LOT. It
// fetches the live profile and refuses to proceed unless it matches the
// dedicated test account named by GARMIN_TEST_PROFILE_ID. Not conditional, not
// skippable by a flag, and it must never become either.
// ---------------------------------------------------------------------------
const expectedProfileId = process.env["GARMIN_TEST_PROFILE_ID"];
if (!expectedProfileId) {
  console.error(
    "Refusing to run: GARMIN_TEST_PROFILE_ID is not set in the environment or .env.\n" +
      "This script writes to the live Garmin account behind ./tokens and will not run\n" +
      "without an explicit test-account allowlist. Nothing was written.",
  );
  process.exit(1);
}

/** `userName` is realistically a personal email; redact it so a mismatch report is safe to paste. */
function redactUserName(userName: string): string {
  return `${userName.slice(0, 2)}***@***`;
}

const profile = await g.getUserProfile();
const liveProfileId = String(profile.profileId);
if (liveProfileId !== String(expectedProfileId)) {
  console.error(
    "Refusing to run: the live account's profile does not match the expected test account.\n" +
      `  expected profileId: ${expectedProfileId}\n` +
      `  found    profileId: ${liveProfileId} (userName: ${redactUserName(profile.userName)})\n` +
      "This is very likely the wrong account. Nothing was written.",
  );
  process.exit(1);
}
console.log(`Safety gate passed: live account matches GARMIN_TEST_PROFILE_ID (${liveProfileId}).\n`);

const pad = (n: number) => String(n).padStart(2, "0");
const dayOffset = (days: number) => new Date(Date.now() - days * 86_400_000);
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/**
 * `createManualActivity` passes `startDatetime` through unmodified, so the CALLER owns the format.
 * The milliseconds are load-bearing: omitting them produced a live HTTP 500
 * `ValueInstantiationException` from Garmin during earlier verification.
 */
const localTimestampWithMs = (d: Date, hour: number) =>
  `${isoDate(d)}T${pad(hour)}:00:00.000`;

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

let created = 0;
let failed = 0;
async function step(label: string, run: () => Promise<string>): Promise<void> {
  try {
    const detail = await run();
    created++;
    console.log(`  OK    ${label.padEnd(46)} ${detail}`);
  } catch (e) {
    failed++;
    const err = e as Error;
    console.log(`  FAIL  ${label.padEnd(46)} ${err.constructor.name}: ${err.message.slice(0, 90)}`);
  }
}

// --report: read-only census, useful before and after seeding.
if (process.argv.includes("--report")) {
  const today = isoDate(new Date());
  const yearAgo = isoDate(dayOffset(365));
  const acts = await g.getActivities(0, 100);
  const weigh = await g.getWeighIns(yearAgo, today);
  const gear = await g.getGear(liveProfileId);
  const workouts = await g.getWorkouts(0, 100);
  const bp = await g.getBloodPressure(yearAgo, today);
  console.log("Account census");
  console.log("  activities      :", acts.length);
  console.log("  weigh-in days   :", (weigh.dailyWeightSummaries ?? []).length);
  console.log("  gear            :", gear?.length ?? 0);
  console.log("  workouts        :", workouts?.length ?? 0);
  console.log(
    "  blood pressure  :",
    ((bp as { measurementSummaries?: unknown[] } | null)?.measurementSummaries ?? []).length,
    "summaries",
  );
  process.exit(0);
}

console.log("Seeding activities (6 sports across 8 weeks)...");
/**
 * `typeKey` is the Garmin activity type key WITHOUT the `activity_type_` prefix. Spread over
 * distinct dates and sports so date-range, type-filtered and per-sport reads all have something to
 * return — several read methods were previously only ever exercised against an empty list.
 */
const activityPlan: { days: number; hour: number; typeKey: string; km: number; min: number; name: string }[] = [
  { days: 56, hour: 7, typeKey: "running", km: 5.0, min: 28, name: `${SEED_TAG} easy 5k` },
  { days: 49, hour: 18, typeKey: "cycling", km: 24.5, min: 62, name: `${SEED_TAG} evening ride` },
  { days: 42, hour: 6, typeKey: "running", km: 10.0, min: 55, name: `${SEED_TAG} 10k tempo` },
  { days: 35, hour: 12, typeKey: "lap_swimming", km: 1.5, min: 38, name: `${SEED_TAG} pool session` },
  { days: 28, hour: 9, typeKey: "walking", km: 4.2, min: 50, name: `${SEED_TAG} recovery walk` },
  { days: 21, hour: 8, typeKey: "hiking", km: 12.0, min: 190, name: `${SEED_TAG} ridge hike` },
  { days: 14, hour: 19, typeKey: "strength_training", km: 0.1, min: 45, name: `${SEED_TAG} gym session` },
  { days: 7, hour: 7, typeKey: "running", km: 21.1, min: 118, name: `${SEED_TAG} half marathon` },
  { days: 3, hour: 17, typeKey: "cycling", km: 40.0, min: 95, name: `${SEED_TAG} long ride` },
];
for (const a of activityPlan) {
  await step(`${a.typeKey} ${a.km}km (${a.days}d ago)`, async () => {
    await g.createManualActivity(
      localTimestampWithMs(dayOffset(a.days), a.hour),
      timeZone,
      a.typeKey,
      a.km,
      a.min,
      a.name,
    );
    return `${a.name}`;
  });
}

console.log("\nSeeding weigh-ins (a trend over 8 weeks)...");
// Sent RAW in the unit named by unitKey — Garmin converts server-side. Pre-converting to grams is
// the historical bug that stored 93 kg as 93,000 kg.
for (let i = 8; i >= 0; i--) {
  const kg = 78.4 - (8 - i) * 0.35;
  await step(`weigh-in ${kg.toFixed(1)}kg (${i * 7}d ago)`, async () => {
    const when = dayOffset(i * 7);
    await g.addWeighInWithTimestamps(
      Number(kg.toFixed(1)),
      "kg",
      `${isoDate(when)}T07:15:00.00`,
    );
    return `${kg.toFixed(1)}kg on ${isoDate(when)}`;
  });
}

console.log("\nSeeding blood-pressure readings...");
for (const [i, r] of [
  { sys: 118, dia: 76, pulse: 58 },
  { sys: 122, dia: 79, pulse: 61 },
  { sys: 115, dia: 74, pulse: 55 },
].entries()) {
  await step(`bp ${r.sys}/${r.dia}`, async () => {
    await g.setBloodPressure(r.sys, r.dia, r.pulse, dayOffset(i * 10 + 2), `${SEED_TAG} reading`);
    return `${r.sys}/${r.dia} pulse ${r.pulse}`;
  });
}

console.log("\nSeeding hydration (PERMANENT — no delete endpoint exists)...");
for (const d of [1, 2, 3]) {
  await step(`hydration day -${d}`, async () => {
    await g.addHydrationData(500 + d * 100, dayOffset(d));
    return `${500 + d * 100} ml on ${isoDate(dayOffset(d))}`;
  });
}

console.log("\nSeeding workout templates (one per sport)...");
const workoutSpecs: { fn: (w: never) => Promise<unknown>; label: string }[] = [];
void workoutSpecs;
const mkWorkout = (name: string, secs: number) => ({
  workoutName: `${SEED_TAG} ${name}`,
  estimatedDurationInSecs: secs,
  workoutSegments: [
    {
      segmentOrder: 1,
      sportType: { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 },
      workoutSteps: [
        {
          type: "ExecutableStepDTO",
          stepOrder: 1,
          stepType: { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 },
          endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2 },
          endConditionValue: secs,
        },
      ],
    },
  ],
});
await step("running workout", async () => {
  const w = await g.uploadRunningWorkout(mkWorkout("base run", 1800));
  return `workoutId ${(w as { workoutId?: number } | null)?.workoutId}`;
});
await step("cycling workout", async () => {
  const w = await g.uploadCyclingWorkout(mkWorkout("spin", 2400));
  return `workoutId ${(w as { workoutId?: number } | null)?.workoutId}`;
});
await step("swimming workout", async () => {
  const w = await g.uploadSwimmingWorkout(mkWorkout("swim set", 1500));
  return `workoutId ${(w as { workoutId?: number } | null)?.workoutId}`;
});

console.log("\nScheduling a workout onto the calendar...");
await step("scheduleWorkout", async () => {
  const list = await g.getWorkouts(0, 5);
  const first = list?.[0] as { workoutId?: number } | undefined;
  if (first?.workoutId === undefined) return "no workout to schedule";
  const when = new Date(Date.now() + 2 * 86_400_000);
  await g.scheduleWorkout(first.workoutId, isoDate(when));
  return `workout ${first.workoutId} -> ${isoDate(when)}`;
});

console.log("\nSeeding women's health (EXPLICITLY AUTHORIZED for this account only)...");
/**
 * Ordered deliberately: setup precedes confirmation, which precedes per-day logs, because Garmin
 * derives cycle context from the configured start. None of these five has a delete endpoint
 * anywhere in upstream — that is precisely why they were excluded by default — so everything
 * written here is permanent on this account by design.
 */
const cycleStart = dayOffset(20);
await step("initMenstrualCycleSetup", async () => {
  await g.initMenstrualCycleSetup(isoDate(cycleStart), 5, 28);
  return `start ${isoDate(cycleStart)}, period 5d, cycle 28d`;
});
await step("confirmMenstrualPeriodStart", async () => {
  await g.confirmMenstrualPeriodStart(isoDate(cycleStart), 5, 28);
  return `confirmed ${isoDate(cycleStart)}`;
});
await step("updateMenstrualCalendar", async () => {
  // Each group must be non-empty, consecutive dates, inside [start, end] — otherwise the method
  // throws GarminError before issuing any request.
  const base = dayOffset(20).getTime();
  const dates = [0, 1, 2, 3, 4].map((i) => isoDate(new Date(base + i * 86_400_000)));
  await g.updateMenstrualCalendar(dates[0]!, dates[4]!, [dates]);
  return `${dates[0]} .. ${dates[4]} (${dates.length} days)`;
});
await step("updateMenstrualDailyLog", async () => {
  // FULL-DAY REPLACE, not a merge. `notes: ""` clears an existing note, `notes: undefined`
  // preserves it — distinct and load-bearing.
  await g.updateMenstrualDailyLog(isoDate(dayOffset(19)), {
    flow: "MEDIUM",
    symptoms: ["CRAMPS", "BLOATING"],
    moods: ["CALM"],
    notes: `${SEED_TAG} day-2 log`,
  });
  return `flow MEDIUM + 2 symptoms on ${isoDate(dayOffset(19))}`;
});
await step("updateMenstrualSettings", async () => {
  // Multi-step: GETs user-settings, overlays onto userMenstrualCycleSettings, PUTs it back.
  await g.updateMenstrualSettings({ trackingEnabled: true });
  return "trackingEnabled: true";
});

console.log("\nReading women's health back (the entire point of writing it)...");
const whReads: [string, () => Promise<unknown>][] = [
  ["getMenstrualDataForDate", () => g.getMenstrualDataForDate(isoDate(dayOffset(19)))],
  [
    "getMenstrualCalendarData",
    () => g.getMenstrualCalendarData(isoDate(dayOffset(25)), isoDate(new Date())),
  ],
  ["getMenstrualLastConfirmed", () => g.getMenstrualLastConfirmed(isoDate(new Date()))],
  ["getMenstrualCycleSummary", () => g.getMenstrualCycleSummary(isoDate(new Date()))],
  ["getMenstrualReports", () => g.getMenstrualReports(isoDate(new Date()), 1)],
  ["getPregnancySummary", () => g.getPregnancySummary()],
];
for (const [label, run] of whReads) {
  await step(`read ${label}`, async () => {
    const r = await run();
    if (r === null) return "null (no data)";
    if (Array.isArray(r)) return `array[${r.length}]`;
    return `object(${Object.keys(r as object).length} keys)`;
  });
}

console.log(`\nSeed complete: ${created} succeeded, ${failed} failed.`);
console.log("Run `npx tsx scripts/seed-test-account.ts --report` for a census.");
if (failed > 0) process.exitCode = 1;
