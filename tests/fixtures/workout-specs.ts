/**
 * Spec/builder pairs: each spec must produce EXACTLY what the equivalent builder chain produces.
 * Together they cover every builder feature `examples/workout-gallery.ts` uses — every step type,
 * every end condition, every target, swim fields, exercises, weight, notes, both repeat kinds
 * (nested), and multi-sport legs. Shared by the spec-vs-builder equivalence tests and the JSON Schema tests.
 */
import { buildWorkout } from "../../src/workout-builder.js";
import type { WorkoutInput } from "../../src/types/workouts.js";
import type { WorkoutSpec } from "../../src/workout-spec.js";

export interface SpecFixture {
  spec: WorkoutSpec;
  builder: () => WorkoutInput;
}

export const SPEC_FIXTURES: Record<string, SpecFixture> = {
  runningPaceRepeat: {
    spec: {
      name: "6x400",
      sport: "running",
      steps: [
        { type: "warmup", lapButton: true },
        {
          type: "repeat",
          times: 6,
          steps: [
            { type: "interval", distance: 400, target: { pace: { minPerKm: [4, 4.2] } } },
            { type: "recovery", time: 120 },
          ],
        },
        { type: "cooldown", time: 600 },
      ],
    },
    builder: () =>
      buildWorkout("6x400", { sport: "running" })
        .warmup({ lapButton: true })
        .repeat(6, (r) =>
          r.interval({ distance: 400, target: { pace: { minPerKm: [4, 4.2] } } }).recovery({ time: 120 }),
        )
        .cooldown({ time: 600 })
        .build(),
  },
  swimSet: {
    spec: {
      name: "Swim",
      sport: "swimming",
      poolLength: 25,
      steps: [
        { type: "warmup", distance: 400, stroke: "free" },
        { type: "rest", lapButton: true },
        {
          type: "repeat",
          times: 8,
          steps: [
            {
              type: "interval",
              distance: 100,
              stroke: "free",
              drill: "kick",
              equipment: "kickboard",
              target: { swimCssOffsetSeconds: -2 },
            },
            { type: "rest", restSeconds: 15 },
          ],
        },
        { type: "cooldown", fixedRepetition: 4, stroke: "any_stroke", notes: "easy" },
      ],
    },
    builder: () =>
      buildWorkout("Swim", { sport: "swimming", poolLength: 25 })
        .warmup({ distance: 400, stroke: "free" })
        .rest({ lapButton: true })
        .repeat(8, (r) =>
          r
            .interval({
              distance: 100,
              stroke: "free",
              drill: "kick",
              equipment: "kickboard",
              target: { swimCssOffsetSeconds: -2 },
            })
            .rest(15),
        )
        .cooldown({ fixedRepetition: 4, stroke: "any_stroke", notes: "easy" })
        .build(),
  },
  strength: {
    spec: {
      name: "Legs",
      sport: "strength_training",
      steps: [
        { type: "warmup", time: 300 },
        {
          type: "repeat",
          times: 3,
          steps: [
            {
              type: "interval",
              reps: 8,
              exercise: { category: "SQUAT", name: "BARBELL_BACK_SQUAT" },
              weightKg: 60,
            },
            { type: "rest", restSeconds: 90 },
          ],
        },
        { type: "interval", reps: 12, exercise: { category: "PLANK" } },
      ],
    },
    builder: () =>
      buildWorkout("Legs", { sport: "strength_training" })
        .warmup({ time: 300 })
        .repeat(3, (r) =>
          r
            .interval({ reps: 8, exercise: { category: "SQUAT", name: "BARBELL_BACK_SQUAT" }, weightKg: 60 })
            .rest(90),
        )
        .interval({ reps: 12, exercise: { category: "PLANK" } })
        .build(),
  },
  hiitNestedRepeats: {
    spec: {
      name: "AMRAP",
      sport: "hiit",
      steps: [
        {
          type: "repeatForSeconds",
          seconds: 600,
          steps: [
            {
              type: "repeat",
              times: 2,
              steps: [
                { type: "interval", reps: 10, exercise: { category: "PUSH_UP" } },
                { type: "interval", time: 30 },
              ],
            },
            { type: "rest", restSeconds: 20 },
          ],
        },
      ],
    },
    builder: () =>
      buildWorkout("AMRAP", { sport: "hiit" })
        .repeatForSeconds(600, (b) =>
          b
            .repeat(2, (r) => r.interval({ reps: 10, exercise: { category: "PUSH_UP" } }).interval({ time: 30 }))
            .rest(20),
        )
        .build(),
  },
  cyclingTargets: {
    spec: {
      name: "Sweet spot",
      sport: "cycling",
      steps: [
        { type: "interval", time: 1200, target: { powerZone: 3 }, secondaryTarget: { cadence: [85, 95] } },
        { type: "main", calories: 300, target: { powerWatts: [200, 240] } },
        { type: "other", powerWatts: 300 },
        { type: "recovery", heartRateBpm: 110, target: { heartRateZone: 1 } },
        { type: "interval", time: 60, target: { resistance: [4, 6] } },
      ],
    },
    builder: () =>
      buildWorkout("Sweet spot", { sport: "cycling" })
        .interval({ time: 1200, target: { powerZone: 3 }, secondaryTarget: { cadence: [85, 95] } })
        .main({ calories: 300, target: { powerWatts: [200, 240] } })
        .other({ powerWatts: 300 })
        .recovery({ heartRateBpm: 110, target: { heartRateZone: 1 } })
        .interval({ time: 60, target: { resistance: [4, 6] } })
        .build(),
  },
  treadmillTargets: {
    spec: {
      name: "Treadmill",
      sport: "running",
      estimatedDurationInSecs: 1800,
      steps: [
        { type: "interval", time: 300, target: { gradePercent: [2, 5] } },
        { type: "interval", distance: 1000, target: { speedMetresPerSecond: [3, 3.5] } },
        { type: "interval", time: 60, target: { heartRateBpm: [140, 150] } },
        { type: "interval", distance: 1609, target: { pace: { minPerMile: [8.5, 9.5] } } },
      ],
    },
    builder: () =>
      buildWorkout("Treadmill", { sport: "running", estimatedDurationInSecs: 1800 })
        .interval({ time: 300, target: { gradePercent: [2, 5] } })
        .interval({ distance: 1000, target: { speedMetresPerSecond: [3, 3.5] } })
        .interval({ time: 60, target: { heartRateBpm: [140, 150] } })
        .interval({ distance: 1609, target: { pace: { minPerMile: [8.5, 9.5] } } })
        .build(),
  },
  brick: {
    spec: {
      name: "Brick",
      sport: "multi_sport",
      sessionTransitionsEnabled: true,
      legs: [
        { sport: "cycling", steps: [{ type: "interval", time: 1800 }] },
        { sport: "running", steps: [{ type: "interval", distance: 5000 }] },
      ],
    },
    builder: () =>
      buildWorkout("Brick", { sport: "multi_sport", sessionTransitionsEnabled: true })
        .leg("cycling", (l) => l.interval({ time: 1800 }))
        .leg("running", (l) => l.interval({ distance: 5000 }))
        .build(),
  },
};
