/**
 * Compile-time guarantees on values Garmin only accepts from a fixed set.
 *
 * The assertions that matter here are the `@ts-expect-error` lines: `npm run typecheck` fails if
 * any of them stops being an error, i.e. if a type is widened back to `string`. The runtime
 * `expect`s only keep vitest from reporting an empty test.
 */
import { describe, expect, it } from "vitest";
import { buildWorkout } from "../src/workout-builder.js";
import type { WorkoutExercise } from "../src/workout-builder.js";
import type { ExerciseCategory } from "../src/types/workouts.js";
import type { FtpAggregation, RunningToleranceAggregation } from "../src/types/metrics.js";
import type { GearUsageType } from "../src/types/gear.js";
import type { Garmin } from "../src/garmin.js";

describe("builder exercise names", () => {
  it("accepts a real name for its own category", () => {
    const w = buildWorkout("x", { sport: "strength_training" })
      .interval({ reps: 8, exercise: { category: "SQUAT", name: "BARBELL_BACK_SQUAT" } })
      .build();
    expect(w.workoutSegments).toHaveLength(1);
  });

  it("rejects a name from another category, which Garmin would store as an empty string", () => {
    // @ts-expect-error BARBELL_BENCH_PRESS belongs to BENCH_PRESS, not SQUAT
    const bad: WorkoutExercise = { category: "SQUAT", name: "BARBELL_BENCH_PRESS" };
    expect(bad.category).toBe("SQUAT");
  });

  it("rejects a made-up name", () => {
    // @ts-expect-error not an exercise Garmin knows
    const bad: WorkoutExercise = { category: "SQUAT", name: "SQAUT" };
    expect(bad.category).toBe("SQUAT");
  });

  it("rejects any name for a category with no names", () => {
    // @ts-expect-error STRETCH has no named exercises in Garmin's catalogue
    const bad: WorkoutExercise = { category: "STRETCH", name: "ANYTHING" };
    expect(bad.category).toBe("STRETCH");
  });

  it("still accepts a bare category held in a wide variable", () => {
    // A category read from config or a loop is typed as the whole union. That must keep working,
    // which a plain 53-way discriminated union would not (TypeScript stops decomposing at 25).
    const category = "PLANK" as ExerciseCategory;
    const ok: WorkoutExercise = { category };
    expect(ok.category).toBe("PLANK");
  });
});

describe("fixed-value parameters", () => {
  it("narrows aggregation and usage type", () => {
    const ftp: FtpAggregation[] = ["daily", "weekly", "monthly", "yearly"];
    const tolerance: RunningToleranceAggregation[] = ["daily", "weekly"];
    // Both spellings: createGear upper-cases before sending, so lower case has always worked.
    const usage: GearUsageType[] = ["DISTANCE", "duration"];

    // @ts-expect-error getRunningTolerance has no monthly aggregation
    const noMonthly: RunningToleranceAggregation = "monthly";
    // @ts-expect-error "TIME" is rejected by Garmin with a 400; the value is DURATION
    const noTime: GearUsageType = "TIME";

    expect([ftp, tolerance, usage, noMonthly, noTime].flat()).toHaveLength(10);
  });

  it("is what the Garmin methods actually take", () => {
    type Ftp = Parameters<Garmin["getFunctionalThresholdPowerRange"]>[3];
    type Lactate = Parameters<Garmin["getLactateThreshold"]>[3];
    type Tolerance = Parameters<Garmin["getRunningTolerance"]>[2];
    type Usage = Parameters<Garmin["createGear"]>[5];

    // @ts-expect-error string must no longer be accepted
    const a: Ftp = "fortnightly";
    // @ts-expect-error string must no longer be accepted
    const b: Lactate = "fortnightly";
    // @ts-expect-error string must no longer be accepted
    const c: Tolerance = "yearly";
    // @ts-expect-error string must no longer be accepted
    const d: Usage = "MILEAGE";
    expect([a, b, c, d]).toHaveLength(4);
  });
});
