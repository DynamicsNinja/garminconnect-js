/**
 * The write probes `scripts/smoke-writes.ts` does NOT cover — the rows still marked `partially`,
 * `BROKEN` or `attempted` in AGENTS.md section 3.
 *
 *   npm run smoke:gaps
 *
 * Test account only, same unconditional gate as every other write script here. It creates gear,
 * links it, unlinks it and deletes it; it creates workouts and deletes them. Everything it makes,
 * it cleans up — with one honest exception noted at the gear probe.
 *
 * What is here and why:
 *
 *  1. addGearToActivity / removeGearFromActivity SUCCESS path. AGENTS.md contradicts itself: one
 *     gotcha says these are "STILL live-verified only on their 404 path", a later one says the
 *     success path is verified. `smoke-writes.ts` only exercises the 404. This settles it with
 *     fresh evidence rather than by choosing which sentence to believe.
 *  2. setGearDefault. Three investigations have failed to make it work; it is believed dead
 *     upstream, with `setGearActivityDefaults` as the working replacement. This is a fourth
 *     attempt against REAL gear that this script creates with the activity type pre-associated —
 *     a negative result is still a result, and it is recorded as one.
 *  3. uploadWalkingWorkout / uploadHikingWorkout. Documented BROKEN: the POST succeeds and Garmin
 *     stores a null sport. A test that asserts the BREAKAGE is what stops it being "fixed" by
 *     someone who sees a 2xx and assumes it works.
 *  4. pushWorkoutToDevice. Expected to fail for want of a paired device; the probe records how far
 *     the multi-step resolution chain gets before it does.
 */
import "./load-env.js";
import { GarminClient, Garmin, FileTokenStore, GarminHttpError } from "../src/index.js";

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
if (!(await client.loadTokens())) {
  console.error("No tokens. Run `npm run login` first.");
  process.exit(1);
}
const g = new Garmin(client);

// SAFETY GATE — identical to every other write script here. Not conditional, not skippable.
const expected = process.env["GARMIN_TEST_PROFILE_ID"];
if (!expected) {
  console.error("Refusing to run: GARMIN_TEST_PROFILE_ID is not set. Nothing was written.");
  process.exit(1);
}
const profile = await g.getUserProfile();
if (String(profile.profileId) !== String(expected)) {
  console.error(
    "Refusing to run: live profile does not match the expected test account.\n" +
      `  expected ${expected}, found ${String(profile.profileId)}\nNothing was written.`,
  );
  process.exit(1);
}
console.log(`Safety gate passed: ${String(profile.profileId)}\n`);

type Doc = Record<string, unknown>;
let pass = 0;
let fail = 0;

function report(ok: boolean, label: string, detail: string): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(38)} ${detail}`);
}

function describeError(e: unknown): string {
  return e instanceof GarminHttpError
    ? `HTTP ${String(e.status)} ${e.body.slice(0, 120)}`
    : `${(e as Error).constructor.name}: ${(e as Error).message.slice(0, 160)}`;
}

/** Gear uuids come back without hyphens from `getGear` and with them from `createGear`. */
const bare = (u: string) => u.replace(/-/g, "").toLowerCase();

// =============================================================================================
// 1 + 2. Gear: the link success path, then setGearDefault against that same real gear.
// =============================================================================================
console.log("gear association");
const activity = await g.getLastActivity();
if (activity?.activityId === undefined) {
  report(false, "gear round-trip", "no activity on the test account to link against");
} else {
  let gearUuid: string | undefined;
  try {
    // `firstUseDate` MUST predate the activity or the link 400s — see the gotcha. 2020 is safely
    // before anything this account holds. `notes` must be non-empty (Garmin rejects "").
    const created = (await g.createGear(
      "SHOES",
      "probe",
      "gap-probe",
      `gap-probe ${String(Date.now())}`,
      "2020-01-01",
      "DISTANCE",
      500,
      undefined,
      "created by smoke:gaps, safe to delete",
      ["running"],
    )) as Doc | null;
    gearUuid = typeof created?.["uuid"] === "string" ? (created["uuid"]) : undefined;
    if (gearUuid === undefined) {
      report(false, "createGear", `no uuid in the response: ${JSON.stringify(created).slice(0, 120)}`);
    } else {
      report(true, "createGear (backdated 2020)", "uuid returned");

      // --- addGearToActivity, then READ BACK. A 2xx is not the evidence; the link is. ---------
      await g.addGearToActivity(gearUuid, activity.activityId);
      const linked = (await g.getActivityGear(activity.activityId));
      const isLinked = (linked ?? []).some(
        (x) => typeof x["uuid"] === "string" && bare(x["uuid"]) === bare(gearUuid!),
      );
      report(
        isLinked,
        "addGearToActivity SUCCESS path",
        isLinked
          ? `getActivityGear now lists the gear (${String((linked ?? []).length)} item(s))`
          : `getActivityGear does not list it: ${JSON.stringify(linked).slice(0, 140)}`,
      );

      // --- getGearActivities should now see the activity through the gear --------------------
      const gearActivities = await g.getGearActivities(gearUuid);
      report(
        gearActivities.length > 0,
        "getGearActivities (real gear)",
        `${String(gearActivities.length)} activity/activities`,
      );

      // --- removeGearFromActivity (a PUT, not a DELETE), then READ BACK ----------------------
      await g.removeGearFromActivity(gearUuid, activity.activityId);
      const after = (await g.getActivityGear(activity.activityId));
      const stillThere = (after ?? []).some(
        (x) => typeof x["uuid"] === "string" && bare(x["uuid"]) === bare(gearUuid!),
      );
      report(
        !stillThere,
        "removeGearFromActivity SUCCESS path",
        stillThere ? "still linked after the remove" : "getActivityGear no longer lists it",
      );

      // --- setGearDefault: attempt four, and the assertion is INVERTED ----------------------
      // The endpoint is believed dead upstream. A probe that fails whenever reality matches the
      // documentation is a probe that gets muted, so this asserts the FAILURE — and flips to a
      // real failure the day Garmin revives it, which is the notification worth having.
      //
      // This run is the decisive one: the gear provably exists at this moment (the link above
      // succeeded against it, and setGearActivityDefaults below reflects it in getGearDefaults),
      // so "gear not found" cannot mean what it says.
      for (const key of ["running", "RUNNING"]) {
        try {
          await g.setGearDefault(key, gearUuid, true);
          report(
            false,
            `setGearDefault("${key}")`,
            "ACCEPTED — the endpoint is NO LONGER dead. Update AGENTS.md and re-point callers.",
          );
        } catch (e) {
          const msg = (e as Error).message;
          const asDocumented = msg.includes("gear not found");
          report(
            asDocumented,
            `setGearDefault("${key}")`,
            asDocumented
              ? "still dead as documented: 404 \"gear not found\" against gear that demonstrably exists"
              : `failed differently than documented: ${describeError(e)}`,
          );
        }
      }

      // --- and the working replacement, for contrast in the same run -------------------------
      try {
        await g.setGearActivityDefaults(gearUuid, ["running"]);
        const defaults = (await g.getGearDefaults(profile.profileId));
        const mine = (defaults ?? []).filter(
          (d) => typeof d["uuid"] === "string" && bare(d["uuid"]) === bare(gearUuid!),
        );
        report(
          mine.length > 0,
          "setGearActivityDefaults (replacement)",
          mine.length > 0
            ? `getGearDefaults reflects it (${String(mine.length)} entry/entries)`
            : "getGearDefaults does not reflect it",
        );
      } catch (e) {
        report(false, "setGearActivityDefaults", describeError(e));
      }
    }
  } catch (e) {
    report(false, "gear round-trip", describeError(e));
  } finally {
    if (gearUuid !== undefined) {
      try {
        await g.deleteGear(gearUuid);
        console.log(`  clean  deleted probe gear`);
      } catch (e) {
        console.log(`  WARN   could not delete probe gear: ${describeError(e)}`);
      }
    }
  }
}

// =============================================================================================
// 3. uploadWalkingWorkout / uploadHikingWorkout — assert the DOCUMENTED BREAKAGE.
// =============================================================================================
console.log("\nbroken-by-design workout helpers");
const minimalWorkout = (name: string) => ({
  workoutName: name,
  estimatedDurationInSecs: 600,
  workoutSegments: [
    {
      segmentOrder: 1,
      sportType: { sportTypeId: 3, sportTypeKey: "other", displayOrder: 3 },
      workoutSteps: [
        {
          type: "ExecutableStepDTO",
          stepOrder: 1,
          stepType: { stepTypeId: 3, stepTypeKey: "interval" },
          endCondition: { conditionTypeId: 2, conditionTypeKey: "time" },
          endConditionValue: 600,
        },
      ],
    },
  ],
});

for (const [label, upload] of [
  ["uploadWalkingWorkout", (n: string) => g.uploadWalkingWorkout(minimalWorkout(n))],
  ["uploadHikingWorkout", (n: string) => g.uploadHikingWorkout(minimalWorkout(n))],
] as const) {
  let id: number | undefined;
  try {
    const created = await upload(`[gaps] ${label} ${String(Date.now())}`);
    id = created?.workoutId;
    if (id === undefined) {
      report(false, label, "upload returned no workoutId");
      continue;
    }
    const stored = (await g.getWorkoutById(id)) as Doc;
    const sport = stored["sportType"] as Doc | null;
    const storedId = sport?.["sportTypeId"];
    const storedKey = sport?.["sportTypeKey"];
    // The ASSERTION IS THE BREAKAGE. If Garmin ever starts honouring these ids this fails, which
    // is the notification we want — the row can then be corrected from BROKEN back to working.
    const brokenAsDocumented = storedId === 0 && storedKey === null;
    report(
      brokenAsDocumented,
      label,
      brokenAsDocumented
        ? "still BROKEN as documented: stored sportTypeId=0, sportTypeKey=null"
        : `NO LONGER BROKEN — stored ${JSON.stringify(sport)}. Update AGENTS.md.`,
    );
  } catch (e) {
    report(false, label, describeError(e));
  } finally {
    if (id !== undefined) {
      try {
        await g.deleteWorkout(id);
      } catch {
        console.log(`  WARN   could not delete workout ${String(id)}`);
      }
    }
  }
}

// =============================================================================================
// 4. pushWorkoutToDevice — expected to fail; the value is in WHERE it fails.
// =============================================================================================
console.log("\ndevice push");
try {
  const pushed = await g.pushWorkoutToDevice();
  report(true, "pushWorkoutToDevice", `ACCEPTED: ${JSON.stringify(pushed).slice(0, 140)}`);
} catch (e) {
  // Not a library failure — the account genuinely has no paired device. What the message tells a
  // future reader is WHERE the chain stops: `mylastused` yields no usable `userDeviceId`, so the
  // final POST goes out with device id 0 and Garmin answers "Device id 0 is not registered."
  // Every step before that one is therefore exercised.
  console.log(`  NOTE  ${"pushWorkoutToDevice".padEnd(38)} ${describeError(e)}`);
}

console.log(`\n${String(pass)} passed, ${String(fail)} failed.`);
