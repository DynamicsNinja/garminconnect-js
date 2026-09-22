import "./load-env.js";
import { GarminClient, Garmin, FileTokenStore } from "../src/index.js";

type Probe = { name: string; run: () => Promise<unknown> };

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
  ],
};

const which = process.argv[2];
const probes = which ? services[which] : Object.values(services).flat();
if (!probes) {
  console.error(`Unknown service "${which}". Known: ${Object.keys(services).join(", ")}`);
  process.exit(1);
}

let pass = 0, fail = 0;
for (const p of probes) {
  try {
    const r = await p.run();
    const shape = r === null ? "null" : Array.isArray(r) ? `array[${r.length}]`
      : typeof r === "object" ? `object(${Object.keys(r).length} keys)` : typeof r;
    console.log(`  PASS  ${p.name.padEnd(34)} ${shape}`);
    pass++;
  } catch (e) {
    const err = e as Error;
    console.log(`  FAIL  ${p.name.padEnd(34)} ${err.constructor.name}: ${err.message.slice(0, 80)}`);
    fail++;
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
