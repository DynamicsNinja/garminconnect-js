import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXERCISES, exercise, isExerciseName } from "../src/exercises.js";
import { WORKOUT_EXERCISE_CATEGORIES, buildWorkout } from "../src/index.js";

/**
 * Contract for the `garminconnect-js/exercises` subpath.
 *
 * Two things are being protected here, and only one of them is the data.
 *
 * The data: every pair in this module was confirmed by a live upload and read-back (see
 * `scripts/verify-exercises.ts`). These assertions pin the shape and the totals so a regenerated
 * file that silently lost half the catalogue — or gained a category the root package does not
 * know about — fails instead of shipping.
 *
 * The packaging: the whole point of a separate entry point is that the root bundle does not carry
 * ~60 KB of catalogue nobody asked for. `src/index.ts` re-exporting this module would undo that
 * without changing a single behaviour, so a test has to say it out loud.
 */
const CATEGORY_COUNT = 51;
const NAME_COUNT = 1830;

describe("exercise catalogue", () => {
  it("covers every category, and only categories the package knows", () => {
    const keys = Object.keys(EXERCISES);
    expect(keys).toHaveLength(CATEGORY_COUNT);
    const known = new Set<string>(WORKOUT_EXERCISE_CATEGORIES);
    expect(keys.filter((k) => !known.has(k))).toEqual([]);
  });

  it("holds every verified name, each sorted, unique and in Garmin's key casing", () => {
    let total = 0;
    for (const [category, names] of Object.entries(EXERCISES)) {
      total += names.length;
      expect(names.length, `${category} must have at least one name`).toBeGreaterThan(0);
      expect(new Set(names).size, `${category} has duplicate names`).toBe(names.length);
      expect([...names].sort(), `${category} is not sorted`).toEqual([...names]);
      for (const name of names) {
        // A LEADING UNDERSCORE IS REAL, not a parsing artefact. Nine keys begin with one
        // (`_3_WAY_CALF_RAISE`, `_45_DEGREE_PLANK`, ...) because the underlying exercise name
        // starts with a digit. Garmin echoed every one of them back unchanged on upload, and the
        // digit-leading form without the underscore was rejected when tried.
        expect(name, `${category}.${name} is not a Garmin exercise key`).toMatch(
          /^_?[A-Z0-9][A-Z0-9_]*$/,
        );
      }
    }
    expect(total).toBe(NAME_COUNT);
  });

  it("names the two valid categories that have no exercises at all", () => {
    // STRETCH and UNKNOWN are accepted on the wire but Garmin's catalogue lists no names for
    // them. They must stay OUT of EXERCISES — an empty array would type `exercise("STRETCH", ...)`
    // as `never` and read as "this category is broken" rather than "pass a bare category".
    expect(Object.keys(EXERCISES)).not.toContain("STRETCH");
    expect(Object.keys(EXERCISES)).not.toContain("UNKNOWN");
    expect(WORKOUT_EXERCISE_CATEGORIES).toContain("STRETCH");
    expect(WORKOUT_EXERCISE_CATEGORIES).toContain("UNKNOWN");
  });

  it("carries the categories that only the translations bundle knew about", () => {
    // POSE (yoga), MOVE (pilates/mobility) and INDOOR_ROW appear in no exercise picker; they were
    // found in Garmin's translations bundle and then confirmed against the API.
    expect(EXERCISES.POSE.length).toBeGreaterThan(100);
    expect(EXERCISES.MOVE.length).toBeGreaterThan(50);
    expect(EXERCISES.INDOOR_ROW).toEqual(["ROWING_MACHINE"]);
  });
});

describe("exercise()", () => {
  it("returns the pair a builder step wants", () => {
    expect(exercise("SQUAT", "BARBELL_BACK_SQUAT")).toEqual({
      category: "SQUAT",
      name: "BARBELL_BACK_SQUAT",
    });
  });

  it("feeds a builder step, producing both halves Garmin stores", () => {
    const built = buildWorkout("Legs", { sport: "strength_training" })
      .interval({ reps: 8, exercise: exercise("SQUAT", "BARBELL_BACK_SQUAT") })
      .build();
    const step = built.workoutSegments[0]!.workoutSteps[0] as Record<string, unknown>;
    expect(step["category"]).toBe("SQUAT");
    expect(step["exerciseName"]).toBe("BARBELL_BACK_SQUAT");
  });
});

describe("isExerciseName()", () => {
  it("accepts a real pair", () => {
    expect(isExerciseName("SQUAT", "BARBELL_BACK_SQUAT")).toBe(true);
  });

  it("rejects a real name from the wrong category", () => {
    // This is the silent failure the module exists for: Garmin accepts this upload and stores
    // `exerciseName: ""`.
    expect(isExerciseName("SQUAT", "BARBELL_BENCH_PRESS")).toBe(false);
  });

  it("rejects an invented name and an unknown category", () => {
    expect(isExerciseName("SQUAT", "MEGA_SQUAT")).toBe(false);
    expect(isExerciseName("NOT_A_CATEGORY", "BARBELL_BACK_SQUAT")).toBe(false);
  });

  it("is not fooled by inherited Object properties", () => {
    expect(isExerciseName("constructor", "anything")).toBe(false);
    expect(isExerciseName("SQUAT", "toString")).toBe(false);
  });
});

describe("subpath packaging", () => {
  it("keeps the catalogue out of the package root", () => {
    const index = readFileSync("src/index.ts", "utf8");
    expect(
      index,
      "src/index.ts must not re-export ./exercises.js — that would pull ~60 KB of catalogue " +
        "into every consumer's bundle and defeat the subpath entirely.",
    ).not.toMatch(/exercises\.js/);
  });

  it("is published as its own entry point, with types resolved first", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      exports: Record<string, Record<string, string> | string>;
      typesVersions: Record<string, Record<string, string[]>>;
    };
    const sub = pkg.exports["./exercises"] as Record<string, string>;
    expect(sub, "package.json must export ./exercises").toBeDefined();
    expect(Object.keys(sub)[0], "types must come first").toBe("types");
    expect(sub["import"]).toBe("./dist/exercises.js");
    expect(sub["require"]).toBe("./dist/exercises.cjs");
    // `exports` is invisible to moduleResolution "node"/"node10"; typesVersions is what those
    // consumers read, and without it the subpath imports with no types at all.
    expect(pkg.typesVersions["*"]!["exercises"]).toEqual(["./dist/exercises.d.ts"]);
  });

  it("is built as its own tsup entry", () => {
    expect(readFileSync("tsup.config.ts", "utf8")).toContain("src/exercises.ts");
  });
});
