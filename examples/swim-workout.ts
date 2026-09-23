/**
 * Creating a complex pool-swim workout.
 *
 *   npx tsx examples/swim-workout.ts
 *
 * The workout built here:
 *
 *   Warm up          400 m  freestyle
 *   Rest             lap button
 *   8 x              100 m  freestyle, KICK drill        + 15 s fixed rest
 *   4 x               50 m  butterfly, with paddles      + 20 s fixed rest
 *   Cool down        200 m  any stroke
 *
 * `buildWorkout` is a convenience layer, not a replacement: `uploadWorkout` still takes raw JSON,
 * and `build()` returns exactly the JSON you would otherwise write by hand. The builder exists
 * because that JSON has four traps — a global stepOrder that runs through repeat children,
 * id/key/displayOrder triples that must agree, `fixed.rest` vs `time`, and pace targets being
 * descending metres-per-second speeds. See src/workout-builder.ts.
 */
import { GarminClient, Garmin, FileTokenStore, buildWorkout } from "../src/index.js";

const workout = buildWorkout("Threshold 100s", { sport: "swimming", poolLength: 25 })
  .warmup({ distance: 400, stroke: "free" })
  .rest({ lapButton: true })
  .repeat(8, (set) => set.interval({ distance: 100, stroke: "free", drill: "kick" }).rest(15))
  .repeat(4, (set) => set.interval({ distance: 50, stroke: "fly", equipment: "paddles" }).rest(20))
  .cooldown({ distance: 200, stroke: "any_stroke" })
  .build();

// --- send it ---------------------------------------------------------------
const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
if (!(await client.loadTokens())) {
  console.error("No tokens. Run `npm run login` first.");
  process.exit(1);
}
const garmin = new Garmin(client);

const created = await garmin.uploadWorkout(workout);
console.log(`Created workout ${String(created?.workoutId)} — "${String(created?.workoutName)}"`);

// Read it back so you can see what Garmin actually stored.
const stored = (await garmin.getWorkoutById(created!.workoutId!)) as Record<string, unknown>;
const segment = (stored["workoutSegments"] as Record<string, unknown>[])[0]!;
const key = (o: unknown, f: string): unknown => (o as Record<string, unknown> | null)?.[f];
/** Payload fields are `unknown` and may be null — narrow before printing. */
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): string => (typeof v === "number" ? String(v) : "");

const describe = (steps: Record<string, unknown>[], indent = ""): void => {
  for (const s of steps) {
    if (s["type"] === "RepeatGroupDTO") {
      console.log(`${indent}${num(s["numberOfIterations"])} x`);
      describe(s["workoutSteps"] as Record<string, unknown>[], `${indent}   `);
      continue;
    }
    const bits = [
      str(key(s["stepType"], "stepTypeKey")).padEnd(9),
      `${num(s["endConditionValue"])} ${str(key(s["endCondition"], "conditionTypeKey"))}`.padEnd(22),
      str(key(s["strokeType"], "strokeTypeKey")) && `stroke=${str(key(s["strokeType"], "strokeTypeKey"))}`,
      str(key(s["drillType"], "drillTypeKey")) && `drill=${str(key(s["drillType"], "drillTypeKey"))}`,
      str(key(s["equipmentType"], "equipmentTypeKey")) &&
        `equip=${str(key(s["equipmentType"], "equipmentTypeKey"))}`,
    ];
    console.log(indent + bits.filter(Boolean).join(" ").trimEnd());
  }
};

console.log(`\nStored by Garmin (pool ${num(stored["poolLength"])} ${str(key(stored["poolLengthUnit"], "unitKey"))}):`);
describe(segment["workoutSteps"] as Record<string, unknown>[]);

// Comment this out if you want to keep the workout.
await garmin.deleteWorkout(created!.workoutId!);
console.log("\n(deleted again — remove the deleteWorkout call to keep it)");
