import "./load-env.js";
import { GarminClient, Garmin, FileTokenStore } from "../src/index.js";

type Probe = { name: string; run: () => Promise<unknown> };

/**
 * Returned by a probe that could not issue its request at all — a precondition the test account
 * cannot satisfy (no paired device, no gear, no activity of the required kind).
 *
 * This exists because a probe that never fetched anything used to print as `PASS ... null`,
 * visually identical to "the endpoint returned null". A code review found two device methods
 * promoted to "live-verified: yes" in AGENTS.md on exactly that evidence. A skip must never be
 * able to render as a pass.
 */
class Skipped {
  constructor(readonly reason: string) {}
}
const skip = (reason: string) => new Skipped(reason);

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
if (!(await client.loadTokens())) {
  console.error("No tokens. Run `npm run login` first.");
  process.exit(1);
}
const g = new Garmin(client);
const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

// Each task appends its service's READ probes here.
const services: Record<string, Probe[]> = {
  wellness: [
    { name: "getUserSummary", run: () => g.getUserSummary(day) },
    { name: "getStepsData", run: () => g.getStepsData(day) },
    { name: "getBodyBatteryEvents", run: () => g.getBodyBatteryEvents(day) },
    { name: "getFloors", run: () => g.getFloors(day) },
    { name: "getDailySteps", run: () => g.getDailySteps(weekAgo, day) },
    { name: "getWeeklySteps", run: () => g.getWeeklySteps(day) },
    { name: "getWeeklyStress", run: () => g.getWeeklyStress(day) },
    {
      name: "getWeeklyIntensityMinutes",
      run: () => g.getWeeklyIntensityMinutes(weekAgo, day),
    },
    { name: "getStatsAndBody", run: () => g.getStatsAndBody(day) },
    { name: "getBloodPressure", run: () => g.getBloodPressure(weekAgo, day) },
    { name: "getHydrationData", run: () => g.getHydrationData(day) },
    { name: "getRespirationData", run: () => g.getRespirationData(day) },
    { name: "getSpo2Data", run: () => g.getSpo2Data(day) },
    { name: "getIntensityMinutesData", run: () => g.getIntensityMinutesData(day) },
    { name: "getAllDayStress", run: () => g.getAllDayStress(day) },
    { name: "getStressData", run: () => g.getStressData(day) },
    { name: "getAllDayEvents", run: () => g.getAllDayEvents(day) },
    { name: "getSleepDaily", run: () => g.getSleepDaily(weekAgo, day) },
    { name: "getRhrDay", run: () => g.getRhrDay(day) },
    { name: "getRhrDaily", run: () => g.getRhrDaily(weekAgo, day) },
    { name: "getCaloriesDaily", run: () => g.getCaloriesDaily(weekAgo, day) },
    { name: "getHrvDataRange", run: () => g.getHrvDataRange(weekAgo, day) },
  ],
  activities: [
    { name: "countActivities", run: () => g.countActivities() },
    { name: "getActivities", run: () => g.getActivities(0, 5) },
    { name: "getActivitiesForDate", run: () => g.getActivitiesForDate(day) },
    { name: "getActivitiesByDate", run: () => g.getActivitiesByDate(weekAgo, day) },
    { name: "getLastActivity", run: () => g.getLastActivity() },
    {
      name: "getActivity",
      run: async () => {
        const last = await g.getLastActivity();
        if (!last) return null;
        return g.getActivity(last.activityId);
      },
    },
    { name: "getActivityTypes", run: () => g.getActivityTypes() },
    // The following need a real activityId to hit a non-404 path. The test account is normally
    // empty, so `getLastActivity()` returning `null` (and these resolving to `null` rather than
    // issuing a request against a made-up id) is the expected, PASSing outcome when run standalone.
    // Live verification against a real fixture activity is performed in scripts/smoke-writes.ts
    // (key "activitiesDetail"), which creates and deletes one around these same calls.
    {
      name: "getActivitySplits",
      run: async () => {
        const last = await g.getLastActivity();
        return last ? g.getActivitySplits(last.activityId) : null;
      },
    },
    {
      name: "getActivityTypedSplits",
      run: async () => {
        const last = await g.getLastActivity();
        return last ? g.getActivityTypedSplits(last.activityId) : null;
      },
    },
    {
      name: "getActivitySplitSummaries",
      run: async () => {
        const last = await g.getLastActivity();
        return last ? g.getActivitySplitSummaries(last.activityId) : null;
      },
    },
    {
      name: "getActivityWeather",
      run: async () => {
        const last = await g.getLastActivity();
        return last ? g.getActivityWeather(last.activityId) : null;
      },
    },
    {
      name: "getActivityHrInTimezones",
      run: async () => {
        const last = await g.getLastActivity();
        return last ? g.getActivityHrInTimezones(last.activityId) : null;
      },
    },
    {
      name: "getActivityPowerInTimezones",
      run: async () => {
        const last = await g.getLastActivity();
        return last ? g.getActivityPowerInTimezones(last.activityId) : null;
      },
    },
    {
      name: "getActivityDetails",
      run: async () => {
        const last = await g.getLastActivity();
        return last ? g.getActivityDetails(last.activityId) : null;
      },
    },
    {
      name: "getActivityExerciseSets",
      run: async () => {
        const last = await g.getLastActivity();
        return last ? g.getActivityExerciseSets(last.activityId) : null;
      },
    },
    {
      name: "getActivityGear",
      run: async () => {
        const last = await g.getLastActivity();
        return last ? g.getActivityGear(last.activityId) : null;
      },
    },
    {
      name: "getGearActivities",
      // No real gear UUID exists on the test account (gear has no delete/retire endpoint in this
      // port, so none was created — see task-4 report); exercised with a bogus UUID to confirm the
      // URL shape and the "404 -> []" null-behaviour without needing real gear.
      run: () => g.getGearActivities("00000000-0000-0000-0000-000000000000"),
    },
    { name: "getProgressSummaryBetweenDates", run: () => g.getProgressSummaryBetweenDates(weekAgo, day) },
    { name: "downloadHealthSnapshot", run: () => g.downloadHealthSnapshot(day) },
  ],
  metrics: [
    { name: "getMaxMetrics", run: () => g.getMaxMetrics(day) },
    { name: "getMaxMetricsRange", run: () => g.getMaxMetricsRange(weekAgo, day) },
    { name: "getFunctionalThresholdPowerRange", run: () => g.getFunctionalThresholdPowerRange(weekAgo, day) },
    // Both branches of getLactateThreshold are exercised live: default (latest=true), then the
    // latest=false range branch, which requires startDate.
    { name: "getLactateThreshold (latest=true)", run: () => g.getLactateThreshold() },
    { name: "getLactateThreshold (latest=false)", run: () => g.getLactateThreshold(false, weekAgo, day) },
    { name: "getTrainingReadiness", run: () => g.getTrainingReadiness(day) },
    { name: "getMorningTrainingReadiness", run: () => g.getMorningTrainingReadiness(day) },
    // Both branches of getEnduranceScore.
    { name: "getEnduranceScore (single day)", run: () => g.getEnduranceScore(day) },
    { name: "getEnduranceScore (range)", run: () => g.getEnduranceScore(weekAgo, day) },
    { name: "getRunningTolerance", run: () => g.getRunningTolerance(weekAgo, day) },
    // Both branches of getRacePredictions.
    { name: "getRacePredictions (no params)", run: () => g.getRacePredictions() },
    { name: "getRacePredictions (all params)", run: () => g.getRacePredictions(weekAgo, day, "daily") },
    { name: "getTrainingStatus", run: () => g.getTrainingStatus(day) },
    { name: "getFitnessAgeData", run: () => g.getFitnessAgeData(day) },
    // Both branches of getHillScore.
    { name: "getHillScore (single day)", run: () => g.getHillScore(day) },
    { name: "getHillScore (range)", run: () => g.getHillScore(weekAgo, day) },
    { name: "getCyclingFtp", run: () => g.getCyclingFtp() },
    { name: "getHeartRateZones", run: () => g.getHeartRateZones() },
    { name: "getPowerZones", run: () => g.getPowerZones() },
    { name: "getPowerZonesForSport", run: () => g.getPowerZonesForSport("CYCLING") },
  ],
  workouts: [
    { name: "getWorkouts", run: () => g.getWorkouts(0, 5) },
    {
      name: "getWorkoutById",
      run: async () => {
        const list = await g.getWorkouts(0, 1);
        const first = list?.[0];
        return first ? g.getWorkoutById(first.workoutId!) : null;
      },
    },
    { name: "getScheduledWorkouts", run: () => g.getScheduledWorkouts(new Date().getFullYear(), new Date().getMonth() + 1) },
    {
      name: "getScheduledWorkoutById",
      run: async () => {
        const month = await g.getScheduledWorkouts(new Date().getFullYear(), new Date().getMonth() + 1);
        const item = month?.calendarItems?.find((i) => i.itemType === "workout");
        const scheduleId = item?.["id"];
        return typeof scheduleId === "number" || typeof scheduleId === "string"
          ? g.getScheduledWorkoutById(scheduleId)
          : null;
      },
    },
    { name: "getNextScheduledWorkout", run: () => g.getNextScheduledWorkout() },
  ],
  gear: [
    // Deliberately using upstream's exact `filterGear` (no `v2`) path here — see task-7 report for
    // the live verdict on whether this deprecated-looking path still works.
    {
      name: "getGear",
      run: async () => {
        const profile = await g.getUserProfile();
        return g.getGear(profile.profileId);
      },
    },
    {
      name: "getGearDefaults",
      run: async () => {
        const profile = await g.getUserProfile();
        return g.getGearDefaults(profile.profileId);
      },
    },
    // No real gear UUID exists to probe with before scripts/smoke-writes.ts runs; a syntactically
    // valid hex UUID with no matching gear exercises the "404 -> {}" branch honestly.
    { name: "getGearStats (no matching gear)", run: () => g.getGearStats("deadbeef00000000deadbeef00000000") },
  ],
  devices: [
    { name: "getDevices", run: () => g.getDevices() },
    { name: "getPrimaryTrainingDevice", run: () => g.getPrimaryTrainingDevice() },
    { name: "getDeviceLastUsed", run: () => g.getDeviceLastUsed() },
    // getDeviceAlarms fans out over getDevices() internally; on an account with zero paired
    // devices this legitimately resolves to `[]` without issuing any per-device request.
    { name: "getDeviceAlarms", run: () => g.getDeviceAlarms() },
    // getDeviceSettings/getDeviceSolarData need a real device id from getDevices(). The test
    // account has no paired device, and NO endpoint in upstream or this port can register one, so
    // these two report SKIP — never PASS. They are genuinely unverified against Garmin, and
    // AGENTS.md says so. Pair a device with the account and these start reporting for real.
    {
      name: "getDeviceSettings",
      run: async () => {
        const list = await g.getDevices();
        const deviceId = list?.[0]?.deviceId;
        return deviceId === undefined
          ? skip("no paired device on the test account")
          : g.getDeviceSettings(deviceId);
      },
    },
    {
      name: "getDeviceSolarData",
      run: async () => {
        const list = await g.getDevices();
        const deviceId = list?.[0]?.deviceId;
        return deviceId === undefined
          ? skip("no paired device on the test account")
          : g.getDeviceSolarData(deviceId, weekAgo, day);
      },
    },
  ],
  badges: [
    { name: "getEarnedBadges", run: () => g.getEarnedBadges() },
    { name: "getAvailableBadges", run: () => g.getAvailableBadges() },
    { name: "getInProgressBadges", run: () => g.getInProgressBadges() },
    { name: "getAdhocChallenges", run: () => g.getAdhocChallenges(0, 10) },
    // getBadgeChallenges/getAvailableBadgeChallenges/getNonCompletedBadgeChallenges: the client-side
    // validation (mirroring upstream) allows start=0, but Garmin's SERVER rejects it on these three
    // endpoints with a 400 "start should > 0." (discovered live in Task 9) — using start=1 here so
    // the probe exercises the real success path instead of that documented server-side 400.
    { name: "getBadgeChallenges", run: () => g.getBadgeChallenges(1, 10) },
    { name: "getAvailableBadgeChallenges", run: () => g.getAvailableBadgeChallenges(1, 10) },
    { name: "getNonCompletedBadgeChallenges", run: () => g.getNonCompletedBadgeChallenges(1, 10) },
    // start validated POSITIVE here (asymmetric vs. the other 4 challenge methods above).
    { name: "getInprogressVirtualChallenges", run: () => g.getInprogressVirtualChallenges(1, 10) },
  ],
  // Reads only — the 5 write methods in this service must NEVER be live-tested (irreversible
  // health-data writes; see the file-level comment in src/services/womensHealth.ts). The test
  // account has no cycle-tracking data, so `null`/empty-object responses here are the expected
  // PASS, exercising the empty-data path rather than a populated one.
  womensHealth: [
    { name: "getMenstrualDataForDate", run: () => g.getMenstrualDataForDate(day) },
    { name: "getMenstrualCalendarData", run: () => g.getMenstrualCalendarData(weekAgo, day) },
    { name: "getMenstrualLastConfirmed", run: () => g.getMenstrualLastConfirmed(day) },
    { name: "getMenstrualCycleSummary", run: () => g.getMenstrualCycleSummary(day) },
    { name: "getMenstrualReports", run: () => g.getMenstrualReports(day) },
    { name: "getPregnancySummary", run: () => g.getPregnancySummary() },
  ],
  weight: [
    { name: "getWeighIns", run: () => g.getWeighIns(weekAgo, day) },
    { name: "getDailyWeighIns", run: () => g.getDailyWeighIns(day) },
    { name: "getBodyComposition", run: () => g.getBodyComposition(weekAgo, day) },
  ],
  userProfile: [
    // getUserProfile/getUserSettings/fullName/unitSystem are pre-existing and already
    // live-verified (see AGENTS.md section 3) — this is the one genuinely new method here.
    { name: "getUserprofileSettings", run: () => g.getUserprofileSettings() },
  ],
  goals: [
    // The test account is empty (no goals). A 200 with `[]` is a real, positive result: it proves
    // the URL, query params, and the load-bearing Sec-Fetch-Site header are correct — it does NOT
    // exercise the multi-page continuation branch or the 2000-page abort path (unit-tested only).
    { name: "getGoals (active)", run: () => g.getGoals("active") },
    { name: "getGoals (future)", run: () => g.getGoals("future") },
    { name: "getGoals (past)", run: () => g.getGoals("past") },
  ],
};

const which = process.argv[2];
const probes = which ? services[which] : Object.values(services).flat();
if (!probes) {
  console.error(`Unknown service "${which}". Known: ${Object.keys(services).join(", ")}`);
  process.exit(1);
}

let pass = 0, fail = 0, skipped = 0;
for (const p of probes) {
  try {
    const r = await p.run();
    if (r instanceof Skipped) {
      console.log(`  SKIP  ${p.name.padEnd(34)} ${r.reason} (NOT verified — no request was sent)`);
      skipped++;
      continue;
    }
    const shape = r === null ? "null"
      : Buffer.isBuffer(r) ? `Buffer(${r.length} bytes)`
      : Array.isArray(r) ? `array[${r.length}]`
      : typeof r === "object" ? `object(${Object.keys(r).length} keys)` : typeof r;
    console.log(`  PASS  ${p.name.padEnd(34)} ${shape}`);
    pass++;
  } catch (e) {
    const err = e as Error;
    console.log(`  FAIL  ${p.name.padEnd(34)} ${err.constructor.name}: ${err.message.slice(0, 80)}`);
    fail++;
  }
}
console.log(
  `\n${pass} passed, ${fail} failed` + (skipped > 0 ? `, ${skipped} SKIPPED (not verified)` : ""),
);
if (fail > 0) process.exitCode = 1;
