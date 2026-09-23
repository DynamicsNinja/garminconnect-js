/**
 * Builds one workout per sport with `buildWorkout`, uploads it, READS IT BACK, asserts what Garmin
 * actually stored, then deletes it.
 *
 *   npx tsx scripts/smoke-builder.ts
 *
 * A workout POST returning 2xx proves nothing — that is how `uploadWalkingWorkout` shipped marked
 * "verified" while storing a null sport. Every probe here therefore checks the STORED document:
 * the sport key, that every stepOrder in the tree is globally unique, and at least one field that
 * is specific to the thing being tested (a pace target's m/s pair, a swim drill, a rep weight, a
 * null `numberOfIterations` on a time-based repeat, two segments on a brick).
 */
import "./load-env.js";
import { GarminClient, Garmin, FileTokenStore, GarminHttpError, buildWorkout } from "../src/index.js";

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
if (!(await client.loadTokens())) {
  console.error("No tokens. Run `npm run login` first.");
  process.exit(1);
}
const g = new Garmin(client);

// SAFETY GATE — identical to every other write script here. Not conditional, not skippable.
const expected = process.env["GARMIN_TEST_PROFILE_ID"];
if (!expected) {
  console.error("Refusing to run: GARMIN_TEST_PROFILE_ID is not set. Nothing was written.");
  process.exit(1);
}
const profile = await g.getUserProfile();
if (String(profile.profileId) !== String(expected)) {
  console.error(
    "Refusing to run: live profile does not match the expected test account.\n" +
      `  expected ${expected}, found ${String(profile.profileId)} ` +
      `(userName: ${profile.userName.slice(0, 2)}***@***)\nNothing was written.`,
  );
  process.exit(1);
}
console.log(`Safety gate passed: ${String(profile.profileId)}\n`);

type Doc = Record<string, unknown>;
const field = (o: unknown, f: string): unknown => (o as Doc | null)?.[f];

/** Every stepOrder in the stored document, depth-first across all segments. */
function storedOrders(doc: Doc): number[] {
  const out: number[] = [];
  const walk = (steps: Doc[]) => {
    for (const s of steps) {
      out.push(s["stepOrder"] as number);
      if (s["type"] === "RepeatGroupDTO") walk(s["workoutSteps"] as Doc[]);
    }
  };
  for (const seg of doc["workoutSegments"] as Doc[]) walk(seg["workoutSteps"] as Doc[]);
  return out;
}

/** First executable step anywhere in the tree that satisfies `pick`. */
function findStep(doc: Doc, pick: (s: Doc) => boolean): Doc | undefined {
  const search = (steps: Doc[]): Doc | undefined => {
    for (const s of steps) {
      if (s["type"] === "RepeatGroupDTO") {
        const hit = search(s["workoutSteps"] as Doc[]);
        if (hit) return hit;
        continue;
      }
      if (pick(s)) return s;
    }
    return undefined;
  };
  for (const seg of doc["workoutSegments"] as Doc[]) {
    const hit = search(seg["workoutSteps"] as Doc[]);
    if (hit) return hit;
  }
  return undefined;
}

let pass = 0;
let fail = 0;

async function probe(
  label: string,
  sportKey: string,
  make: () => ReturnType<typeof buildWorkout>["build"] extends () => infer R ? R : never,
  check: (stored: Doc) => string | null,
): Promise<void> {
  let workoutId: number | undefined;
  try {
    const created = await g.uploadWorkout(make());
    workoutId = created?.workoutId;
    if (workoutId === undefined) {
      fail++;
      console.log(`  FAIL  ${label.padEnd(16)} upload returned no workoutId`);
      return;
    }
    const stored = (await g.getWorkoutById(workoutId)) as Doc;

    const storedSport = field(stored["sportType"], "sportTypeKey");
    if (storedSport !== sportKey) {
      fail++;
      console.log(`  FAIL  ${label.padEnd(16)} stored sport is ${JSON.stringify(storedSport)}, expected "${sportKey}"`);
      return;
    }
    const orders = storedOrders(stored);
    if (new Set(orders).size !== orders.length) {
      fail++;
      console.log(`  FAIL  ${label.padEnd(16)} duplicate stepOrders: [${orders.join(",")}]`);
      return;
    }
    const problem = check(stored);
    if (problem) {
      fail++;
      console.log(`  FAIL  ${label.padEnd(16)} ${problem}`);
      return;
    }
    pass++;
    console.log(`  PASS  ${label.padEnd(16)} sport=${sportKey} steps=[${orders.join(",")}]`);
  } catch (e) {
    fail++;
    const msg =
      e instanceof GarminHttpError
        ? `HTTP ${e.status} ${e.body.slice(0, 140)}`
        : `${(e as Error).constructor.name}: ${(e as Error).message.slice(0, 140)}`;
    console.log(`  FAIL  ${label.padEnd(16)} ${msg}`);
  } finally {
    if (workoutId !== undefined) {
      try {
        await g.deleteWorkout(workoutId);
      } catch {
        console.log(`  WARN  ${label.padEnd(16)} could not delete workout ${String(workoutId)}`);
      }
    }
  }
}

const near = (a: unknown, b: number, tol = 0.01) => typeof a === "number" && Math.abs(a - b) < tol;

// --- running: a pace target, which is the conversion most likely to be wrong ----------------
await probe(
  "running",
  "running",
  () =>
    buildWorkout("[builder] run", { sport: "running" })
      .warmup({ lapButton: true })
      .repeat(4, (r) =>
        r.interval({ distance: 1000, target: { pace: { minPerKm: [4.5, 5] } } }).recovery({ time: 120 }),
      )
      .cooldown({ lapButton: true })
      .build(),
  (doc) => {
    const step = findStep(doc, (s) => field(s["targetType"], "workoutTargetTypeKey") === "pace.zone");
    if (!step) return "no pace.zone step stored";
    // 4:30/km = 3.7037 m/s (faster, so first); 5:00/km = 3.3333 m/s.
    if (!near(step["targetValueOne"], 1000 / (4.5 * 60))) return `targetValueOne = ${String(step["targetValueOne"])}`;
    if (!near(step["targetValueTwo"], 1000 / (5 * 60))) return `targetValueTwo = ${String(step["targetValueTwo"])}`;
    if ((step["targetValueOne"] as number) <= (step["targetValueTwo"] as number)) {
      return "pace bounds are not descending (faster must be first)";
    }
    return null;
  },
);

// --- cycling: a zone target, which stores zoneNumber rather than value pairs -----------------
await probe(
  "cycling",
  "cycling",
  () =>
    buildWorkout("[builder] bike", { sport: "cycling" })
      .warmup({ time: 600 })
      .repeat(3, (r) => r.interval({ time: 480, target: { powerZone: 3 } }).recovery({ time: 240 }))
      .cooldown({ time: 300 })
      .build(),
  (doc) => {
    const step = findStep(doc, (s) => field(s["targetType"], "workoutTargetTypeKey") === "power.zone");
    if (!step) return "no power.zone step stored";
    if (step["zoneNumber"] !== 3) return `zoneNumber = ${String(step["zoneNumber"])}, expected 3`;
    return null;
  },
);

// --- swimming: pool length on the workout, stroke/drill/equipment on the step ----------------
await probe(
  "swimming",
  "swimming",
  () =>
    buildWorkout("[builder] swim", { sport: "swimming", poolLength: 25 })
      .warmup({ distance: 400, stroke: "free" })
      .rest({ lapButton: true })
      .repeat(8, (r) => r.interval({ distance: 100, stroke: "free", drill: "kick" }).rest(15))
      .repeat(4, (r) => r.interval({ distance: 50, stroke: "fly", equipment: "paddles" }).rest(20))
      .cooldown({ distance: 200, stroke: "any_stroke" })
      .build(),
  (doc) => {
    if (doc["poolLength"] !== 25) return `poolLength = ${String(doc["poolLength"])}`;
    const drill = findStep(doc, (s) => field(s["drillType"], "drillTypeKey") === "kick");
    if (!drill) return "no kick-drill step stored";
    const paddles = findStep(doc, (s) => field(s["equipmentType"], "equipmentTypeKey") === "paddles");
    if (!paddles) return "no paddles step stored";
    const fixedRest = findStep(doc, (s) => field(s["endCondition"], "conditionTypeKey") === "fixed.rest");
    if (!fixedRest) return "no fixed.rest step stored (a numeric rest must not become `time`)";
    return null;
  },
);

// --- strength: exercise pair and weight ------------------------------------------------------
await probe(
  "strength",
  "strength_training",
  () =>
    buildWorkout("[builder] strength", { sport: "strength_training" })
      .warmup({ lapButton: true })
      .repeat(3, (r) =>
        r
          .interval({ reps: 8, exercise: { category: "SQUAT", name: "BARBELL_BACK_SQUAT" }, weightKg: 60 })
          .rest(90),
      )
      .cooldown({ lapButton: true })
      .build(),
  (doc) => {
    const lift = findStep(doc, (s) => s["category"] === "SQUAT");
    if (!lift) return "no SQUAT step stored";
    if (lift["exerciseName"] !== "BARBELL_BACK_SQUAT") return `exerciseName = ${String(lift["exerciseName"])}`;
    if (field(lift["endCondition"], "conditionTypeKey") !== "reps") return "end condition is not reps";
    // Garmin stores kg with visible round-trip drift, so compare loosely on purpose.
    if (!near(lift["weightValue"], 60, 0.5)) return `weightValue = ${String(lift["weightValue"])}`;
    return null;
  },
);

// --- multi-sport: one segment per leg, transitions flag ---------------------------------------
await probe(
  "multi-sport",
  "multi_sport",
  () =>
    buildWorkout("[builder] brick", { sport: "multi_sport", sessionTransitionsEnabled: true })
      .leg("cycling", (l) => l.warmup({ time: 300 }).interval({ time: 1800, target: { powerZone: 2 } }))
      .leg("running", (l) => l.interval({ distance: 5000 }).cooldown({ lapButton: true }))
      .build(),
  (doc) => {
    const segs = doc["workoutSegments"] as Doc[];
    if (segs.length !== 2) return `${segs.length} segments, expected 2`;
    const keys = segs.map((s) => field(s["sportType"], "sportTypeKey"));
    if (keys[0] !== "cycling" || keys[1] !== "running") return `legs are ${JSON.stringify(keys)}`;
    if (doc["isSessionTransitionEnabled"] !== true) return "transitions flag was not preserved";
    return null;
  },
);

// --- hiit: a TIME-based repeat, where numberOfIterations must be null -------------------------
await probe(
  "hiit",
  "hiit",
  () =>
    buildWorkout("[builder] hiit", { sport: "hiit" })
      .warmup({ lapButton: true })
      .repeatForSeconds(600, (r) =>
        r.interval({ reps: 10, exercise: { category: "PUSH_UP", name: "PUSH_UP" } }).rest(30),
      )
      .cooldown({ lapButton: true })
      .build(),
  (doc) => {
    const seg = (doc["workoutSegments"] as Doc[])[0]!;
    const rep = (seg["workoutSteps"] as Doc[]).find((s) => s["type"] === "RepeatGroupDTO");
    if (!rep) return "no repeat group stored";
    if (field(rep["endCondition"], "conditionTypeKey") !== "time") return "repeat is not time-based";
    if (rep["endConditionValue"] !== 600) return `repeat endConditionValue = ${String(rep["endConditionValue"])}`;
    if (rep["numberOfIterations"] !== null) {
      return `numberOfIterations = ${String(rep["numberOfIterations"])}, expected null`;
    }
    return null;
  },
);

// --- the remaining sports: exercised for acceptance and correct sport storage -----------------
for (const sport of ["cardio_training", "yoga", "pilates", "mobility", "rucking", "other"] as const) {
  await probe(
    sport,
    sport,
    () =>
      buildWorkout(`[builder] ${sport}`, { sport })
        .warmup({ lapButton: true })
        .repeat(2, (r) => r.interval({ time: 300 }).rest(60))
        .cooldown({ lapButton: true })
        .build(),
    () => null,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
