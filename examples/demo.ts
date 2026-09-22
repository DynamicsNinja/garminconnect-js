/**
 * Interactive demo of garminconnect-js.
 *
 *   npm run login   # once, to write ./tokens
 *   npm run demo
 *
 * Loads tokens from ./tokens (via FileTokenStore) and walks a numbered menu
 * of the categories this library actually implements. It never prompts for
 * a password — if no tokens are found it tells you to run `npm run login`
 * first and exits.
 */
import "../scripts/load-env.js";
import { createInterface } from "node:readline/promises";
import { mkdir, writeFile } from "node:fs/promises";
import {
  GarminClient,
  Garmin,
  FileTokenStore,
  GarminAuthError,
  type SocialProfile,
} from "../src/index.js";
import { scrub } from "../tests/helpers/scrub.js";

const TOKEN_DIR = "./tokens";
const EXPORT_DIR = "./export";

const client = new GarminClient({ tokenStore: new FileTokenStore(TOKEN_DIR) });

async function main(): Promise<void> {
  const hasTokens = await client.loadTokens();
  if (!hasTokens) {
    console.error(`No tokens found in ${TOKEN_DIR}. Run "npm run login" first.`);
    process.exitCode = 1;
    return;
  }

  const garmin = new Garmin(client);

  if (!process.stdin.isTTY) {
    // Non-interactive stdin (CI, a pipe, `echo | npx tsx examples/demo.ts`):
    // show the menu once and exit cleanly instead of blocking on a prompt
    // that will never receive input.
    console.log(MENU);
    console.log("(stdin is not a TTY; exiting without prompting)");
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let running = true;
    while (running) {
      console.log(MENU);
      const answer = (await rl.question("> ")).trim();
      running = await handleChoice(answer, garmin);
    }
  } finally {
    rl.close();
  }
}

const MENU = `
garminconnect-js demo
=====================
1) User & Profile
2) Daily Health
3) Activities
4) Body Composition
5) Export all to JSON
0) Exit
`;

/** Returns false when the loop should stop. */
async function handleChoice(choice: string, garmin: Garmin): Promise<boolean> {
  switch (choice) {
    case "0":
      console.log("Goodbye.");
      return false;
    case "1":
      await run(() => showProfile(garmin));
      return true;
    case "2":
      await run(() => showDailyHealth(garmin));
      return true;
    case "3":
      await run(() => showActivities(garmin));
      return true;
    case "4":
      await run(() => showBodyComposition(garmin));
      return true;
    case "5":
      await run(() => exportAll(garmin));
      return true;
    default:
      console.log(`Unrecognized choice: "${choice}"`);
      return true;
  }
}

/** Runs one menu action, turning a Garmin error into a friendly message. */
async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof GarminAuthError) {
      console.error(
        `Authentication failed (${error.message}). Your tokens are likely expired or ` +
          `revoked — run "npm run login" again.`,
      );
      return;
    }
    console.error("Request failed:", error instanceof Error ? error.message : error);
  }
}

function yesterday(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

// --- 1) User & Profile ---

async function showProfile(garmin: Garmin): Promise<void> {
  const profile: SocialProfile = await garmin.getUserProfile();
  const unit = await garmin.unitSystem();
  console.log("\n--- User & Profile ---");
  console.log(`Display name : ${profile.displayName}`);
  console.log(`Full name    : ${profile.fullName}`);
  console.log(`Profile ID   : ${profile.profileId}`);
  console.log(`Unit system  : ${unit ?? "(not set)"}`);
}

// --- 2) Daily Health ---

async function showDailyHealth(garmin: Garmin): Promise<void> {
  const date = yesterday();
  console.log(`\n--- Daily Health (${date}) ---`);

  const summary = await garmin.getUserSummary(date);
  console.log(
    `Steps: ${summary.totalSteps ?? "n/a"}  ` +
      `Distance: ${formatKm(summary.totalDistanceMeters)}  ` +
      `Active kcal: ${summary.activeKilocalories ?? "n/a"}`,
  );

  const hr = await garmin.getHeartRates(date);
  console.log(
    `Resting HR: ${hr.restingHeartRate ?? "n/a"} bpm  ` +
      `Min/Max: ${hr.minHeartRate ?? "n/a"}/${hr.maxHeartRate ?? "n/a"} bpm`,
  );

  const sleep = await garmin.getSleepData(date);
  console.log(sleep ? "Sleep data: available" : "Sleep data: none recorded for this date");

  const hrv = await garmin.getHrvData(date);
  console.log(hrv?.hrvSummary ? "HRV: available" : "HRV: none recorded for this date");

  const bb = await garmin.getBodyBattery(date);
  console.log(`Body Battery entries: ${Array.isArray(bb) ? bb.length : 0}`);
}

function formatKm(meters?: number): string {
  return typeof meters === "number" ? `${(meters / 1000).toFixed(1)} km` : "n/a";
}

// --- 3) Activities ---

async function showActivities(garmin: Garmin): Promise<void> {
  const activities = await garmin.getActivities(0, 5);
  console.log(`\n--- Activities (${activities.length} most recent) ---`);
  for (const activity of activities) {
    const distanceKm =
      typeof activity.distance === "number" ? `${(activity.distance / 1000).toFixed(1)} km` : "n/a";
    const durationMin =
      typeof activity.duration === "number" ? `${Math.round(activity.duration / 60)} min` : "n/a";
    console.log(
      `#${activity.activityId}  ${activity.activityName ?? "(untitled)"}  ` +
        `${activity.startTimeLocal ?? "n/a"}  ${distanceKm}  ${durationMin}`,
    );
  }
  if (activities.length === 0) console.log("(no activities found)");
}

// --- 4) Body Composition ---

async function showBodyComposition(garmin: Garmin): Promise<void> {
  const start = daysAgo(30);
  const end = yesterday();
  const range = await garmin.getWeighIns(start, end);
  const entries = range.dailyWeightSummaries ?? [];
  console.log(`\n--- Body Composition (${start} to ${end}) ---`);
  console.log(`Weigh-in days recorded: ${entries.length}`);
  if (range.totalAverage) {
    console.log("Average over range:", JSON.stringify(range.totalAverage));
  }
}

// --- 5) Export all to JSON ---

async function exportAll(garmin: Garmin): Promise<void> {
  const date = yesterday();
  console.log("\n--- Export all to JSON ---");

  const [profile, unit, summary, steps, hr, sleep, hrv, bb, activities, weighIns] =
    await Promise.all([
      garmin.getUserProfile(),
      garmin.unitSystem(),
      garmin.getUserSummary(date),
      garmin.getStepsData(date),
      garmin.getHeartRates(date),
      garmin.getSleepData(date),
      garmin.getHrvData(date),
      garmin.getBodyBattery(date),
      garmin.getActivities(0, 5),
      garmin.getWeighIns(daysAgo(30), date),
    ]);

  const payload = scrub({
    profile,
    unit,
    date,
    summary,
    steps,
    heartRates: hr,
    sleep,
    hrv,
    bodyBattery: bb,
    activities,
    weighIns,
  });

  await mkdir(EXPORT_DIR, { recursive: true });
  const outPath = `${EXPORT_DIR}/demo-export-${date}.json`;
  await writeFile(outPath, JSON.stringify(payload, null, 2) + "\n");

  console.log(`Wrote ${outPath}`);
  console.log(
    `${EXPORT_DIR}/ is gitignored, and fields have been passed through the same scrub() ` +
      "helper the test fixtures use. That is a safety net, not a guarantee — it redacts " +
      "by FIELD NAME, so free-text fields (titles, notes, descriptions) are not content-" +
      "scanned. Treat this file as containing real personal data and do not share it.",
  );
}

await main();
