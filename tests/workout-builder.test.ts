import { describe, expect, it } from "vitest";
import { buildWorkout } from "../src/workout-builder.js";
import { GarminError } from "../src/errors.js";
import type { ExecutableWorkoutStep, RepeatWorkoutGroup } from "../src/types/workouts.js";

/** Every stepOrder in the tree, depth-first, in emission order. */
function orders(steps: (ExecutableWorkoutStep | RepeatWorkoutGroup)[]): number[] {
  const out: number[] = [];
  for (const s of steps) {
    out.push(s.stepOrder);
    if (s.type === "RepeatGroupDTO") {
      out.push(...orders((s as RepeatWorkoutGroup).workoutSteps));
    }
  }
  return out;
}

describe("buildWorkout", () => {
  it("numbers stepOrder globally, continuing THROUGH repeat children", () => {
    // The single most important thing this builder does. Numbering per-block earns a live
    // 400 "The workout steps need to have unique step orders". The repeat group takes its own
    // order BEFORE its children, matching what Garmin's designer emits.
    const w = buildWorkout("x", { sport: "running" })
      .warmup({ lapButton: true })
      .repeat(3, (r) => r.interval({ distance: 400 }).recovery({ time: 60 }))
      .cooldown({ lapButton: true })
      .build();

    const seq = orders(w.workoutSegments[0]!.workoutSteps);
    expect(seq).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(seq).size).toBe(seq.length);
  });

  it("converts a min/km pace range to m/s with the FASTER bound first", () => {
    // Garmin stores speeds, and targetValueOne is the faster (larger) number. 4:30/km is faster
    // than 5:00/km, so it must land in targetValueOne despite being the smaller input.
    const w = buildWorkout("x", { sport: "running" })
      .interval({ distance: 1000, target: { pace: { minPerKm: [4.5, 5] } } })
      .build();
    const step = w.workoutSegments[0]!.workoutSteps[0] as ExecutableWorkoutStep;

    expect(step["targetType"]).toMatchObject({ workoutTargetTypeKey: "pace.zone" });
    expect(step["targetValueOne"]).toBeCloseTo(1000 / (4.5 * 60), 6); // 3.7037 m/s
    expect(step["targetValueTwo"]).toBeCloseTo(1000 / (5 * 60), 6); // 3.3333 m/s
    expect(step["targetValueOne"] as number).toBeGreaterThan(step["targetValueTwo"] as number);
  });

  it("converts a min/mile pace range using 1609.344 m", () => {
    const w = buildWorkout("x", { sport: "running" })
      .interval({ distance: 1609.344, target: { pace: { minPerMile: [8.5, 9.5] } } })
      .build();
    const step = w.workoutSegments[0]!.workoutSteps[0] as ExecutableWorkoutStep;
    // These are the exact values Garmin's designer produced for 8:30-9:30 min/mile.
    expect(step["targetValueOne"]).toBeCloseTo(3.1556, 3);
    expect(step["targetValueTwo"]).toBeCloseTo(2.8234, 3);
  });

  it("uses zoneNumber for zone targets and value pairs for range targets", () => {
    const w = buildWorkout("x", { sport: "cycling" })
      .interval({ time: 600, target: { powerZone: 3 } })
      .interval({ time: 600, target: { cadence: [95, 85] } })
      .build();
    const [zoneStep, rangeStep] = w.workoutSegments[0]!.workoutSteps as ExecutableWorkoutStep[];

    expect(zoneStep!["targetType"]).toMatchObject({ workoutTargetTypeKey: "power.zone" });
    expect(zoneStep!["zoneNumber"]).toBe(3);
    expect(zoneStep!["targetValueOne"]).toBeUndefined();

    // Cadence is a plain range and is normalised low-to-high regardless of argument order.
    expect(rangeStep!["targetValueOne"]).toBe(85);
    expect(rangeStep!["targetValueTwo"]).toBe(95);
  });

  it("makes a numeric rest a fixed.rest, not a time condition", () => {
    const w = buildWorkout("x", { sport: "swimming", poolLength: 25 })
      .rest(15)
      .rest({ time: 15 })
      .build();
    const [fixed, timed] = w.workoutSegments[0]!.workoutSteps as ExecutableWorkoutStep[];
    expect(fixed!["endCondition"]).toMatchObject({ conditionTypeKey: "fixed.rest" });
    expect(fixed!["endConditionValue"]).toBe(15);
    // An explicit `time` is still honoured — the shorthand is a default, not a straitjacket.
    expect(timed!["endCondition"]).toMatchObject({ conditionTypeKey: "time" });
  });

  it("puts poolLength on the WORKOUT and swim fields on the STEP", () => {
    const w = buildWorkout("x", { sport: "swimming", poolLength: 25 })
      .interval({ distance: 100, stroke: "free", drill: "kick", equipment: "paddles" })
      .build();
    expect(w["poolLength"]).toBe(25);
    expect(w["poolLengthUnit"]).toMatchObject({ unitKey: "meter" });

    const step = w.workoutSegments[0]!.workoutSteps[0] as ExecutableWorkoutStep;
    expect(step["strokeType"]).toMatchObject({ strokeTypeId: 6, strokeTypeKey: "free" });
    expect(step["drillType"]).toMatchObject({ drillTypeId: 1, drillTypeKey: "kick" });
    expect(step["equipmentType"]).toMatchObject({ equipmentTypeId: 3, equipmentTypeKey: "paddles" });
  });

  it("supports yard pools", () => {
    const w = buildWorkout("x", { sport: "swimming", poolLength: 25, poolLengthUnit: "yard" })
      .interval({ distance: 100 })
      .build();
    expect(w["poolLengthUnit"]).toMatchObject({ unitKey: "yard" });
  });

  it("builds a multi-sport workout from legs, one segment each", () => {
    const w = buildWorkout("Brick", { sport: "multi_sport", sessionTransitionsEnabled: true })
      .leg("cycling", (l) => l.interval({ time: 1800 }))
      .leg("running", (l) => l.interval({ distance: 5000 }))
      .build();

    expect(w.sportType).toMatchObject({ sportTypeId: 10, sportTypeKey: "multi_sport" });
    expect(w["isSessionTransitionEnabled"]).toBe(true);
    expect(w.workoutSegments.map((s) => s.sportType.sportTypeKey)).toEqual(["cycling", "running"]);
    expect(w.workoutSegments.map((s) => s.segmentOrder)).toEqual([1, 2]);
    // stepOrder stays globally unique ACROSS segments too.
    expect(w.workoutSegments.flatMap((s) => orders(s.workoutSteps))).toEqual([1, 2]);
  });

  it("supports a time-based repeat, where numberOfIterations is null", () => {
    const w = buildWorkout("AMRAP", { sport: "hiit" })
      .repeatForSeconds(600, (r) => r.interval({ reps: 10 }).rest(30))
      .build();
    const rep = w.workoutSegments[0]!.workoutSteps[0] as RepeatWorkoutGroup;
    expect(rep.numberOfIterations).toBeNull();
    expect(rep["endCondition"]).toMatchObject({ conditionTypeKey: "time" });
    expect(rep["endConditionValue"]).toBe(600);
  });

  it("carries strength exercise and weight fields", () => {
    const w = buildWorkout("x", { sport: "strength_training" })
      .interval({ reps: 8, exercise: { category: "SQUAT", name: "BARBELL_BACK_SQUAT" }, weightKg: 60 })
      .build();
    const step = w.workoutSegments[0]!.workoutSteps[0] as ExecutableWorkoutStep;
    expect(step["category"]).toBe("SQUAT");
    expect(step["exerciseName"]).toBe("BARBELL_BACK_SQUAT");
    expect(step["weightValue"]).toBe(60);
    expect(step["weightUnit"]).toMatchObject({ unitKey: "kilogram" });
  });

  it("emits a secondary target under the secondary* field family", () => {
    const w = buildWorkout("x", { sport: "cycling" })
      .interval({ time: 600, target: { powerZone: 3 }, secondaryTarget: { cadence: [85, 95] } })
      .build();
    const step = w.workoutSegments[0]!.workoutSteps[0] as ExecutableWorkoutStep;
    expect(step["targetType"]).toMatchObject({ workoutTargetTypeKey: "power.zone" });
    expect(step["zoneNumber"]).toBe(3);
    expect(step["secondaryTargetType"]).toMatchObject({ workoutTargetTypeKey: "cadence" });
    expect(step["secondaryTargetValueOne"]).toBe(85);
    expect(step["secondaryTargetValueTwo"]).toBe(95);
    // The primary fields must not be reused for the secondary target.
    expect(step["targetValueOne"]).toBeUndefined();
  });

  it("omits secondary fields entirely when no secondary target is given", () => {
    const w = buildWorkout("x", { sport: "cycling" }).interval({ time: 60 }).build();
    const step = w.workoutSegments[0]!.workoutSteps[0] as ExecutableWorkoutStep;
    expect("secondaryTargetType" in step).toBe(false);
  });

  it("supports both the ZONE and the explicit RANGE form of power and heart rate", () => {
    // Same target key either way — the difference is zoneNumber vs a value pair. Both live-verified.
    const w = buildWorkout("x", { sport: "cycling" })
      .interval({ time: 60, target: { powerZone: 4 } })
      .interval({ time: 60, target: { powerWatts: [200, 250] } })
      .interval({ time: 60, target: { heartRateZone: 3 } })
      .interval({ time: 60, target: { heartRateBpm: [140, 155] } })
      .build();
    const [pz, pw, hz, hb] = w.workoutSegments[0]!.workoutSteps as ExecutableWorkoutStep[];

    expect(pz!["targetType"]).toMatchObject({ workoutTargetTypeKey: "power.zone" });
    expect(pz!["zoneNumber"]).toBe(4);
    expect(pw!["targetType"]).toMatchObject({ workoutTargetTypeKey: "power.zone" });
    expect([pw!["targetValueOne"], pw!["targetValueTwo"]]).toEqual([200, 250]);
    expect(pw!["zoneNumber"]).toBeUndefined();

    expect(hz!["zoneNumber"]).toBe(3);
    expect([hb!["targetValueOne"], hb!["targetValueTwo"]]).toEqual([140, 155]);
  });

  it("supports grade, resistance and swim CSS offset targets", () => {
    const w = buildWorkout("x", { sport: "swimming", poolLength: 25 })
      .interval({ distance: 100, target: { gradePercent: [2, 5] } })
      .interval({ distance: 100, target: { resistance: [7, 4] } })
      .interval({ distance: 100, target: { swimCssOffsetSeconds: 5 } })
      .build();
    const [grade, res, css] = w.workoutSegments[0]!.workoutSteps as ExecutableWorkoutStep[];
    expect(grade!["targetType"]).toMatchObject({ workoutTargetTypeKey: "grade" });
    expect([grade!["targetValueOne"], grade!["targetValueTwo"]]).toEqual([2, 5]);
    // Ranges are normalised low-to-high regardless of the order given.
    expect([res!["targetValueOne"], res!["targetValueTwo"]]).toEqual([4, 7]);
    expect(css!["targetType"]).toMatchObject({ workoutTargetTypeKey: "swim.css.offset" });
    expect(css!["targetValueOne"]).toBe(5);
  });

  it("supports the calories, heart-rate, power and fixed-repetition end conditions", () => {
    const w = buildWorkout("x", { sport: "running" })
      .interval({ calories: 300 })
      .interval({ heartRateBpm: 160 })
      .interval({ powerWatts: 250 })
      .interval({ fixedRepetition: 4 })
      .build();
    const keys = (w.workoutSegments[0]!.workoutSteps as ExecutableWorkoutStep[]).map((s) =>
      (s["endCondition"] as Record<string, unknown>)["conditionTypeKey"],
    );
    expect(keys).toEqual(["calories", "heart.rate", "power", "fixed.repetition"]);
  });

  it("still rejects two end conditions when one of them is a new one", () => {
    expect(() =>
      buildWorkout("x", { sport: "running" }).interval({ calories: 300, time: 60 }).build(),
    ).toThrow(/exactly one/);
  });

  describe("guards", () => {
    it("rejects a step with no end condition", () => {
      expect(() => buildWorkout("x", { sport: "running" }).interval({}).build()).toThrow(GarminError);
    });

    it("rejects a step with two end conditions", () => {
      expect(() =>
        buildWorkout("x", { sport: "running" }).interval({ distance: 400, time: 90 }).build(),
      ).toThrow(/exactly one/);
    });

    it("rejects an empty workout, an empty repeat and an empty name", () => {
      expect(() => buildWorkout("x", { sport: "running" }).build()).toThrow(/at least one step/);
      expect(() =>
        buildWorkout("x", { sport: "running" })
          .repeat(2, () => undefined)
          .build(),
      ).toThrow(/at least one step/);
      expect(() => buildWorkout("  ", { sport: "running" })).toThrow(/needs a name/);
    });

    it("rejects a non-positive repeat count", () => {
      expect(() => buildWorkout("x", { sport: "running" }).repeat(0, (r) => r.rest(5))).toThrow(
        GarminError,
      );
      expect(() => buildWorkout("x", { sport: "running" }).repeat(1.5, (r) => r.rest(5))).toThrow(
        GarminError,
      );
    });

    it("rejects mixing single-sport steps with multi-sport legs", () => {
      expect(() =>
        buildWorkout("x", { sport: "running" })
          .interval({ distance: 400 })
          .leg("cycling", (l) => l.interval({ time: 60 }))
          .build(),
      ).toThrow(/cannot be both/);
    });
  });
});
