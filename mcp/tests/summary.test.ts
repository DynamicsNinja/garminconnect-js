import { describe, expect, it } from "vitest";
import { workoutFromSpec } from "garminconnect-js";
import { EXERCISES } from "garminconnect-js/exercises";
import { clock, summarizeWorkout } from "../src/summary.js";

const summary = (spec: unknown) => summarizeWorkout(workoutFromSpec(spec, EXERCISES));

describe("summarizeWorkout", () => {
  it("renders a running workout with a pace target", () => {
    expect(
      summary({
        name: "6x400",
        sport: "running",
        steps: [
          { type: "warmup", lapButton: true },
          { type: "repeat", times: 6, steps: [
            { type: "interval", distance: 400, target: { pace: { minPerKm: [4, 4.2] } } },
            { type: "recovery", time: 120 },
          ] },
          { type: "cooldown", time: 600 },
        ],
      }),
    ).toBe(
      [
        "6x400 — running",
        "1. Warm-up: until lap button",
        "2. Repeat 6×:",
        "   1. Interval: 400 m · @ 4:00–4:12 /km (6:26–6:46 /mi)",
        "   2. Recovery: 2:00",
        "3. Cool-down: 10:00",
      ].join("\n"),
    );
  });

  it("shows a per-mile pace in both units, so a mile runner can check it", () => {
    // Garmin stores speed only, so the unit the user asked in is gone by the time we summarise.
    // 8:30–9:30 /mi is 5:17–5:54 /km.
    const text = summary({
      name: "Tempo",
      sport: "running",
      steps: [{ type: "interval", distance: 1609, target: { pace: { minPerMile: [8.5, 9.5] } } }],
    });
    expect(text).toContain("@ 5:17–5:54 /km (8:30–9:30 /mi)");
  });

  it("renders swim, strength, zones and time-based repeats", () => {
    const text = summary({
      name: "Mix",
      sport: "swimming",
      poolLength: 25,
      steps: [
        { type: "interval", distance: 100, stroke: "free", drill: "kick", equipment: "fins" },
        { type: "rest", restSeconds: 15 },
        { type: "repeatForSeconds", seconds: 600, steps: [{ type: "interval", time: 60, target: { heartRateZone: 2 } }] },
      ],
    });
    expect(text).toContain("Mix — swimming, 25 m pool");
    expect(text).toContain("1. Interval: 100 m · free · kick · fins");
    expect(text).toContain("2. Rest: 0:15 rest");
    expect(text).toContain("3. Repeat for 10:00:");
    expect(text).toContain("   1. Interval: 1:00 · @ heart-rate zone 2");

    const strength = summary({
      name: "Legs",
      sport: "strength_training",
      steps: [{ type: "interval", reps: 8, exercise: { category: "SQUAT", name: "BARBELL_BACK_SQUAT" }, weightKg: 60 }],
    });
    expect(strength).toContain("1. Interval: 8 reps · barbell back squat · 60 kg");
  });

  it("renders multi-sport legs", () => {
    const text = summary({
      name: "Brick",
      sport: "multi_sport",
      legs: [
        { sport: "cycling", steps: [{ type: "interval", time: 1800, target: { powerZone: 3 }, secondaryTarget: { cadence: [85, 95] } }] },
        { sport: "running", steps: [{ type: "interval", distance: 5000 }] },
      ],
    });
    expect(text).toBe(
      ["Brick — multi sport", "Leg 1: cycling", "   1. Interval: 30:00 · @ power zone 3 · + 85–95 rpm", "Leg 2: running", "   1. Interval: 5 km"].join("\n"),
    );
  });

  it("formats clock times", () => {
    expect([clock(5), clock(65), clock(3600), clock(3725)]).toEqual(["0:05", "1:05", "1:00:00", "1:02:05"]);
  });
});
