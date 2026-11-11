/**
 * `setSleepWindow` against a REAL account, because the test account records no sleep.
 *
 *   npx tsx scripts/smoke-sleep-real.ts --yes-write-to-real-account [--date YYYY-MM-DD]
 *
 * Why a real account: a sleep record only exists for a night a paired device recorded, and the
 * test account has no device. `--date` is the night's WAKE-UP date, the one Garmin files it under
 * (default: today's local date).
 *
 * Gated like `push-workout-real.ts`: without the flag it only describes what it would do; it
 * refuses the test account; there is no npm alias.
 *
 * What it checks: it snapshots the night (window, duration, stages, confirmation type), moves
 * the bedtime one minute earlier, reads it back, then restores the original window and compares
 * the restored night with the snapshot. The restore is skipped if the move never succeeded. A
 * manual edit leaves the night `manually_confirmed`, so a changed confirmation type is reported
 * for information, not as a failure.
 *
 * Output is shapes and booleans: never the account's own times or durations.
 */
import "./load-env.js";
import { GarminClient, Garmin, FileTokenStore, GarminHttpError } from "../src/index.js";
import { formatDate } from "../src/util/date.js";

const CONFIRM = "--yes-write-to-real-account";
const dateFlag = process.argv.indexOf("--date");
const now = new Date();
const localToday = [
  String(now.getFullYear()),
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0"),
].join("-");
let DAY: string;
try {
  DAY = formatDate(dateFlag >= 0 ? (process.argv[dateFlag + 1] ?? "") : localToday);
} catch {
  console.error("--date must be a real calendar date, YYYY-MM-DD.");
  process.exit(1);
}

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens-real") });
if (!(await client.loadTokens())) {
  console.error("No tokens in ./tokens-real. Run `npm run login:real` first.");
  process.exit(1);
}
const g = new Garmin(client);
const profile = await g.getUserProfile();
if (String(profile.profileId) === String(process.env["GARMIN_TEST_PROFILE_ID"])) {
  console.error("Refusing to run: ./tokens-real holds the TEST account, which records no sleep.");
  process.exit(1);
}
const expectedReal = process.env["GARMIN_REAL_PROFILE_ID"];
if (expectedReal && String(profile.profileId) !== expectedReal) {
  console.error("Refusing to run: live profile does not match GARMIN_REAL_PROFILE_ID.");
  process.exit(1);
}
if (!process.argv.includes(CONFIRM)) {
  console.log(
    "DRY RUN: nothing was written.\n\nThis would read the night filed under " +
      `${DAY}, move its bedtime one minute earlier with setSleepWindow, read it back, then ` +
      "restore the original window and read it back again.\n" +
      `Re-run with ${CONFIRM} to do it.`,
  );
  process.exit(0);
}

let pass = 0;
let fail = 0;
const report = (ok: boolean, label: string, detail: string) => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(36)} ${detail}`);
};
const describe = (e: unknown) =>
  e instanceof GarminHttpError ? `HTTP ${String(e.status)} ${e.body.slice(0, 160)}` : String(e);

const original = (await g.getSleepData(DAY))?.dailySleepDTO;
const origStart = original?.sleepStartTimestampGMT;
const origEnd = original?.sleepEndTimestampGMT;
if (typeof origStart !== "number" || typeof origEnd !== "number") {
  console.error(`No sleep window recorded on ${DAY}; pick a night with --date.`);
  process.exit(1);
}
const SNAPSHOT_KEYS = [
  "sleepStartTimestampGMT",
  "sleepEndTimestampGMT",
  "sleepTimeSeconds",
  "lightSleepSeconds",
  "deepSleepSeconds",
  "remSleepSeconds",
  "awakeSleepSeconds",
] as const;
const snapshot = Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, original?.[k]]));
const origConfirmation = original?.sleepWindowConfirmationType;
report(original?.id === origStart, "getSleepData: id equals the start", String(original?.id === origStart));

const target = origStart - 60_000;
let moved = false;
try {
  const result = await g.setSleepWindow(DAY, new Date(target), new Date(origEnd));
  moved = true;
  report(result?.id === target, "setSleepWindow: response id is new start", String(result?.id === target));
  report(result?.sleepWindowConfirmed === true, "setSleepWindow: window confirmed", String(result?.sleepWindowConfirmed === true));
  const back = (await g.getSleepData(DAY))?.dailySleepDTO;
  report(
    back?.sleepStartTimestampGMT === target && back.sleepEndTimestampGMT === origEnd,
    "read back: start and end stored",
    `start moved: ${String(back?.sleepStartTimestampGMT === target)}, end kept: ${String(back?.sleepEndTimestampGMT === origEnd)}`,
  );
  report(back?.id === target, "read back: id changed to new start", String(back?.id === target));
} catch (e) {
  report(false, "setSleepWindow round-trip", describe(e));
} finally {
  if (!moved) {
    console.log("  SKIP  restore                              the move never succeeded");
  } else {
    try {
      await g.setSleepWindow(DAY, new Date(origStart), new Date(origEnd));
      const restored = (await g.getSleepData(DAY))?.dailySleepDTO;
      for (const k of SNAPSHOT_KEYS) {
        const same = restored?.[k] === snapshot[k];
        report(same, `restore: ${k}`, `matches snapshot: ${String(same)}`);
      }
      const confirmationChanged = restored?.sleepWindowConfirmationType !== origConfirmation;
      console.log(`  INFO  ${"restore: confirmation type changed".padEnd(36)} ${String(confirmationChanged)}`);
    } catch (e) {
      report(false, "restore original window", describe(e));
      console.error(
        `\n!!! RESTORE FAILED for the night filed under ${DAY}. The bedtime is still one minute ` +
          "early. Restore it by hand: Garmin Connect > Sleep > that night > edit sleep times.",
      );
    }
  }
}
console.log(`\n${String(pass)} passed, ${String(fail)} failed.`);
process.exitCode = fail > 0 ? 1 : 0;
