import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WorkoutBuilder, WorkoutStepList } from "../src/workout-builder.js";

/**
 * Drift guard for the workout-builder documentation.
 *
 * This library serves two audiences and BOTH have to stay correct: people who read the docs, and
 * coding agents that read `AGENTS.md` after `npm install` and never look anywhere else. A builder
 * option that exists in code but appears in neither file is invisible to both.
 *
 * `AGENTS.md` must be self-sufficient — an agent should never need `WORKOUTS.md` — so every option
 * is required there. `WORKOUTS.md` is the human guide and must also cover everything, because a
 * reader who finds it should not have to fall back to the agent briefing.
 */
const read = (name: string) => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), "utf8");
const AGENTS = read("AGENTS.md");
const WORKOUTS = read("WORKOUTS.md");
const README = read("README.md");

/** Every public step/block method on the builder, discovered at runtime rather than hardcoded. */
function builderMethods(): string[] {
  const names = new Set<string>();
  for (const proto of [WorkoutStepList.prototype, WorkoutBuilder.prototype]) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor" || name === "collect") continue;
      const d = Object.getOwnPropertyDescriptor(proto, name);
      if (typeof d?.value === "function") names.add(name);
    }
  }
  return [...names];
}

/**
 * Option keys the builder accepts. Kept as a literal list ON PURPOSE: these come from TypeScript
 * union/interface types, which are erased at runtime and cannot be reflected over. Adding an
 * option without adding it here is the one drift this guard cannot catch on its own — so the list
 * doubles as the checklist to update when extending `StepEnd`, `StepTarget` or `StepOptions`.
 */
const END_CONDITIONS = [
  "distance",
  "time",
  "reps",
  "lapButton",
  "restSeconds",
  "calories",
  "heartRateBpm",
  "powerWatts",
  "fixedRepetition",
];
const TARGETS = [
  "pace",
  "speedMetresPerSecond",
  "powerZone",
  "powerWatts",
  "heartRateZone",
  "heartRateBpm",
  "cadence",
  "gradePercent",
  "resistance",
  "swimCssOffsetSeconds",
];
const STEP_EXTRAS = ["stroke", "drill", "equipment", "exercise", "weightKg", "notes", "secondaryTarget"];
const SPORTS = [
  "running",
  "cycling",
  "swimming",
  "strength_training",
  "cardio_training",
  "hiit",
  "yoga",
  "pilates",
  "mobility",
  "rucking",
  "other",
  "multi_sport",
];

describe("workout builder documentation", () => {
  it("documents every builder method in AGENTS.md and WORKOUTS.md", () => {
    const methods = builderMethods();
    // Sanity: if reflection returns nothing the rest of this test would pass vacuously.
    expect(methods.length).toBeGreaterThan(8);

    for (const doc of [
      ["AGENTS.md", AGENTS],
      ["WORKOUTS.md", WORKOUTS],
    ] as const) {
      const missing = methods.filter((m) => !doc[1].includes(m));
      expect(
        missing,
        `${doc[0]} does not mention builder method(s): ${missing.join(", ")}. ` +
          "Both files must stay complete — AGENTS.md because agents read only it, WORKOUTS.md " +
          "because humans read only that.",
      ).toEqual([]);
    }
  });

  it("documents every end condition, target and step option in both files", () => {
    const all = [...END_CONDITIONS, ...TARGETS, ...STEP_EXTRAS];
    for (const doc of [
      ["AGENTS.md", AGENTS],
      ["WORKOUTS.md", WORKOUTS],
    ] as const) {
      const missing = all.filter((k) => !doc[1].includes(k));
      expect(missing, `${doc[0]} does not mention: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("lists every buildable sport in both files", () => {
    for (const doc of [
      ["AGENTS.md", AGENTS],
      ["WORKOUTS.md", WORKOUTS],
    ] as const) {
      const missing = SPORTS.filter((s) => !doc[1].includes(s));
      expect(missing, `${doc[0]} does not mention sport(s): ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("warns in both files that walking and hiking are not buildable", () => {
    for (const doc of [
      ["AGENTS.md", AGENTS],
      ["WORKOUTS.md", WORKOUTS],
    ] as const) {
      expect(doc[1], `${doc[0]} must warn that walking/hiking have no workout sport type`).toMatch(
        /walking/i,
      );
      expect(doc[1]).toMatch(/hiking/i);
    }
  });

  it("makes the human guide discoverable from the README and shipped in the package", () => {
    // A guide nobody can find is the same as no guide.
    expect(README, "README must link to WORKOUTS.md").toContain("WORKOUTS.md");
    expect(README, "README must show buildWorkout").toContain("buildWorkout");

    const pkg = JSON.parse(read("package.json")) as { files: string[] };
    expect(pkg.files, "WORKOUTS.md must ship in the npm tarball").toContain("WORKOUTS.md");
    expect(pkg.files).toContain("AGENTS.md");
  });
});
