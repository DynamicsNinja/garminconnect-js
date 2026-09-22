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

const liveProfile = await g.getUserProfile();
const liveProfileId = String(liveProfile.profileId);
if (liveProfileId !== expectedProfileId) {
  console.error(
    "Refusing to run: the live account's profile does not match the expected test account.\n" +
      `  expected profileId: ${expectedProfileId}\n` +
      `  found    profileId: ${liveProfileId} (userName: ${liveProfile.userName})\n` +
      "This is very likely the wrong account. No writes were issued.",
  );
  process.exit(1);
}
console.log(`Safety gate passed: live account matches GARMIN_TEST_PROFILE_ID (${liveProfileId}).\n`);

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
