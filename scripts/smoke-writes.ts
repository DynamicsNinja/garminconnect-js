import "./load-env.js";
import {
  GarminClient,
  Garmin,
  FileTokenStore,
  GarminHttpError,
  GarminConnectionError,
} from "../src/index.js";

type WriteProbe = {
  name: string;
  /** create → read back → assert stored value → delete → assert gone. Returns a pass/fail line. */
  run: () => Promise<{ ok: boolean; detail: string }>;
};

/** Poll `check` until it returns true or attempts are exhausted, sleeping `delayMs` between tries. */
async function pollUntil(
  check: () => Promise<boolean>,
  attempts = 5,
  delayMs = 1000,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return true;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
if (!(await client.loadTokens())) {
  console.error("No tokens. Run `npm run login` first.");
  process.exit(1);
}
const g = new Garmin(client);

// ---------------------------------------------------------------------------
// SAFETY GATE — this is the entire point of this script.
//
// The `tokens/` directory in this repo has, earlier in this project, held a
// real person's Garmin session. A `npm run login` can swap it back to a real
// account at any moment. Before issuing a single write, we fetch the live
// profile and refuse to proceed unless it matches the dedicated empty test
// account named by GARMIN_TEST_PROFILE_ID. This check is not conditional,
// not skippable by a flag, and must never become one.
// ---------------------------------------------------------------------------
const expectedProfileId = process.env["GARMIN_TEST_PROFILE_ID"];
if (!expectedProfileId) {
  console.error(
    "Refusing to run: GARMIN_TEST_PROFILE_ID is not set in the environment or .env.\n" +
      "This script writes to the live Garmin account behind ./tokens and will not run\n" +
      "without an explicit test-account allowlist. No writes were issued.",
  );
  process.exit(1);
}

/**
 * `userName` is realistically a personal email address. The gate fires
 * exactly when the account is unexpectedly wrong — i.e. most likely someone's
 * real account — and this output gets quoted verbatim into task reports and
 * can reach an issue tracker. `profileId` alone already proves the mismatch
 * and drives the operator's next action; this redaction exists only so a
 * human can recognise their own account without it being published in full.
 */
function redactUserName(userName: string): string {
  return `${userName.slice(0, 2)}***@***`;
}

const liveProfile = await g.getUserProfile();
const liveProfileId = String(liveProfile.profileId);
if (liveProfileId !== expectedProfileId) {
  console.error(
    "Refusing to run: the live account's profile does not match the expected test account.\n" +
      `  expected profileId: ${expectedProfileId}\n` +
      `  found    profileId: ${liveProfileId} (userName: ${redactUserName(liveProfile.userName)})\n` +
      "This is very likely the wrong account. No writes were issued.",
  );
  process.exit(1);
}
console.log(`Safety gate passed: live account matches GARMIN_TEST_PROFILE_ID (${liveProfileId}).\n`);

/**
 * Local wall-clock timestamp WITH milliseconds, in the exact pattern
 * `createManualActivity`'s upstream docstring specifies
 * (`"2023-12-02T10:00:00.000"`). `createManualActivity` passes its
 * `startDatetime` argument through unmodified (not through `formatDate`,
 * which only accepts bare `YYYY-MM-DD`), so the CALLER owns getting this
 * format right — omitting the `.000` was tried live against the test
 * account and produced a 500 `ValueInstantiationException` from Garmin;
 * this helper exists so every activities probe uses the format that is
 * confirmed to work.
 */
function localTimestampWithMs(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000`
  );
}

/** A minimal, valid GPX track with synthetic (Null-Island-adjacent) coordinates — no real GPS data. */
function fixtureGpx(label: string): string {
  const t0 = new Date(Date.now() - 20 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z");
  const pt = (i: number) =>
    `<trkpt lat="0.000${i}00" lon="0.000${i}00"><ele>${i}</ele>` +
    `<time>${iso(new Date(t0.getTime() + i * 5 * 60 * 1000))}</time></trkpt>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="garminconnect-js-test" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <trk>\n    <name>${label}</name>\n    <trkseg>\n      ${[0, 1, 2, 3].map(pt).join("\n      ")}\n    </trkseg>\n  </trk>\n</gpx>`
  );
}

/** Best-effort cleanup: swallows and logs rather than masking the probe's real result. */
async function cleanupActivity(activityId: number, probeName: string): Promise<void> {
  try {
    await g.deleteActivity(activityId);
  } catch (cleanupError) {
    console.error(
      `  WARNING: cleanup failed for "${probeName}" (activity ${activityId}): ${(cleanupError as Error).message}`,
    );
  }
}

/** Polls `getActivities` until the account has zero activities (Garmin's list is eventually consistent after a delete). */
async function pollUntilNoActivities(): Promise<boolean> {
  return pollUntil(async () => (await g.getActivities(0, 10)).length === 0, 10, 3000);
}

function activityProbes(): WriteProbe[] {
  return [
    {
      name: "createManualActivity/deleteActivity round-trip (unit conversion: km->m, min->s)",
      run: async () => {
        const distanceKm = 5.5;
        const durationMin = 30;
        const expectedDistanceM = 5500;
        const expectedDurationS = 1800;
        const activityName = `garminconnect-js-task3-manual-${Date.now()}`;
        let activityId: number | undefined;

        try {
          const created = (await g.createManualActivity(
            localTimestampWithMs(new Date()),
            "UTC",
            "running",
            distanceKm,
            durationMin,
            activityName,
          )) as { activityId?: number } | null;

          if (typeof created?.activityId !== "number") {
            return {
              ok: false,
              detail: `createManualActivity did not return a numeric activityId (got ${JSON.stringify(created)})`,
            };
          }
          activityId = created.activityId;

          const activity = (await g.getActivity(activityId)) as {
            activityName?: string;
            summaryDTO?: { distance?: number; duration?: number };
          };

          if (activity.activityName !== activityName) {
            return {
              ok: false,
              detail: `expected activityName "${activityName}", read back "${activity.activityName}"`,
            };
          }
          const distance = activity.summaryDTO?.distance;
          const duration = activity.summaryDTO?.duration;
          if (distance !== expectedDistanceM) {
            return {
              ok: false,
              detail:
                `unit conversion bug: sent distanceKm=${distanceKm} expecting ${expectedDistanceM}m, ` +
                `Garmin stored summaryDTO.distance=${distance}`,
            };
          }
          if (duration !== expectedDurationS) {
            return {
              ok: false,
              detail:
                `unit conversion bug: sent durationMin=${durationMin} expecting ${expectedDurationS}s, ` +
                `Garmin stored summaryDTO.duration=${duration}`,
            };
          }

          await g.deleteActivity(activityId);
          const createdId = activityId;
          const gone = await pollUntil(async () => {
            const list = await g.getActivities(0, 10);
            return !list.some((a) => a.activityId === createdId);
          }, 10, 3000);
          activityId = undefined; // delete issued; finally has nothing left to do either way

          if (!gone) {
            return {
              ok: false,
              detail: `deleteActivity issued but activity ${createdId} still listed after polling`,
            };
          }
          return {
            ok: true,
            detail: `created ${createdId}, read back distance=${distance}m/duration=${duration}s (matches ${distanceKm}km/${durationMin}min converted), deleted, confirmed gone`,
          };
        } finally {
          if (activityId !== undefined) {
            await cleanupActivity(activityId, "createManualActivity/deleteActivity round-trip");
          }
        }
      },
    },
    {
      name: "setActivityName/setActivityType/setActivityDescription round-trip (read-back asserted)",
      run: async () => {
        let activityId: number | undefined;
        try {
          const created = (await g.createManualActivity(
            localTimestampWithMs(new Date()),
            "UTC",
            "running",
            1,
            10,
            `garminconnect-js-task3-rename-fixture-${Date.now()}`,
          )) as { activityId?: number } | null;
          if (typeof created?.activityId !== "number") {
            return {
              ok: false,
              detail: `createManualActivity did not return a numeric activityId (got ${JSON.stringify(created)})`,
            };
          }
          activityId = created.activityId;

          const newName = `garminconnect-js-task3-renamed-${Date.now()}`;
          await g.setActivityName(activityId, newName);
          const afterName = (await g.getActivity(activityId)) as { activityName?: string };
          if (afterName.activityName !== newName) {
            return {
              ok: false,
              detail: `setActivityName: expected "${newName}", read back "${afterName.activityName}"`,
            };
          }

          await g.setActivityType(activityId, 2, "cycling", 17);
          const afterType = (await g.getActivity(activityId)) as {
            activityTypeDTO?: { typeId?: number; typeKey?: string };
          };
          if (
            afterType.activityTypeDTO?.typeKey !== "cycling" ||
            afterType.activityTypeDTO?.typeId !== 2
          ) {
            return {
              ok: false,
              detail: `setActivityType: expected {typeId:2, typeKey:"cycling"}, read back ${JSON.stringify(afterType.activityTypeDTO)}`,
            };
          }

          const newDescription = `garminconnect-js task3 fixture description ${Date.now()}`;
          await g.setActivityDescription(activityId, newDescription);
          const afterDesc = (await g.getActivity(activityId)) as { description?: string };
          if (afterDesc.description !== newDescription) {
            return {
              ok: false,
              detail: `setActivityDescription: expected "${newDescription}", read back "${afterDesc.description}"`,
            };
          }

          await g.deleteActivity(activityId);
          const createdId = activityId;
          const gone = await pollUntil(async () => {
            const list = await g.getActivities(0, 10);
            return !list.some((a) => a.activityId === createdId);
          }, 10, 3000);
          activityId = undefined;

          if (!gone) {
            return {
              ok: false,
              detail: `all three setters verified by read-back, but activity ${createdId} still listed after deleteActivity + polling`,
            };
          }
          return {
            ok: true,
            detail: `name -> "${newName}", type -> cycling(2), description set — all confirmed by getActivity read-back; deleted and confirmed gone`,
          };
        } finally {
          if (activityId !== undefined) {
            await cleanupActivity(
              activityId,
              "setActivityName/setActivityType/setActivityDescription round-trip",
            );
          }
        }
      },
    },
    {
      name: "importActivity/deleteActivity round-trip (synthetic GPX upload)",
      run: async () => {
        const before = await g.getActivities(0, 10);
        if (before.length !== 0) {
          return {
            ok: false,
            detail: `refusing to run: account already has ${before.length} activities before this probe started`,
          };
        }

        const filename = `garminconnect-js-task3-import-${Date.now()}.gpx`;
        const gpx = fixtureGpx("garminconnect-js task3 import fixture");
        const blob = new Blob([gpx], { type: "application/gpx+xml" });

        await g.importActivity(blob, filename);

        let activityId: number | undefined;
        try {
          // Garmin processes an import asynchronously — poll for it to appear
          // rather than assuming it's there immediately.
          let appeared = false;
          for (let i = 0; i < 10; i++) {
            const list = await g.getActivities(0, 10);
            if (list.length > 0) {
              activityId = list[0]!.activityId;
              appeared = true;
              break;
            }
            if (i < 9) await new Promise((r) => setTimeout(r, 3000));
          }

          if (!appeared || typeof activityId !== "number") {
            return {
              ok: false,
              detail: "importActivity was accepted (2xx) but no activity appeared after polling for ~30s",
            };
          }

          await g.deleteActivity(activityId);
          const createdId = activityId;
          const gone = await pollUntilNoActivities();
          activityId = undefined;

          if (!gone) {
            return {
              ok: false,
              detail: `imported activity ${createdId} appeared, but deleteActivity did not remove it after polling`,
            };
          }
          return {
            ok: true,
            detail: `uploaded ${filename}, activity ${createdId} appeared after async processing, deleted, confirmed gone`,
          };
        } finally {
          if (activityId !== undefined) {
            await cleanupActivity(activityId, "importActivity/deleteActivity round-trip");
          }
        }
      },
    },
    {
      name: "deleteActivity verified in its own right (create -> delete -> poll-confirm gone)",
      run: async () => {
        let activityId: number | undefined;
        try {
          const created = (await g.createManualActivity(
            localTimestampWithMs(new Date()),
            "UTC",
            "running",
            1,
            5,
            `garminconnect-js-task3-delete-fixture-${Date.now()}`,
          )) as { activityId?: number } | null;
          if (typeof created?.activityId !== "number") {
            return {
              ok: false,
              detail: `createManualActivity did not return a numeric activityId (got ${JSON.stringify(created)}); deleteActivity itself was not exercised`,
            };
          }
          activityId = created.activityId;

          const deleteResult = await g.deleteActivity(activityId);
          const createdId = activityId;
          const gone = await pollUntil(async () => {
            const list = await g.getActivities(0, 10);
            return !list.some((a) => a.activityId === createdId);
          }, 10, 3000);
          activityId = undefined;

          if (!gone) {
            return {
              ok: false,
              detail: `deleteActivity(${createdId}) returned ${JSON.stringify(deleteResult)}, but the activity is still listed after polling`,
            };
          }
          return {
            ok: true,
            detail: `created ${createdId}, deleteActivity returned ${JSON.stringify(deleteResult)}, confirmed gone from getActivities after polling`,
          };
        } finally {
          if (activityId !== undefined) {
            await cleanupActivity(activityId, "deleteActivity verified in its own right");
          }
        }
      },
    },
    {
      name: "final account state after all activities write probes",
      run: async () => {
        // Each probe above already polled its own delete to confirmation, but
        // Garmin's activity list is eventually consistent — a read immediately
        // after the previous probe's own "gone" poll can still observe a
        // stale, not-yet-converged result. Poll here too rather than trusting
        // a single immediate read.
        const clean = await pollUntilNoActivities();
        const list = await g.getActivities(0, 10);
        return {
          ok: clean,
          detail: `${list.length} activities remain on the account (expected 0)`,
        };
      },
    },
  ];
}

function activitiesDetailProbes(): WriteProbe[] {
  return [
    {
      name: "activity detail sub-resource reads against a synthetic fixture (splits/typedSplits/split_summaries/weather/hrTimeInZones/powerTimeInZones/details/exerciseSets/gear)",
      run: async () => {
        let activityId: number | undefined;
        try {
          const created = (await g.createManualActivity(
            localTimestampWithMs(new Date()),
            "UTC",
            "running",
            1,
            5,
            `garminconnect-js-task4-detail-fixture-${Date.now()}`,
          )) as { activityId?: number } | null;
          if (typeof created?.activityId !== "number") {
            return {
              ok: false,
              detail: `createManualActivity did not return a numeric activityId (got ${JSON.stringify(created)})`,
            };
          }
          activityId = created.activityId;

          const calls: [string, () => Promise<unknown>][] = [
            ["getActivitySplits", () => g.getActivitySplits(activityId!)],
            ["getActivityTypedSplits", () => g.getActivityTypedSplits(activityId!)],
            ["getActivitySplitSummaries", () => g.getActivitySplitSummaries(activityId!)],
            ["getActivityWeather", () => g.getActivityWeather(activityId!)],
            ["getActivityHrInTimezones", () => g.getActivityHrInTimezones(activityId!)],
            ["getActivityPowerInTimezones", () => g.getActivityPowerInTimezones(activityId!)],
            ["getActivityDetails", () => g.getActivityDetails(activityId!)],
            ["getActivityExerciseSets", () => g.getActivityExerciseSets(activityId!)],
            ["getActivityGear", () => g.getActivityGear(activityId!)],
          ];

          const outcomes: string[] = [];
          let sawWrongUrl = false;
          for (const [name, call] of calls) {
            try {
              const result = await call();
              const shape =
                result === null
                  ? "null"
                  : Array.isArray(result)
                    ? `array[${result.length}]`
                    : typeof result === "object"
                      ? `object(${Object.keys(result).length} keys)`
                      : typeof result;
              outcomes.push(`${name}=${shape}`);
            } catch (callError) {
              if (callError instanceof GarminHttpError && callError.status === 404) {
                sawWrongUrl = true;
                outcomes.push(`${name}=404(WRONG URL)`);
              } else {
                const err = callError as Error;
                outcomes.push(`${name}=${err.constructor.name}(${err.message.slice(0, 60)})`);
              }
            }
          }

          await g.deleteActivity(activityId);
          const createdId = activityId;
          const gone = await pollUntil(async () => {
            const list = await g.getActivities(0, 10);
            return !list.some((a) => a.activityId === createdId);
          }, 10, 3000);
          activityId = undefined;

          if (sawWrongUrl) {
            return { ok: false, detail: `one or more calls returned 404 (wrong URL): ${outcomes.join(", ")}` };
          }
          if (!gone) {
            return {
              ok: false,
              detail: `all detail calls completed (${outcomes.join(", ")}), but activity ${createdId} still listed after delete + polling`,
            };
          }
          return { ok: true, detail: outcomes.join(", ") };
        } finally {
          if (activityId !== undefined) {
            await cleanupActivity(activityId, "activity detail sub-resource reads");
          }
        }
      },
    },
    {
      name: "setActivityExerciseSets round-trip (read back via getActivityExerciseSets) against a synthetic fixture",
      run: async () => {
        let activityId: number | undefined;
        try {
          const created = (await g.createManualActivity(
            localTimestampWithMs(new Date()),
            "UTC",
            "strength_training",
            0,
            10,
            `garminconnect-js-task4-exerciseSets-fixture-${Date.now()}`,
          )) as { activityId?: number } | null;
          if (typeof created?.activityId !== "number") {
            return {
              ok: false,
              detail: `createManualActivity did not return a numeric activityId (got ${JSON.stringify(created)})`,
            };
          }
          activityId = created.activityId;

          // Discovered live against the test account: Garmin rejects several plausible-looking
          // shapes before accepting this one — "Activity ID should not be Null in the Exercises
          // Object" (needs `activityId` repeated inside each set AND each exercise), then "Set
          // Type in a Set message can not be Null" (needs `setType`), then a 500
          // NullPointerException until `startTime` was present. None of this is documented in the
          // upstream inventory (which only says "caller-supplied payload ... sent as-is"); this
          // exact shape is the one that returned 2xx and read back correctly.
          const startTime = new Date().toISOString().replace(/\.\d+Z$/, ".0");
          const expectedDuration = 30;
          const expectedReps = 10;
          const expectedCategory = "SQUAT";
          const payload = {
            activityId,
            exerciseSets: [
              {
                activityId,
                duration: expectedDuration,
                repetitionCount: expectedReps,
                setType: "ACTIVE",
                startTime,
                exercises: [{ activityId, category: expectedCategory, subCategory: null }],
              },
            ],
          };
          await g.setActivityExerciseSets(activityId, payload);
          const readBack = (await g.getActivityExerciseSets(activityId)) as {
            exerciseSets?: {
              duration?: number;
              repetitionCount?: number;
              setType?: string;
              exercises?: { category?: string }[];
            }[];
          } | null;

          await g.deleteActivity(activityId);
          const createdId = activityId;
          const gone = await pollUntil(async () => {
            const list = await g.getActivities(0, 10);
            return !list.some((a) => a.activityId === createdId);
          }, 10, 3000);
          activityId = undefined;

          if (!gone) {
            return {
              ok: false,
              detail: `setActivityExerciseSets PUT accepted, read-back ${JSON.stringify(readBack)}, but activity ${createdId} still listed after delete + polling`,
            };
          }

          const storedSet = readBack?.exerciseSets?.[0];
          const storedCategory = storedSet?.exercises?.[0]?.category;
          if (
            storedSet?.duration !== expectedDuration ||
            storedSet?.repetitionCount !== expectedReps ||
            storedCategory !== expectedCategory
          ) {
            return {
              ok: false,
              detail: `sent duration=${expectedDuration}/reps=${expectedReps}/category=${expectedCategory}, Garmin stored ${JSON.stringify(storedSet)}`,
            };
          }
          return {
            ok: true,
            detail: `read-back matches what was sent: duration=${storedSet.duration}, repetitionCount=${storedSet.repetitionCount}, exercises[0].category=${storedCategory}`,
          };
        } finally {
          if (activityId !== undefined) {
            await cleanupActivity(activityId, "setActivityExerciseSets round-trip");
          }
        }
      },
    },
    {
      name: "getProgressSummaryBetweenDates (read-only, no fixture needed)",
      run: async () => {
        const today = new Date().toISOString().slice(0, 10);
        const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
        const result = await g.getProgressSummaryBetweenDates(weekAgo, today);
        return { ok: true, detail: `result: ${JSON.stringify(result)}` };
      },
    },
    {
      name: "gear-association 404 path (addGearToActivity/removeGearFromActivity/getGearActivities against a bogus gearUUID)",
      // Real gear creation was deliberately skipped: this inventory (and upstream) has no
      // delete/retire-gear endpoint, so gear created via POST /gear-service/gear/v2 would be
      // permanent on the test account — violating "the account must end with zero gear" with no
      // way to comply. Instead this verifies the URL shape and 404 error-mapping against a
      // syntactically valid but non-existent gearUUID, against a real (fixture) activityId.
      run: async () => {
        let activityId: number | undefined;
        try {
          const created = (await g.createManualActivity(
            localTimestampWithMs(new Date()),
            "UTC",
            "running",
            1,
            5,
            `garminconnect-js-task4-gear-404-fixture-${Date.now()}`,
          )) as { activityId?: number } | null;
          if (typeof created?.activityId !== "number") {
            return {
              ok: false,
              detail: `createManualActivity did not return a numeric activityId (got ${JSON.stringify(created)})`,
            };
          }
          activityId = created.activityId;
          const bogusGearUuid = "00000000-0000-0000-0000-000000000000";

          let addMessage = "";
          try {
            await g.addGearToActivity(bogusGearUuid, activityId);
            return { ok: false, detail: "addGearToActivity against a bogus gearUUID did not throw" };
          } catch (addError) {
            if (!(addError instanceof GarminConnectionError)) {
              return {
                ok: false,
                detail: `addGearToActivity threw ${(addError as Error).constructor.name}, expected GarminConnectionError: ${(addError as Error).message}`,
              };
            }
            addMessage = addError.message;
          }

          let removeMessage = "";
          try {
            await g.removeGearFromActivity(bogusGearUuid, activityId);
            return { ok: false, detail: "removeGearFromActivity against a bogus gearUUID did not throw" };
          } catch (removeError) {
            if (!(removeError instanceof GarminConnectionError)) {
              return {
                ok: false,
                detail: `removeGearFromActivity threw ${(removeError as Error).constructor.name}, expected GarminConnectionError: ${(removeError as Error).message}`,
              };
            }
            removeMessage = removeError.message;
          }

          const gearActivitiesResult = await g.getGearActivities(bogusGearUuid);

          await g.deleteActivity(activityId);
          const createdId = activityId;
          const gone = await pollUntil(async () => {
            const list = await g.getActivities(0, 10);
            return !list.some((a) => a.activityId === createdId);
          }, 10, 3000);
          activityId = undefined;

          if (!gone) {
            return {
              ok: false,
              detail: `add/remove/getGearActivities all behaved as expected, but activity ${createdId} still listed after delete + polling`,
            };
          }
          if (!Array.isArray(gearActivitiesResult) || gearActivitiesResult.length !== 0) {
            return {
              ok: false,
              detail: `getGearActivities against a bogus gearUUID expected [] on 404, got ${JSON.stringify(gearActivitiesResult)}`,
            };
          }
          return {
            ok: true,
            detail: `addGearToActivity -> "${addMessage}"; removeGearFromActivity -> "${removeMessage}"; getGearActivities -> []`,
          };
        } finally {
          if (activityId !== undefined) {
            await cleanupActivity(activityId, "gear-association 404 path");
          }
        }
      },
    },
    {
      name: "final account state after all activitiesDetail write probes",
      run: async () => {
        const clean = await pollUntilNoActivities();
        const list = await g.getActivities(0, 10);
        return {
          ok: clean,
          detail: `${list.length} activities remain on the account (expected 0)`,
        };
      },
    },
  ];
}

/** Polls `getWorkouts` until the account has zero workouts. */
async function pollUntilNoWorkouts(): Promise<boolean> {
  return pollUntil(async () => ((await g.getWorkouts(0, 10)) ?? []).length === 0, 10, 3000);
}

/** Polls a given month's `getScheduledWorkouts` until no `itemType === "workout"` calendar items remain. */
async function pollUntilNoScheduledWorkouts(year: number, month: number): Promise<boolean> {
  return pollUntil(async () => {
    const cal = await g.getScheduledWorkouts(year, month);
    return !(cal?.calendarItems ?? []).some((item) => item.itemType === "workout");
  }, 10, 3000);
}

/** A minimal, structurally-valid single-step running workout, matching `WorkoutInput`. */
function fixtureRunningWorkout(name: string) {
  return {
    workoutName: name,
    estimatedDurationInSecs: 1800,
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 },
        workoutSteps: [
          {
            type: "ExecutableStepDTO",
            stepOrder: 1,
            stepType: { stepTypeId: 1, stepTypeKey: "warmup", displayOrder: 1 },
            endCondition: {
              conditionTypeId: 2,
              conditionTypeKey: "time",
              displayOrder: 2,
              displayable: true,
            },
            endConditionValue: 600,
            targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 },
          },
        ],
      },
    ],
  };
}

function workoutProbes(): WriteProbe[] {
  return [
    {
      name:
        "uploadRunningWorkout -> getWorkoutById -> updateWorkout -> scheduleWorkout -> " +
        "getScheduledWorkouts -> unscheduleWorkout -> deleteWorkout (full round-trip, every stage read-back-asserted)",
      run: async () => {
        const before = await g.getWorkouts(0, 10);
        if ((before ?? []).length !== 0) {
          return {
            ok: false,
            detail: `refusing to run: account already has ${(before ?? []).length} workouts before this probe started`,
          };
        }

        const workoutName = `garminconnect-js-task6-running-${Date.now()}`;
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = now.getUTCMonth() + 1;
        const scheduleDate = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

        let workoutId: number | undefined;
        try {
          const uploaded = await g.uploadRunningWorkout(fixtureRunningWorkout(workoutName));
          if (typeof uploaded?.workoutId !== "number") {
            return {
              ok: false,
              detail: `uploadRunningWorkout did not return a numeric workoutId (got ${JSON.stringify(uploaded)})`,
            };
          }
          workoutId = uploaded.workoutId;

          // --- read back the created workout and assert the STORED structure, not just a 2xx ---
          const fetched = await g.getWorkoutById(workoutId);
          if (fetched?.workoutName !== workoutName) {
            return {
              ok: false,
              detail: `expected workoutName "${workoutName}", read back "${String(fetched?.workoutName)}"`,
            };
          }
          const sportType = fetched?.["sportType"] as { sportTypeKey?: string } | undefined;
          if (sportType?.sportTypeKey !== "running") {
            return {
              ok: false,
              detail: `expected sportType.sportTypeKey "running", read back ${JSON.stringify(sportType)}`,
            };
          }
          if (fetched?.["estimatedDurationInSecs"] !== 1800) {
            return {
              ok: false,
              detail: `expected estimatedDurationInSecs 1800, read back ${String(fetched?.["estimatedDurationInSecs"])}`,
            };
          }

          // --- updateWorkout: rename, then read back to confirm the change landed ---
          const newName = `garminconnect-js-task6-running-renamed-${Date.now()}`;
          await g.updateWorkout(workoutId, { ...(fetched as Record<string, unknown>), workoutName: newName });
          const afterUpdate = await g.getWorkoutById(workoutId);
          if (afterUpdate?.workoutName !== newName) {
            return {
              ok: false,
              detail: `updateWorkout: expected workoutName "${newName}", read back "${String(afterUpdate?.workoutName)}"`,
            };
          }

          // --- scheduleWorkout, verify via getScheduledWorkouts ---
          await g.scheduleWorkout(workoutId, scheduleDate);
          const calAfterSchedule = await g.getScheduledWorkouts(year, month);
          const items = calAfterSchedule?.calendarItems ?? [];
          const scheduledItem = items.find(
            (item) => item.itemType === "workout" && item["workoutId"] === workoutId,
          );
          if (!scheduledItem) {
            return {
              ok: false,
              detail:
                `scheduleWorkout issued but no matching item found in getScheduledWorkouts(${year},${month}); ` +
                `${items.length} workout-typed items present`,
            };
          }
          const scheduleId = scheduledItem["id"];
          if (typeof scheduleId !== "number" && typeof scheduleId !== "string") {
            return {
              ok: false,
              detail: `scheduled item found but has no usable id field to unschedule: ${JSON.stringify(scheduledItem)}`,
            };
          }

          // --- unscheduleWorkout, verify gone via getScheduledWorkouts ---
          await g.unscheduleWorkout(scheduleId);
          const goneScheduled = await pollUntil(async () => {
            const cal = await g.getScheduledWorkouts(year, month);
            return !(cal?.calendarItems ?? []).some(
              (item) => item.itemType === "workout" && item["workoutId"] === workoutId,
            );
          }, 10, 3000);
          if (!goneScheduled) {
            return {
              ok: false,
              detail: `unscheduleWorkout(${String(scheduleId)}) issued but workout ${workoutId} still appears scheduled after polling`,
            };
          }

          // --- deleteWorkout, verify gone via getWorkouts ---
          await g.deleteWorkout(workoutId);
          const deletedId = workoutId;
          workoutId = undefined; // delete issued; finally has nothing left to clean up either way
          const gone = await pollUntilNoWorkouts();
          if (!gone) {
            return {
              ok: false,
              detail: `deleteWorkout issued but workout ${deletedId} still listed after polling`,
            };
          }

          return {
            ok: true,
            detail:
              `created ${deletedId} (running); read-back matched workoutName/sportType/estimatedDurationInSecs; ` +
              `updateWorkout rename confirmed by read-back; scheduled for ${scheduleDate} and confirmed via ` +
              `getScheduledWorkouts; unscheduled and confirmed gone; deleted and confirmed gone`,
          };
        } finally {
          if (workoutId !== undefined) {
            try {
              await g.deleteWorkout(workoutId);
            } catch (cleanupError) {
              console.error(
                `  WARNING: cleanup failed for workout round-trip probe (workout ${workoutId}): ${(cleanupError as Error).message}`,
              );
            }
          }
        }
      },
    },
    {
      name: "pushWorkoutToDevice — expected to fail: the test account has no paired device",
      run: async () => {
        let workoutId: number | undefined;
        try {
          const uploaded = await g.uploadRunningWorkout(
            fixtureRunningWorkout(`garminconnect-js-task6-push-fixture-${Date.now()}`),
          );
          if (typeof uploaded?.workoutId !== "number") {
            return {
              ok: false,
              detail: `setup failed: uploadRunningWorkout did not return a numeric workoutId (got ${JSON.stringify(uploaded)}) — pushWorkoutToDevice itself was not exercised`,
            };
          }
          workoutId = uploaded.workoutId;

          try {
            const result = await g.pushWorkoutToDevice(workoutId);
            return {
              ok: false,
              detail:
                `UNEXPECTED: pushWorkoutToDevice succeeded (result=${JSON.stringify(result)}) — either a ` +
                `device is now paired on the test account, or this probe's "no device" assumption is stale`,
            };
          } catch (pushError) {
            if (pushError instanceof GarminHttpError) {
              return {
                ok: true,
                detail:
                  `pushWorkoutToDevice failed as expected (no paired device): GarminHttpError ${pushError.status} — ` +
                  `${pushError.message.slice(0, 200)}. No positive response was ever observed for this path.`,
              };
            }
            if (pushError instanceof GarminConnectionError || pushError instanceof Error) {
              return {
                ok: true,
                detail:
                  `pushWorkoutToDevice failed as expected (no paired device): ${pushError.constructor.name} — ` +
                  `${pushError.message.slice(0, 200)}. No positive response was ever observed for this path.`,
              };
            }
            throw pushError;
          }
        } finally {
          if (workoutId !== undefined) {
            try {
              await g.deleteWorkout(workoutId);
            } catch (cleanupError) {
              console.error(
                `  WARNING: cleanup failed for pushWorkoutToDevice probe (workout ${workoutId}): ${(cleanupError as Error).message}`,
              );
            }
          }
        }
      },
    },
    {
      name: "final account state after all workouts write probes",
      run: async () => {
        const cleanWorkouts = await pollUntilNoWorkouts();
        const now = new Date();
        const cleanScheduled = await pollUntilNoScheduledWorkouts(now.getUTCFullYear(), now.getUTCMonth() + 1);
        const list = await g.getWorkouts(0, 10);
        const cal = await g.getScheduledWorkouts(now.getUTCFullYear(), now.getUTCMonth() + 1);
        const scheduledCount = (cal?.calendarItems ?? []).filter((item) => item.itemType === "workout").length;
        return {
          ok: cleanWorkouts && cleanScheduled,
          detail: `${(list ?? []).length} workouts remain (expected 0); ${scheduledCount} scheduled workout calendar items remain this month (expected 0)`,
        };
      },
    },
  ];
}

/**
 * Gear has no delete/retire endpoint anywhere in upstream python-garminconnect or this port —
 * gear created here is PERMANENT on the test account. Task 7's brief explicitly overrides the
 * earlier "account ends with zero gear" rule for this reason (see task-7 report for the ruling).
 * A single gear item is created and reused across every probe below rather than one-per-probe, to
 * minimize residue.
 *
 * Two live findings from prior investigation shape these probes (see task-7 report for the full
 * detail):
 *  - `getGear`'s list entries store `uuid` WITHOUT hyphens (`createGear`'s response uses hyphens),
 *    and the distance field on read is named `maximumMeters`, not `maxUsageDistanceMeters` (that
 *    name is confirmed as the correct WRITE-side field from the POST body per the inventory, but
 *    no read endpoint discovered so far echoes a duration/distance field under that write name).
 *  - No field observed on `getGear`, `getGearStats`, or the raw `createGear` response ever
 *    surfaces a duration value at all, so `maxUsageDurationSeconds`'s conversion direction cannot
 *    be positively read-back-verified the way distance can — only the request-shape/rounding logic
 *    is verified (by the unit tests in tests/services/gear.test.ts) and by upstream source review.
 *  - `setGearDefault`'s success path (PUT `.../default/true`, DELETE the plain path) 404s for
 *    every activityType format tried live against real gear (lower-case key, upper-case key,
 *    mixed case, and the numeric `activityTypePk` shown by `getGearDefaults`, which instead
 *    returns 400 Bad Request) — including gear created with that activity type already
 *    pre-associated via `activityTypeKeys`. Only the 404-to-`GarminConnectionError` error-mapping
 *    path is verified live here, matching the same caveat already accepted for
 *    `addGearToActivity`/`removeGearFromActivity` in Task 4.
 */
function gearProbes(): WriteProbe[] {
  let sharedGearUuidDashed: string | undefined;
  let sharedGearUuidNoDash: string | undefined;

  /**
   * Finds the shared fixture in `getGear`'s list — its `uuid` field has no hyphens. No cast is
   * needed here: `getGear` is correctly typed as `Gear[] | null` (Task 7 fix-round-1 — it was
   * previously mistyped as a single object, which this probe had to cast around).
   */
  async function findSharedGear(): Promise<Record<string, unknown> | undefined> {
    const profile = await g.getUserProfile();
    const list = await g.getGear(profile.profileId);
    return (list ?? []).find((item) => item["uuid"] === sharedGearUuidNoDash);
  }

  return [
    {
      name: "createGear/getGear round-trip (unit conversion: km->m; duration unconfirmable, see notes)",
      run: async () => {
        const distanceKm = 5;
        const durationMin = 30;
        const expectedMeters = 5000;
        const gearName = `garminconnect-js-task7-gear-${Date.now()}`;

        const created = (await g.createGear(
          "shoes",
          "garminconnect-js",
          "test-fixture",
          gearName,
          new Date().toISOString().slice(0, 10),
          "distance",
          distanceKm,
          durationMin,
          "created by scripts/smoke-writes.ts (task 7); permanent, no delete endpoint exists",
        )) as Record<string, unknown> | null;

        const createdUuid = created?.["uuid"];
        if (typeof createdUuid !== "string") {
          return {
            ok: false,
            detail: `createGear did not return a string uuid (got ${JSON.stringify(created)})`,
          };
        }
        sharedGearUuidDashed = createdUuid;
        sharedGearUuidNoDash = createdUuid.replace(/-/g, "");

        const found = await pollUntil(async () => (await findSharedGear()) !== undefined, 5, 2000);
        if (!found) {
          return {
            ok: false,
            detail: `created gear uuid ${createdUuid} but it did not appear in getGear() after polling`,
          };
        }
        const stored = await findSharedGear();

        const storedMeters = stored?.["maximumMeters"];
        if (storedMeters !== expectedMeters) {
          return {
            ok: false,
            detail:
              `unit conversion bug: sent maxUsageDistanceKm=${distanceKm} expecting ${expectedMeters}m, ` +
              `Garmin stored maximumMeters=${JSON.stringify(storedMeters)}`,
          };
        }

        return {
          ok: true,
          detail:
            `created gear uuid=${createdUuid}, read back maximumMeters=${storedMeters} ` +
            `(sent maxUsageDistanceKm=${distanceKm}). Sent maxUsageDurationMin=${durationMin} ` +
            `(-> maxUsageDurationSeconds=${durationMin * 60} in the POST body) but no read endpoint ` +
            `found echoes a duration field, so that direction is unconfirmed live (see notes above ` +
            `this function). RESIDUE: this gear item is permanent (no delete endpoint).`,
        };
      },
    },
    {
      name: "getGearStats on the fixture gear",
      run: async () => {
        if (!sharedGearUuidDashed) {
          return { ok: false, detail: "no shared gear uuid (createGear probe must run first)" };
        }
        // Brand-new gear has no recorded activities, so `{}` (the documented 404 fallback) is a
        // legitimate pass here — the point is only that the call does not throw.
        const stats = await g.getGearStats(sharedGearUuidDashed);
        return {
          ok: true,
          detail: `getGearStats(${sharedGearUuidDashed}) -> ${JSON.stringify(stats)}`,
        };
      },
    },
    {
      name: "setGearDefault re-raises a 404 as GarminConnectionError (error-mapping path only — see notes)",
      run: async () => {
        // A syntactically valid but non-existent UUID, exactly like Task 4's precedent for
        // addGearToActivity/removeGearFromActivity — the success path could not be exercised
        // live (see the block comment above this function), so only the 404 mapping is verified.
        const bogusUuid = "00000000-0000-0000-0000-000000000000";
        try {
          await g.setGearDefault("running", bogusUuid, true);
          return {
            ok: false,
            detail: `expected a GarminConnectionError for a non-existent gear uuid, but the call succeeded`,
          };
        } catch (error) {
          if (
            error instanceof GarminConnectionError &&
            error.message.includes("gear not found")
          ) {
            return {
              ok: true,
              detail: `setGearDefault("running", "${bogusUuid}", true) correctly re-raised as GarminConnectionError: ${error.message}`,
            };
          }
          throw error;
        }
      },
    },
  ];
}

// Each subsequent task appends its service's WRITE probes here.
const services: Record<string, WriteProbe[]> = {
  weight: [
    {
      name: "addWeighIn/deleteWeighIn round-trip",
      run: async () => {
        const value = 72.55;
        const unitKey = "kg";
        const when = new Date();
        const dateStr = when.toISOString().slice(0, 10);
        let created = false;

        try {
          await g.addWeighIn(value, unitKey, when);
          created = true;

          const range = await g.getWeighIns(dateStr, dateStr);
          const summaries = range.dailyWeightSummaries ?? [];
          const daySummary = summaries.find(
            (s) => (s as { summaryDate?: string })["summaryDate"] === dateStr,
          ) as { allWeightMetrics?: { weight?: number; samplePk?: number }[] } | undefined;
          const entries = daySummary?.allWeightMetrics ?? [];
          const entry = entries.find((e) => {
            const grams = e.weight;
            return typeof grams === "number" && Math.abs(grams / 1000 - value) < 0.001;
          });

          if (!entry || typeof entry.weight !== "number" || typeof entry.samplePk !== "number") {
            return {
              ok: false,
              detail: `wrote ${value}${unitKey} but could not find a matching stored entry on ${dateStr} (found ${entries.length} entries that day)`,
            };
          }

          const storedKg = entry.weight / 1000;
          if (Math.abs(storedKg - value) > 0.001) {
            return {
              ok: false,
              detail: `wrote ${value}${unitKey} but Garmin stored ${storedKg}kg (${entry.weight}g) — read-back mismatch`,
            };
          }

          const weightPk = entry.samplePk;
          await g.deleteWeighIn(dateStr, weightPk);

          const gone = await pollUntil(async () => {
            const after = await g.getWeighIns(dateStr, dateStr);
            const afterSummaries = after.dailyWeightSummaries ?? [];
            const afterDay = afterSummaries.find(
              (s) => (s as { summaryDate?: string })["summaryDate"] === dateStr,
            ) as { allWeightMetrics?: { samplePk?: number }[] } | undefined;
            const afterEntries = afterDay?.allWeightMetrics ?? [];
            return !afterEntries.some((e) => e.samplePk === weightPk);
          });
          created = false; // deleted; cleanup finally block has nothing left to do

          if (!gone) {
            return {
              ok: false,
              detail: `stored ${storedKg}kg correctly, but deleteWeighIn did not remove samplePk ${weightPk} after polling`,
            };
          }

          return {
            ok: true,
            detail: `wrote ${value}${unitKey}, read back ${storedKg}kg (${entry.weight}g), deleted, confirmed gone`,
          };
        } finally {
          if (created) {
            // Best-effort cleanup: an assertion above failed after the write
            // succeeded. Find today's entries and remove anything we added
            // at this timestamp so the account is left as it was found.
            try {
              const range = await g.getWeighIns(dateStr, dateStr);
              const summaries = range.dailyWeightSummaries ?? [];
              const daySummary = summaries.find(
                (s) => (s as { summaryDate?: string })["summaryDate"] === dateStr,
              ) as { allWeightMetrics?: { weight?: number; samplePk?: number }[] } | undefined;
              const entries = daySummary?.allWeightMetrics ?? [];
              for (const e of entries) {
                const grams = e.weight;
                if (
                  typeof grams === "number" &&
                  Math.abs(grams / 1000 - value) < 0.001 &&
                  typeof e.samplePk === "number"
                ) {
                  await g.deleteWeighIn(dateStr, e.samplePk);
                }
              }
            } catch (cleanupError) {
              console.error(
                `  WARNING: cleanup failed for "addWeighIn/deleteWeighIn round-trip": ${(cleanupError as Error).message}`,
              );
            }
          }
        }
      },
    },
  ],
  activities: activityProbes(),
  activitiesDetail: activitiesDetailProbes(),
  workouts: workoutProbes(),
  gear: gearProbes(),
};

const which = process.argv[2];
const probes = which ? services[which] : Object.values(services).flat();
if (!probes) {
  console.error(`Unknown service "${which}". Known: ${Object.keys(services).join(", ")}`);
  process.exit(1);
}

let pass = 0,
  fail = 0;
for (const p of probes) {
  try {
    const { ok, detail } = await p.run();
    if (ok) {
      console.log(`  PASS  ${p.name.padEnd(40)} ${detail}`);
      pass++;
    } else {
      console.log(`  FAIL  ${p.name.padEnd(40)} ${detail}`);
      fail++;
    }
  } catch (e) {
    if (e instanceof GarminHttpError && e.status === 412) {
      console.log(
        `  FAIL  ${p.name.padEnd(40)} 412 PreconditionFailedException — this is an account-state ` +
          `precondition (e.g. EU upload consent not granted), not necessarily a library bug.`,
      );
    } else {
      const err = e as Error;
      console.log(`  FAIL  ${p.name.padEnd(40)} ${err.constructor.name}: ${err.message.slice(0, 120)}`);
    }
    fail++;
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
