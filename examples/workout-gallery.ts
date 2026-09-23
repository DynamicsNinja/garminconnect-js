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
// The catalogue is a separate entry point (`garminconnect-js/exercises` once installed). Using
// `exercise()` instead of a bare string turns a wrong or mis-categorised exercise name into a
// compile error, rather than an upload Garmin accepts and stores with an empty `exerciseName`.
import { exercise } from "../src/exercises.js";

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
    .warmup({ time: 300, exercise: exercise("CARDIO", "JUMPING_JACKS") })
    .repeat(3, (set) =>
      set
        .interval({
          reps: 8,
          exercise: exercise("SQUAT", "BARBELL_BACK_SQUAT"),
          weightKg: 60,
        })
        .rest(90),
    )
    .repeat(4, (set) =>
      set
        .interval({
          reps: 10,
          exercise: exercise("BENCH_PRESS", "BARBELL_BENCH_PRESS"),
          weightKg: 40,
        })
        .interval({ reps: 12, exercise: exercise("ROW", "BARBELL_ROW"), weightKg: 35 })
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

/**
 * Cardio circuit: three rounds of four stations, each a different exercise, with a longer break
 * between rounds. Uses only categories Garmin accepts — see the note in WORKOUTS.md.
 */
const cardioCircuit = (): WorkoutInput =>
  buildWorkout("Circuit", { sport: "cardio_training" })
    .warmup({ time: 300, exercise: { category: "WARM_UP" } })
    .repeat(3, (round) =>
      round
        .interval({ time: 45, exercise: { category: "PUSH_UP" }, notes: "station 1" })
        .rest(15)
        .interval({ time: 45, exercise: { category: "SQUAT" }, notes: "station 2" })
        .rest(15)
        .interval({ time: 45, exercise: { category: "PLANK" }, notes: "station 3" })
        .rest(15)
        .interval({ time: 45, exercise: { category: "LUNGE" }, notes: "station 4" })
        .rest(60),
    )
    .cooldown({ time: 300, target: { heartRateZone: 1 } })
    .build();

/**
 * Yoga flow: timed holds, no exercise field. YOGA is NOT a valid exercise category — the sport is
 * yoga, but each step is simply a timed segment, with the pose named in `notes`.
 */
const yogaFlow = (): WorkoutInput =>
  buildWorkout("Morning flow", { sport: "yoga" })
    .warmup({ time: 180, notes: "child's pose, breathing" })
    .repeat(3, (round) =>
      round
        .interval({ time: 60, notes: "sun salutation A" })
        .interval({ time: 60, notes: "sun salutation B" })
        .rest(30),
    )
    .repeat(2, (side) =>
      side
        .interval({ time: 45, notes: "warrior II — hold" })
        .interval({ time: 45, notes: "triangle — hold" })
        .rest(20),
    )
    .cooldown({ time: 300, notes: "savasana" })
    .build();

/** Pilates: a mix of timed holds and rep-counted work, using real core categories. */
const pilatesSession = (): WorkoutInput =>
  buildWorkout("Mat pilates", { sport: "pilates" })
    .warmup({ time: 240, notes: "breathing and alignment" })
    .repeat(2, (set) =>
      set
        .interval({ reps: 20, exercise: { category: "CRUNCH" }, notes: "the hundred" })
        .interval({ time: 60, exercise: { category: "PLANK" } })
        .interval({ reps: 15, exercise: { category: "LEG_RAISE" }, notes: "single leg circles" })
        .rest(45),
    )
    .interval({ reps: 12, exercise: { category: "HIP_RAISE" }, notes: "shoulder bridge" })
    .cooldown({ time: 180, notes: "spine stretch" })
    .build();

/** Mobility: timed holds per side, using the STRETCH category. */
const mobilityRoutine = (): WorkoutInput =>
  buildWorkout("Hips and thoracic", { sport: "mobility" })
    .warmup({ time: 120, notes: "easy movement" })
    .repeat(2, (side) =>
      side
        .interval({ time: 45, exercise: { category: "STRETCH" }, notes: "90/90 hip — left" })
        .interval({ time: 45, exercise: { category: "STRETCH" }, notes: "90/90 hip — right" })
        .interval({ time: 60, exercise: { category: "STRETCH" }, notes: "thoracic opener" })
        .rest(30),
    )
    .cooldown({ time: 120, notes: "breathe" })
    .build();

/**
 * Rucking: a weighted hike. Garmin has no per-workout load field, so the pack weight goes in the
 * name and notes; the effort is controlled with heart-rate and grade targets.
 */
const ruckMarch = (): WorkoutInput =>
  buildWorkout("20 kg ruck", { sport: "rucking" })
    .warmup({ distance: 800, target: { heartRateZone: 1 }, notes: "20 kg pack — settle in" })
    .repeat(4, (leg) =>
      leg
        .interval({ distance: 1600, target: { heartRateZone: 3 }, notes: "sustained" })
        .recovery({ time: 180, target: { heartRateBpm: [110, 130] } }),
    )
    .interval({ distance: 1000, target: { gradePercent: [4, 8] }, notes: "hill section" })
    .cooldown({ distance: 800, target: { heartRateZone: 1 } })
    .build();

/** A generic `other` template, driven entirely by the lap button. */
const genericLapDriven = (): WorkoutInput =>
  buildWorkout("Open session", { sport: "other" })
    .warmup({ lapButton: true, notes: "press lap when ready" })
    .repeat(5, (block) => block.interval({ lapButton: true }).rest({ lapButton: true }))
    .cooldown({ lapButton: true })
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
  ["cardio circuit", cardioCircuit],
  ["yoga flow", yogaFlow],
  ["pilates session", pilatesSession],
  ["mobility routine", mobilityRoutine],
  ["ruck march", ruckMarch],
  ["generic lap-driven", genericLapDriven],
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
