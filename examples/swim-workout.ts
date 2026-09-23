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
 * This is written the long way on purpose — it is exactly the JSON Garmin's own
 * designer posts, so you can see the real shape. The helpers at the top are
 * ordinary local functions; nothing here is special to this library.
 */
import {
  GarminClient,
  Garmin,
  FileTokenStore,
  WORKOUT_SPORT_TYPE_ID as SPORT,
  WORKOUT_STEP_TYPE_ID as STEP,
  WORKOUT_CONDITION_TYPE_ID as WHEN,
  WORKOUT_TARGET_TYPE_ID as TARGET,
  WORKOUT_STROKE_TYPE_ID as STROKE,
  WORKOUT_DRILL_TYPE_ID as DRILL,
  WORKOUT_EQUIPMENT_TYPE_ID as GEAR,
  type WorkoutInput,
  type ExecutableWorkoutStep,
  type RepeatWorkoutGroup,
} from "../src/index.js";

// --- small local helpers, so the workout itself reads like a swim set -------
// `stepOrder` is GLOBAL across the whole workout, including inside repeats, so
// a single counter hands out the numbers.
let order = 0;
const next = () => ++order;

const swim = (opts: {
  type: number;
  typeKey: string;
  metres: number;
  stroke?: number;
  strokeKey?: string;
  drill?: number;
  drillKey?: string;
  equipment?: number;
  equipmentKey?: string;
}): ExecutableWorkoutStep => ({
  type: "ExecutableStepDTO",
  stepOrder: next(),
  stepType: { stepTypeId: opts.type, stepTypeKey: opts.typeKey, displayOrder: opts.type },
  endCondition: { conditionTypeId: WHEN.DISTANCE, conditionTypeKey: "distance", displayOrder: 3 },
  endConditionValue: opts.metres,
  targetType: { workoutTargetTypeId: TARGET.NO_TARGET, workoutTargetTypeKey: "no.target", displayOrder: 1 },
  ...(opts.stroke !== undefined && {
    strokeType: { strokeTypeId: opts.stroke, strokeTypeKey: opts.strokeKey, displayOrder: opts.stroke },
  }),
  ...(opts.drill !== undefined && {
    drillType: { drillTypeId: opts.drill, drillTypeKey: opts.drillKey, displayOrder: opts.drill },
  }),
  ...(opts.equipment !== undefined && {
    equipmentType: {
      equipmentTypeId: opts.equipment,
      equipmentTypeKey: opts.equipmentKey,
      displayOrder: opts.equipment,
    },
  }),
});

/** A rest measured in seconds — `fixed.rest`, not `time`. */
const rest = (seconds: number): ExecutableWorkoutStep => ({
  type: "ExecutableStepDTO",
  stepOrder: next(),
  stepType: { stepTypeId: STEP.REST, stepTypeKey: "rest", displayOrder: 5 },
  endCondition: { conditionTypeId: WHEN.FIXED_REST, conditionTypeKey: "fixed.rest", displayOrder: 8 },
  endConditionValue: seconds,
  targetType: { workoutTargetTypeId: TARGET.NO_TARGET, workoutTargetTypeKey: "no.target", displayOrder: 1 },
});

/** A rest you end yourself, on the lap button. */
const lapRest = (): ExecutableWorkoutStep => ({
  type: "ExecutableStepDTO",
  stepOrder: next(),
  stepType: { stepTypeId: STEP.REST, stepTypeKey: "rest", displayOrder: 5 },
  endCondition: { conditionTypeId: WHEN.LAP_BUTTON, conditionTypeKey: "lap.button", displayOrder: 1 },
  targetType: { workoutTargetTypeId: TARGET.NO_TARGET, workoutTargetTypeKey: "no.target", displayOrder: 1 },
});

/**
 * `times(n, ...)` takes its own stepOrder FIRST, before its children — that is
 * the order Garmin's designer emits and the numbering it expects.
 */
const times = (n: number, build: () => ExecutableWorkoutStep[]): RepeatWorkoutGroup => {
  const stepOrder = next();
  return {
    type: "RepeatGroupDTO",
    stepOrder,
    stepType: { stepTypeId: STEP.REPEAT, stepTypeKey: "repeat", displayOrder: 6 },
    numberOfIterations: n,
    smartRepeat: false,
    endCondition: { conditionTypeId: WHEN.ITERATIONS, conditionTypeKey: "iterations", displayOrder: 7 },
    workoutSteps: build(),
  };
};

// --- the workout -----------------------------------------------------------
const workout: WorkoutInput = {
  workoutName: "Threshold 100s",
  sportType: { sportTypeId: SPORT.SWIMMING, sportTypeKey: "swimming", displayOrder: 3 },
  estimatedDurationInSecs: 2400,
  // Pool length is a property of the WORKOUT, not of a step.
  poolLength: 25,
  poolLengthUnit: { unitId: 1, unitKey: "meter", factor: 100 },
  workoutSegments: [
    {
      segmentOrder: 1,
      sportType: { sportTypeId: SPORT.SWIMMING, sportTypeKey: "swimming", displayOrder: 3 },
      workoutSteps: [
        swim({ type: STEP.WARMUP, typeKey: "warmup", metres: 400, stroke: STROKE.FREE, strokeKey: "free" }),
        lapRest(),
        times(8, () => [
          swim({
            type: STEP.INTERVAL,
            typeKey: "interval",
            metres: 100,
            stroke: STROKE.FREE,
            strokeKey: "free",
            drill: DRILL.KICK,
            drillKey: "kick",
          }),
          rest(15),
        ]),
        times(4, () => [
          swim({
            type: STEP.INTERVAL,
            typeKey: "interval",
            metres: 50,
            stroke: STROKE.FLY,
            strokeKey: "fly",
            equipment: GEAR.PADDLES,
            equipmentKey: "paddles",
          }),
          rest(20),
        ]),
        swim({
          type: STEP.COOLDOWN,
          typeKey: "cooldown",
          metres: 200,
          stroke: STROKE.ANY_STROKE,
          strokeKey: "any_stroke",
        }),
      ],
    },
  ],
};

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
