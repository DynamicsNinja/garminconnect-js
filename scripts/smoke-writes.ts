import "./load-env.js";
import { GarminClient, Garmin, FileTokenStore, GarminHttpError } from "../src/index.js";

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
