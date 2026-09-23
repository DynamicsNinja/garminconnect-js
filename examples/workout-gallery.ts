/**
 * Every worked example from WORKOUTS.md, in compilable form.
 *
 *   npx tsx examples/workout-gallery.ts     # prints a summary of each; sends nothing
 *
 * This file exists so the documentation cannot rot: `examples/` is inside `tsconfig.json`'s
 * `include`, so `npm run typecheck` compiles all of it. If a builder signature changes and
 * WORKOUTS.md is not updated, this breaks the build.
 *
 * Nothing here talks to Garmin — each example only calls `.build()`. To actually send one, pass it
 * to `garmin.uploadWorkout(...)`; `scripts/smoke-builder.ts` does exactly that against the test
 * account for all twelve sports.
 */
import { buildWorkout } from "../src/index.js";
import type { WorkoutInput } from "../src/index.js";

/** Running intervals with a secondary cadence target. */
const runningIntervals = (): WorkoutInput =>
  buildWorkout("4 x 1 km", { sport: "running" })
    .warmup({ time: 600, target: { heartRateZone: 2 }, notes: "easy" })
    .repeat(4, (set) =>
      set
        .interval({
          distance: 1000,
          target: { pace: { minPerKm: [4.5, 5] } },
          secondaryTarget: { cadence: [176, 184] },
        })
        .recovery({ time: 120, target: { heartRateBpm: [120, 140] } }),
    )
    .cooldown({ lapButton: true })
    .build();

/** Cycling: power zones plus a cadence floor, and an explicit watt range on the recoveries. */
const cyclingSweetSpot = (): WorkoutInput =>
  buildWorkout("Sweet spot", { sport: "cycling" })
    .warmup({ time: 600, target: { resistance: [2, 4] } })
    .repeat(3, (set) =>
      set
        .interval({ time: 480, target: { powerZone: 3 }, secondaryTarget: { cadence: [85, 95] } })
        .recovery({ time: 240, target: { powerWatts: [120, 160] } }),
    )
    .cooldown({ time: 300 })
    .build();

/** A full swim set: strokes, drills, equipment, CSS offset and pool-length reps. */
const swimMixedSet = (): WorkoutInput =>
  buildWorkout("Mixed set", { sport: "swimming", poolLength: 25 })
    .warmup({ distance: 400, stroke: "free", notes: "build" })
    .rest({ lapButton: true })
    .repeat(8, (set) =>
      set
        .interval({
          distance: 100,
          stroke: "free",
          drill: "kick",
          target: { swimCssOffsetSeconds: 5 },
        })
        .rest(15),
    )
    .repeat(4, (set) => set.interval({ distance: 50, stroke: "fly", equipment: "paddles" }).rest(20))
    .repeat(2, (set) =>
      set.interval({ fixedRepetition: 4, stroke: "individual_medley", equipment: "fins" }).rest(30),
    )
    .interval({ distance: 200, stroke: "backstroke", drill: "pull", equipment: "pull_buoy" })
    .cooldown({ distance: 200, stroke: "any_stroke" })
    .build();

/** Strength with nested sets and a category-only exercise. */
const strengthLowerBody = (): WorkoutInput =>
  buildWorkout("Lower body", { sport: "strength_training" })
    .warmup({ time: 300, exercise: { category: "CARDIO", name: "CARDIO" } })
    .repeat(3, (set) =>
      set
        .interval({
          reps: 8,
          exercise: { category: "SQUAT", name: "BARBELL_BACK_SQUAT" },
          weightKg: 60,
        })
        .rest(90),
    )
    .repeat(4, (set) =>
      set
        .interval({
          reps: 10,
          exercise: { category: "BENCH_PRESS", name: "BARBELL_BENCH_PRESS" },
          weightKg: 40,
        })
        .interval({ reps: 12, exercise: { category: "ROW", name: "BARBELL_ROW" }, weightKg: 35 })
        .rest(120),
    )
    .interval({ reps: 20, exercise: { category: "PLANK" } })
    .cooldown({ lapButton: true })
    .build();

/** A time-boxed HIIT block with a count-based repeat nested inside it. */
const hiitAmrap = (): WorkoutInput =>
  buildWorkout("10 minute AMRAP", { sport: "hiit" })
    .warmup({ lapButton: true })
    .repeatForSeconds(600, (set) =>
      set
        .interval({ reps: 10, exercise: { category: "PUSH_UP" } })
        .repeat(2, (inner) =>
          inner.interval({ time: 30, exercise: { category: "PLANK" } }).rest(15),
        )
        .rest(30),
    )
    .cooldown({ lapButton: true })
    .build();

/** A three-leg brick. Each leg becomes its own segment with its own sport. */
const brick = (): WorkoutInput =>
  buildWorkout("Brick", { sport: "multi_sport", sessionTransitionsEnabled: true })
    .leg("swimming", (l) => l.warmup({ distance: 400, stroke: "free" }))
    .leg("cycling", (l) =>
      l.repeat(3, (r) =>
        r.interval({ time: 480, target: { powerZone: 2 } }).recovery({ time: 120 }),
      ),
    )
    .leg("running", (l) =>
      l.interval({ distance: 5000, target: { pace: { minPerKm: [5, 5.5] } } }),
    )
    .build();

/** The remaining end conditions, which have no natural home in the sport examples above. */
const endConditionSampler = (): WorkoutInput =>
  buildWorkout("End conditions", { sport: "other" })
    .interval({ distance: 1000 })
    .interval({ time: 300 })
    .interval({ reps: 12 })
    .interval({ lapButton: true })
    .rest({ restSeconds: 45 })
    .interval({ calories: 200 })
    .interval({ heartRateBpm: 160 })
    .interval({ powerWatts: 250 })
    .interval({ fixedRepetition: 4 })
    .build();

const gallery: [string, () => WorkoutInput][] = [
  ["running intervals", runningIntervals],
  ["cycling sweet spot", cyclingSweetSpot],
  ["swim mixed set", swimMixedSet],
  ["strength lower body", strengthLowerBody],
  ["hiit amrap", hiitAmrap],
  ["brick", brick],
  ["end-condition sampler", endConditionSampler],
];

for (const [label, make] of gallery) {
  const w = make();
  const count = (steps: { type?: string; workoutSteps?: unknown[] }[]): number =>
    steps.reduce(
      (n, s) =>
        n + 1 + (s.type === "RepeatGroupDTO" ? count(s.workoutSteps as typeof steps) : 0),
      0,
    );
  const steps = w.workoutSegments.reduce((n, seg) => n + count(seg.workoutSteps), 0);
  console.log(
    `${label.padEnd(22)} sport=${String(w.sportType?.sportTypeKey).padEnd(18)} ` +
      `segments=${w.workoutSegments.length} steps=${steps}`,
  );
}
