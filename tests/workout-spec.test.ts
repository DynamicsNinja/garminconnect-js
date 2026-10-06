import { describe, expect, it } from "vitest";
import { EXERCISES } from "../src/exercises.js";
import { GarminError } from "../src/errors.js";
import type { StepOptions, StepTarget, WorkoutBuildOptions } from "../src/workout-builder.js";
import {
  SPEC_STEP_OPTION_KEYS,
  SPEC_TARGET_KEYS,
  SPEC_TOP_KEYS,
  suggest,
  workoutFromSpec,
} from "../src/workout-spec.js";
import { SPEC_FIXTURES } from "./fixtures/workout-specs.js";

const build = (spec: unknown) => workoutFromSpec(spec, EXERCISES);
const running = (steps: unknown[]) => ({ name: "x", sport: "running", steps });

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type KeysOfUnion<T> = T extends unknown ? keyof T : never;

describe("workoutFromSpec: same output as buildWorkout", () => {
  for (const [name, fixture] of Object.entries(SPEC_FIXTURES)) {
    it(name, () => {
      expect(build(fixture.spec)).toEqual(fixture.builder());
    });
  }

  it("accepts a reversed pace range", () => {
    const pace = (minPerKm: number[]) => build(running([{ type: "interval", distance: 400, target: { pace: { minPerKm } } }]));
    expect(pace([5, 4.5])).toEqual(pace([4.5, 5]));
  });
});

describe("workoutFromSpec: key lists stay in step with the builder's types", () => {
  it("pins every key list to its TypeScript type (checked by `npm run typecheck`)", () => {
    const step: Equal<(typeof SPEC_STEP_OPTION_KEYS)[number], keyof StepOptions> = true;
    const target: Equal<(typeof SPEC_TARGET_KEYS)[number], KeysOfUnion<StepTarget>> = true;
    const top: Equal<(typeof SPEC_TOP_KEYS)[number], "name" | "steps" | "legs" | keyof WorkoutBuildOptions> = true;
    expect([step, target, top]).toEqual([true, true, true]);
  });
});

describe("workoutFromSpec: rejections name the path", () => {
  const rejects = (spec: unknown, message: string | RegExp) => {
    expect(() => build(spec)).toThrow(GarminError);
    expect(() => build(spec)).toThrow(message);
  };

  it("rejects an unknown key and suggests where it belongs", () => {
    rejects(
      running([{ type: "interval", distance: 400, pace: { minPerKm: [4, 5] } }]),
      'workout.steps[0]: unknown key "pace"; did you mean target: { pace: … }?',
    );
  });

  it("reports the full nested path", () => {
    rejects(
      running([{ type: "repeat", times: 2, steps: [{ type: "interval", distance: 400, duration: 60 }] }]),
      /^workout\.steps\[0\]\.steps\[0\]: unknown key "duration"; did you mean time \(seconds\)\?$/,
    );
  });

  it("rejects numbers sent as strings", () => {
    rejects(running([{ type: "interval", distance: "400" }]), 'workout.steps[0].distance: expected a number, got "400"');
  });

  it("rejects an unknown step type with the allowed list", () => {
    rejects(running([{ type: "sprint", time: 10 }]), /workout\.steps\[0\]\.type: expected one of warmup, cooldown/);
  });

  it("needs exactly one of steps or legs", () => {
    rejects({ name: "x", sport: "running" }, 'workout: give exactly one of "steps"');
    rejects(
      { name: "x", sport: "running", steps: [{ type: "interval", time: 1 }], legs: [] },
      'workout: give exactly one of "steps"',
    );
  });

  it("puts the builder's own guard messages behind the path", () => {
    rejects(running([{ type: "interval", time: 60, distance: 400 }]), /^workout\.steps\[0\]: Workout step has 2 end conditions/);
    rejects(running([{ type: "repeat", times: 3, steps: [] }]), "workout.steps[0]: A repeat block must contain at least one step");
    rejects(
      running([{ type: "interval", time: 60, secondaryTarget: { gradePercent: [1, 2] } }]),
      /^workout\.steps\[0\]: gradePercent cannot be used as a secondaryTarget/,
    );
  });

  it("rejects a target with more than one key", () => {
    rejects(
      running([{ type: "interval", time: 60, target: { powerZone: 2, cadence: [80, 90] } }]),
      "workout.steps[0].target: a target has exactly one key",
    );
  });

  it("rejects an unknown exercise name, best guess first", () => {
    rejects(
      { name: "x", sport: "strength_training", steps: [{ type: "interval", reps: 5, exercise: { category: "SQUAT", name: "Barbell Back Squat" } }] },
      /^workout\.steps\[0\]\.exercise\.name: "Barbell Back Squat" is not an exercise in SQUAT; closest: BARBELL_BACK_SQUAT/,
    );
  });

  it("rejects a name on a category that has none", () => {
    rejects(
      { name: "x", sport: "strength_training", steps: [{ type: "interval", reps: 5, exercise: { category: "STRETCH", name: "ANYTHING" } }] },
      'workout.steps[0].exercise.name: category STRETCH has no named exercises; omit "name"',
    );
  });

  it("rejects an unknown category with suggestions", () => {
    rejects(
      { name: "x", sport: "strength_training", steps: [{ type: "interval", reps: 5, exercise: { category: "SQUATS" } }] },
      /exercise\.category: "SQUATS" is not an exercise category; closest: SQUAT/,
    );
  });

  it("validates each leg", () => {
    rejects(
      { name: "x", sport: "multi_sport", legs: [{ sport: "walking", steps: [{ type: "interval", time: 1 }] }] },
      /^workout\.legs\[0\]\.sport: expected one of running/,
    );
  });
});

describe("suggest", () => {
  it("puts the exact key first when given a human spelling", () => {
    expect(suggest("barbell back squat", EXERCISES.SQUAT)[0]).toBe("BARBELL_BACK_SQUAT");
  });
  it("returns nothing for gibberish", () => {
    expect(suggest("qqqzzzxxx", EXERCISES.SQUAT)).toEqual([]);
  });
  it("returns at most `limit` names", () => {
    expect(suggest("squat", EXERCISES.SQUAT, 3)).toHaveLength(3);
  });
});
