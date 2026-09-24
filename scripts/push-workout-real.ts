/**
 * The ONE write this project performs against a real, personal account: `pushWorkoutToDevice`.
 *
 *   npx tsx scripts/push-workout-real.ts --yes-write-to-real-account
 *
 * Why it needs its own script. `pushWorkoutToDevice` is the last method whose final POST has never
 * run. It cannot be closed on the test account — that account has no paired device, so
 * `mylastused` yields nothing and the POST goes out with device id 0 (`404 "Device id 0 is not
 * registered."`). And it cannot be closed by `npm run smoke:real`, whose transport refuses every
 * non-GET on purpose. Weakening that harness to fit one write would have thrown away the guarantee
 * that makes it safe; a separate, explicitly-gated script does not.
 *
 * It is deliberately awkward to run:
 *
 *  - The confirmation flag above is required. Without it the script prints what it WOULD do and
 *    exits, so a stray `npx tsx` cannot write to anyone's account.
 *  - It refuses to run against GARMIN_TEST_PROFILE_ID — that account cannot exercise this, so a
 *    run there would be a mistake about which token directory is in play.
 *  - There is no npm script alias. Running it should take intent.
 *
 * What it does, and what it leaves behind: creates one clearly-named workout, reads it back,
 * pushes it to the last-used device, and then LEAVES BOTH IN PLACE — the point is for a human to
 * see it arrive on the watch, which deleting it immediately would undo. It prints the exact
 * cleanup call at the end.
 */
import "./load-env.js";
import { GarminClient, Garmin, FileTokenStore, GarminHttpError, buildWorkout } from "../src/index.js";

const CONFIRM = "--yes-write-to-real-account";
const confirmed = process.argv.includes(CONFIRM);

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens-real") });
if (!(await client.loadTokens())) {
  console.error("No tokens in ./tokens-real. Run `npm run login:real` first.");
  process.exit(1);
}
const g = new Garmin(client);

const profile = await g.getUserProfile();
const testId = process.env["GARMIN_TEST_PROFILE_ID"];
if (testId && String(profile.profileId) === String(testId)) {
  console.error(
    "Refusing to run: ./tokens-real holds the TEST account, which has no paired device and " +
      "therefore cannot exercise this method at all.",
  );
  process.exit(1);
}

if (!confirmed) {
  console.log(
    "DRY RUN — nothing was written.\n\n" +
      `This would, on profile ${String(profile.profileId)}:\n` +
      "  1. create a workout named \"[api test] Easy 20 min\"\n" +
      "  2. read it back to confirm what Garmin stored\n" +
      "  3. push it to the last-used device via pushWorkoutToDevice\n" +
      "  4. leave both in place so you can see it arrive on the watch\n\n" +
      `Re-run with ${CONFIRM} to do it.`,
  );
  process.exit(0);
}

const describe = (e: unknown) =>
  e instanceof GarminHttpError
    ? `HTTP ${String(e.status)} ${e.body.slice(0, 200)}`
    : `${(e as Error).constructor.name}: ${(e as Error).message.slice(0, 200)}`;

console.log(`Writing to profile ${String(profile.profileId)} (confirmed).\n`);

// --- 1. a deliberately simple workout: warm up, steady, cool down ------------------------------
const workout = buildWorkout("[api test] Easy 20 min", { sport: "running" })
  .warmup({ time: 300, notes: "easy" })
  .interval({ time: 900, target: { heartRateZone: 2 } })
  .cooldown({ time: 300 })
  .build();

const created = await g.uploadWorkout(workout);
const workoutId = created?.workoutId;
if (workoutId === undefined) {
  console.error(`upload returned no workoutId: ${JSON.stringify(created).slice(0, 200)}`);
  process.exit(1);
}
console.log(`  created   workoutId=${String(workoutId)}`);

// --- 2. read back. A 2xx is not evidence; the stored document is. ------------------------------
// Typed access throughout, no casts: `eslint --fix` strips a cast it judges redundant, and the
// first version of this file was written with two. It removed them, `tsc` then failed on the
// index access, and CI caught what the local run should have.
const stored = await g.getWorkoutById(workoutId);
// `WorkoutRecord`'s index signature yields `unknown`, so narrowing `sportType` needs a real cast
// — unlike the two `eslint --fix` removed, casting FROM `unknown` is never redundant.
const sportKey = (stored?.["sportType"] as { sportTypeKey?: unknown } | undefined)?.sportTypeKey;
console.log(
  `  readback  sportTypeKey=${JSON.stringify(sportKey)} name=${JSON.stringify(stored?.workoutName)}`,
);

// --- 3. the actual subject of this script -----------------------------------------------------
// `getDeviceLastUsed()` rather than a raw `connectapi` call — it is the same request, typed, and
// it is what `pushWorkoutToDevice` itself uses to resolve a missing deviceId.
const lastUsed = await g.getDeviceLastUsed();
console.log(`  device    resolved userDeviceId=${String(lastUsed?.userDeviceId)}`);

try {
  const pushed = await g.pushWorkoutToDevice(workoutId);
  console.log(`\n  PUSH OK   ${JSON.stringify(pushed)?.slice(0, 300) ?? "null"}`);
  console.log(
    "\nCheck the watch — it should appear after the next sync.\n" +
      `To remove it:  await garmin.deleteWorkout(${String(workoutId)})`,
  );
} catch (e) {
  console.log(`\n  PUSH FAILED  ${describe(e)}`);
  console.log(
    `\nThe workout itself was created and is still there (workoutId=${String(workoutId)}).\n` +
      `To remove it:  await garmin.deleteWorkout(${String(workoutId)})`,
  );
  process.exitCode = 1;
}
