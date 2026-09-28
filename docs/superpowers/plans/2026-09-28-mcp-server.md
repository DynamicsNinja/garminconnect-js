# garminconnect-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people create Garmin workouts, and use everything else `garminconnect-js` offers, by talking to Claude in Claude Desktop, through an MCP server that is generated from the library rather than hand-maintained.

**Architecture:** Two library additions and one new workspace package. `workoutFromSpec` turns a JSON workout into builder calls. A committed, generated method manifest describes every `Garmin` method with JSON Schema parameters and a safety class. The `mcp/` package (`garminconnect-mcp`) bundles the library from this commit's source and turns those two artefacts into MCP tools over stdio.

**Tech Stack:** TypeScript 5.9, Node ≥ 18, tsup, vitest, TypeScript compiler API (manifest generator, dev-only), `@modelcontextprotocol/sdk` ^1.30.1 (mcp only), `ajv` (dev-only, schema tests).

**Spec:** `docs/superpowers/specs/2026-09-28-mcp-server-design.md`

## Deviations from the spec (found while planning; flag to the user)

1. **The MCP server BUNDLES the library instead of depending on `garminconnect-js@^version`.** With lockstep versions, bumping both to 0.7.0 makes `mcp/package.json` require `garminconnect-js@^0.7.0` before it is on npm. npm does not satisfy a workspace member's dependency from the root package, so `npm ci` would fail on every release commit. Instead, `mcp/` resolves `garminconnect-js`, `garminconnect-js/exercises` and `garminconnect-js/manifest` to `../src/*` through tsconfig `paths` (and a vitest alias), and tsup inlines them. The server still imports ONLY those three public entry points (an ESLint rule enforces it), and it can never run against a library version it was not tested with.
2. **`workoutFromSpec(spec, exercises)` takes the exercise catalogue as a required second argument.** Importing `EXERCISES` into the root would add ~60 KB to the root bundle, which `AGENTS.md` promises it never carries. A separate subpath would duplicate `GarminError` in the CJS build and break `instanceof`. Callers pass `EXERCISES` from `garminconnect-js/exercises`.
3. **Safety classification uses an explicit WRITE prefix list.** The spec said both "else write" and "a name matching no rule fails". Those two rules contradict each other, so the second one wins.
4. **Full-replace writes are `destructive`:** `updateMenstrualDailyLog`, `updateMenstrualCalendar`, `setActivityExerciseSets`, plus the hand-written `update_workout`. Also, MCP treats a MISSING `destructiveHint` as `true`, so write tools set `destructiveHint: false` explicitly rather than leaving it out.
5. **Builder fix: a reversed pace range (`[5, 4.5]`) is currently stored with the SLOWER speed first**, the wrong way round. `range()` already sorts the other targets and pace does not. An LLM will send either order, so Task 1 fixes the builder itself.
6. **Release:** `publish.yml` is already tag-driven, so it publishes both packages from one tag. `npm run bump -- X.Y.Z` bumps both versions. There is no `npm run release`.
7. **Parity fixtures** cover every feature used in `examples/workout-gallery.ts` as dedicated spec/builder pairs, not by importing the gallery, which is a runnable upload script.
8. **Descriptions:** the cleaned AGENTS.md note comes first, then JSDoc, then a humanised name, capped at 600 characters.
9. **Manifest params carry `role: "file" | "filename"`** for `Blob` inputs, so the server can swap them for a `filePath` argument.

## Global Constraints

- Published `garminconnect-js` keeps `"dependencies": {}` (`tests/build.test.ts` asserts it).
- Node `>=18` for both packages (`engines.node`).
- The root bundle's JavaScript must not include the exercise catalogue.
- `mcp/` source imports the library only as `garminconnect-js`, `garminconnect-js/exercises`, `garminconnect-js/manifest`, never `../../src/...`.
- The MCP server never writes to stdout except MCP protocol frames. Logs go to stderr.
- Tool names match `^[a-z0-9_]{1,64}$` (snake_case of the method name).
- Tool results longer than 100 000 characters are truncated with the marker `[truncated: N of M characters]`.
- Exclusions: `logout`, `uploadWorkout`, `uploadRunningWorkout`, `uploadCyclingWorkout`, `uploadSwimmingWorkout`, `uploadStrengthWorkout`, `updateWorkout`. `queryGarminGraphql` only when `GARMIN_MCP_ENABLE_GRAPHQL=1`.
- Env vars: `GARMIN_MCP_TOKEN_DIR` (default `~/.garminconnect-mcp/tokens`), `GARMIN_MCP_DOWNLOAD_DIR` (default `~/Downloads/garmin`), `GARMIN_MCP_GROUPS` (default all), `GARMIN_MCP_ENABLE_GRAPHQL`.
- `mcp/package.json` `version` always equals the root `version`.
- Never publish, tag or run live scripts against an account other than the test account (`GARMIN_TEST_PROFILE_ID` gate). Releases need the maintainer's explicit go-ahead.
- Commit on `main` and push after each task (repo convention).

## Review Focus

1. **A reversed pace range `[5, 4.5]`** must store the same targets as `[4.5, 5]`. Owner: Task 1 (builder test and spec test).
2. **Numbers sent as strings (`"distance": "400"`)** must fail with the path and the bad value, not produce a NaN workout. Owner: Task 1.
3. **An expired session while the server keeps running:** after the user runs `login` in a terminal, the next tool call must pick up the new tokens without restarting Claude Desktop. Owner: Task 4 (reset on `GarminAuthError`).
4. **`~/Downloads/run.gpx` as a file path** must work (home expansion), not be rejected as relative. Owner: Task 5.
5. **Human-form exercise names ("Barbell Back Squat")** must produce an error whose FIRST suggestion is the right key. Owner: Task 1.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/workout-builder.ts` (modify) | export `WORKOUT_SPORTS`; pace range order fix | 1 |
| `src/workout-spec.ts` (create) | `workoutFromSpec`, spec types, key lists, `suggest` | 1 |
| `tests/fixtures/workout-specs.ts` (create) | spec/builder parity pairs | 1 |
| `tests/workout-spec.test.ts` (create) | parity + rejection tests | 1 |
| `src/workout-spec-schema.ts` (create) | `WORKOUT_SPEC_JSON_SCHEMA` built from constants | 2 |
| `tests/workout-spec-schema.test.ts` (create) | ajv validation of fixtures/rejections | 2 |
| `scripts/lib/garmin-source.ts` (create) | shared parsing moved out of `generate-api-docs.ts` | 3 |
| `scripts/generate-manifest.ts` (create) | TS-compiler-API manifest generator | 3 |
| `src/manifest.ts` (create) | manifest types + `GARMIN_METHODS` re-export (subpath entry) | 3 |
| `src/generated/manifest.ts` (generated, committed) | the data | 3 |
| `tests/manifest.test.ts` (create) | drift, completeness, mapping, refusal tests | 3 |
| `mcp/package.json`, `mcp/tsconfig.json`, `mcp/tsup.config.ts`, `mcp/vitest.config.ts` | workspace package | 4 |
| `mcp/src/session.ts` | config + token-backed session | 4 |
| `mcp/src/errors.ts` | error → tool result text | 4 |
| `mcp/src/results.ts` | text/JSON results, truncation | 4 |
| `mcp/src/server.ts` | MCP server over a list of tool factories | 4 |
| `mcp/src/tools.ts` | the list of tool factories | 4, 5, 6 |
| `mcp/src/login.ts`, `mcp/src/cli.ts` | `login` command, stdio entry point | 4 |
| `mcp/src/method-tools.ts` | generated tools from the manifest | 5 |
| `mcp/src/files.ts` | upload path checks, download saving, extension sniffing | 5 |
| `mcp/src/summary.ts` | readable workout summary | 6 |
| `mcp/src/workout-tools.ts` | preview/create/update/search tools | 6 |
| `mcp/scripts/smoke.ts` | live round-trip on the test account | 7 |
| `tests/mcp-package.test.ts` | lockstep + bundling contract | 7 |
| `mcp/README.md`, `AGENTS.md`, `WORKOUTS.md`, `README.md`, `CHANGELOG.md`, `.github/workflows/publish.yml` | docs, release | 2, 3, 7 |

---

### Task 1: `workoutFromSpec`, a JSON version of the builder (plus the pace-order fix)

**Files:**
- Modify: `src/workout-builder.ts` (pace branch of `targetOf`; export `WORKOUT_SPORTS` after `export type WorkoutSport`)
- Modify: `src/index.ts` (exports)
- Create: `src/workout-spec.ts`
- Create: `tests/fixtures/workout-specs.ts`
- Create: `tests/workout-spec.test.ts`
- Modify: `tests/workout-builder.test.ts` (one test)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `buildWorkout`, `WorkoutStepList`, `StepOptions`, `StepEnd`, `StepTarget`, `WorkoutBuildOptions`, `WorkoutSport`, `WorkoutExercise`, `StrokeKey`, `DrillKey`, `EquipmentKey` from `src/workout-builder.ts`, and `WORKOUT_EXERCISE_CATEGORIES`, `WORKOUT_STROKE_TYPE_ID`, `WORKOUT_DRILL_TYPE_ID`, `WORKOUT_EQUIPMENT_TYPE_ID` from `src/types/workouts.ts`.
- Produces (all exported from `src/workout-spec.ts`):
  - `workoutFromSpec(spec: unknown, exercises: ExerciseCatalogue): WorkoutInput`
  - `type WorkoutSpec`, `type WorkoutSpecStep`, `type WorkoutSpecLeg`, `type SimpleStepType`, `type ExerciseCatalogue = Readonly<Record<string, readonly string[]>>`
  - `SIMPLE_STEP_TYPES`, `SPEC_END_KEYS`, `SPEC_STEP_OPTION_KEYS`, `SPEC_TARGET_KEYS`, `SPEC_TOP_KEYS`, `STROKE_KEYS`, `DRILL_KEYS`, `EQUIPMENT_KEYS` (readonly string-literal arrays)
  - `suggest(input: string, candidates: readonly string[], limit?: number): string[]`
  - From `src/workout-builder.ts`: `WORKOUT_SPORTS: readonly WorkoutSport[]`
  - Error messages all have the form `<path>: <message>`, where path looks like `workout.steps[1].steps[0].target`.

- [ ] **Step 1: Write the failing builder test for reversed pace ranges**

Append inside `describe("buildWorkout", ...)` in `tests/workout-builder.test.ts`:

```ts
  it("stores a reversed pace range the same as the ordered one (faster speed first)", () => {
    // An LLM or a form will send [slow, fast] as often as [fast, slow]. Garmin needs the larger
    // m/s value in targetValueOne either way; every other range target already sorts.
    const step = (minPerKm: [number, number]) =>
      buildWorkout("x", { sport: "running" })
        .interval({ distance: 1000, target: { pace: { minPerKm } } })
        .build().workoutSegments[0]!.workoutSteps[0];
    expect(step([5, 4.5])).toEqual(step([4.5, 5]));
  });
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/workout-builder.test.ts -t "reversed pace"`
Expected: FAIL, because `targetValueOne`/`targetValueTwo` are swapped.

- [ ] **Step 3: Fix the pace branch and export the sport list**

In `src/workout-builder.ts`, replace the body of `if ("pace" in t) { ... }` in `targetOf` with:

```ts
  if ("pace" in t) {
    // Garmin wants SPEEDS, faster (larger) first. Either input order is accepted: the two speeds
    // are sorted here, exactly as `range(..., descending)` does for speed targets.
    const [a, b] =
      "minPerKm" in t.pace
        ? [paceToMps(t.pace.minPerKm[0]), paceToMps(t.pace.minPerKm[1])]
        : [milePaceToMps(t.pace.minPerMile[0]), milePaceToMps(t.pace.minPerMile[1])];
    return { ...typed(TARGET.PACE_ZONE, "pace.zone"), [oneField]: Math.max(a, b), [twoField]: Math.min(a, b) };
  }
```

Directly after `export type WorkoutSport = keyof typeof SPORTS;` add:

```ts
/** Every `WorkoutSport`, at runtime — for validating JSON input and building schemas. */
export const WORKOUT_SPORTS = Object.keys(SPORTS) as readonly WorkoutSport[];
```

- [ ] **Step 4: Run the builder tests**

Run: `npx vitest run tests/workout-builder.test.ts`
Expected: PASS (all, including the existing "FASTER bound first" test).

- [ ] **Step 5: Create the parity fixtures**

Create `tests/fixtures/workout-specs.ts`:

```ts
/**
 * Spec/builder pairs: each spec must produce EXACTLY what the equivalent builder chain produces.
 * Together they cover every builder feature `examples/workout-gallery.ts` uses — every step type,
 * every end condition, every target, swim fields, exercises, weight, notes, both repeat kinds
 * (nested), and multi-sport legs. Shared by the parity tests and the JSON Schema tests.
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
```

- [ ] **Step 6: Write the failing spec tests**

Create `tests/workout-spec.test.ts`:

```ts
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

describe("workoutFromSpec: parity with buildWorkout", () => {
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
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `npx vitest run tests/workout-spec.test.ts`
Expected: FAIL with "Failed to load url ../src/workout-spec.js" or a similar module-not-found error.

- [ ] **Step 8: Implement `src/workout-spec.ts`**

```ts
/**
 * Workouts as plain JSON: the declarative twin of `buildWorkout`.
 *
 * `buildWorkout` is fluent and takes callbacks, which is ideal from TypeScript and impossible from
 * JSON: a database row, a form post or an LLM tool call cannot contain a function. This module
 * accepts the same workout as data and REPLAYS it through the real builder. There is one encoder,
 * so every builder guard (global stepOrder, pace inversion, one end condition per step, the
 * gradePercent-as-secondary refusal) applies unchanged.
 *
 * It is deliberately stricter than the builder, because its input is not type-checked:
 *  - an unknown key anywhere is an error naming its path, not silently ignored;
 *  - an exercise `name` is checked against the catalogue you pass in. Garmin would otherwise
 *    store an unknown name as "" and report success.
 *
 * The catalogue is a parameter rather than an import so the root bundle keeps carrying none of its
 * ~60 KB. Pass `EXERCISES` from `garminconnect-js/exercises`.
 */
import { GarminError } from "./errors.js";
import {
  WORKOUT_DRILL_TYPE_ID,
  WORKOUT_EQUIPMENT_TYPE_ID,
  WORKOUT_EXERCISE_CATEGORIES,
  WORKOUT_STROKE_TYPE_ID,
} from "./types/workouts.js";
import type { ExerciseCategory, WorkoutInput } from "./types/workouts.js";
import { buildWorkout, WORKOUT_SPORTS } from "./workout-builder.js";
import type {
  DrillKey,
  EquipmentKey,
  StepEnd,
  StepOptions,
  StepTarget,
  StrokeKey,
  WorkoutBuildOptions,
  WorkoutExercise,
  WorkoutSport,
  WorkoutStepList,
} from "./workout-builder.js";

export const SIMPLE_STEP_TYPES = ["warmup", "cooldown", "interval", "recovery", "main", "other", "rest"] as const;
export type SimpleStepType = (typeof SIMPLE_STEP_TYPES)[number];

/** One step: a plain step with builder options, or a block of nested steps. */
export type WorkoutSpecStep =
  | ({ type: SimpleStepType } & StepOptions)
  | { type: "repeat"; times: number; steps: WorkoutSpecStep[] }
  | { type: "repeatForSeconds"; seconds: number; steps: WorkoutSpecStep[] };

export interface WorkoutSpecLeg {
  sport: WorkoutSport;
  steps: WorkoutSpecStep[];
}

/** A whole workout: `steps` for one sport, or `legs` for multi-sport, never both. */
export type WorkoutSpec = { name: string } & WorkoutBuildOptions &
  ({ steps: WorkoutSpecStep[]; legs?: never } | { legs: WorkoutSpecLeg[]; steps?: never });

/** Category -> valid exercise names. Pass `EXERCISES` from `garminconnect-js/exercises`. */
export type ExerciseCatalogue = Readonly<Record<string, readonly string[]>>;

type KeysOfUnion<T> = T extends unknown ? keyof T : never;

// Runtime key lists. `tests/workout-spec.test.ts` pins each to its TypeScript type, so a builder
// option added without being added here fails `npm run typecheck`.
export const SPEC_END_KEYS = [
  "distance", "time", "reps", "lapButton", "restSeconds", "calories", "heartRateBpm", "powerWatts", "fixedRepetition",
] as const satisfies readonly (keyof StepEnd)[];
export const SPEC_STEP_OPTION_KEYS = [
  ...SPEC_END_KEYS, "target", "secondaryTarget", "stroke", "drill", "equipment", "exercise", "weightKg", "notes",
] as const satisfies readonly (keyof StepOptions)[];
export const SPEC_TARGET_KEYS = [
  "pace", "speedMetresPerSecond", "powerZone", "powerWatts", "heartRateZone", "heartRateBpm", "cadence",
  "gradePercent", "resistance", "swimCssOffsetSeconds",
] as const satisfies readonly KeysOfUnion<StepTarget>[];
export const SPEC_TOP_KEYS = [
  "name", "sport", "poolLength", "poolLengthUnit", "sessionTransitionsEnabled", "estimatedDurationInSecs", "steps", "legs",
] as const;

const lower = <T extends string>(o: object) => Object.keys(o).map((k) => k.toLowerCase()) as T[];
export const STROKE_KEYS: readonly StrokeKey[] = lower<StrokeKey>(WORKOUT_STROKE_TYPE_ID);
export const DRILL_KEYS: readonly DrillKey[] = lower<DrillKey>(WORKOUT_DRILL_TYPE_ID);
export const EQUIPMENT_KEYS: readonly EquipmentKey[] = lower<EquipmentKey>(WORKOUT_EQUIPMENT_TYPE_ID);

const STEP_TYPES = [...SIMPLE_STEP_TYPES, "repeat", "repeatForSeconds"] as const;
const NUMERIC_END_KEYS = SPEC_END_KEYS.filter((k) => k !== "lapButton") as Exclude<
  (typeof SPEC_END_KEYS)[number],
  "lapButton"
>[];

/** Keys people (and models) reach for that belong somewhere else. */
const STEP_HINTS: Record<string, string> = {
  ...Object.fromEntries(
    SPEC_TARGET_KEYS.filter((k) => !(SPEC_STEP_OPTION_KEYS as readonly string[]).includes(k)).map((k) => [
      k,
      `target: { ${k}: … }`,
    ]),
  ),
  minPerKm: "target: { pace: { minPerKm: [fast, slow] } }",
  minPerMile: "target: { pace: { minPerMile: [fast, slow] } }",
  duration: "time (seconds)",
  seconds: "time (seconds)",
  meters: "distance (metres)",
  metres: "distance (metres)",
  repetitions: "reps",
  description: "notes",
  note: "notes",
  weight: "weightKg",
  times: 'a block: { type: "repeat", times, steps }',
  steps: 'a block: { type: "repeat", times, steps }',
};
const TOP_HINTS: Record<string, string> = {
  workoutName: "name",
  title: "name",
  sportType: "sport",
  segments: "steps (or legs for multi-sport)",
  workoutSteps: "steps",
};
const REPEAT_HINTS: Record<string, string> = {
  iterations: "times",
  count: "times",
  repeat: "times",
  children: "steps",
  workoutSteps: "steps",
};

type Json = Record<string, unknown>;

/** A spec error already carrying its path, so outer levels do not prefix it again. */
class SpecError extends GarminError {}

function fail(path: string, message: string): never {
  throw new SpecError(`${path}: ${message}`);
}

function show(v: unknown): string {
  if (v === undefined) return "nothing";
  const s = JSON.stringify(v) ?? String(v);
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
}

/** Runs a builder call, prefixing the builder's own GarminError with the spec path. */
function at<T>(path: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof SpecError || !(error instanceof GarminError)) throw error;
    throw new SpecError(`${path}: ${error.message}`, { cause: error });
  }
}

function object(v: unknown, path: string): Json {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(path, `expected an object, got ${show(v)}`);
  return v as Json;
}
function list(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, `expected an array, got ${show(v)}`);
  return v as unknown[];
}
function number(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(path, `expected a number, got ${show(v)}`);
  return v;
}
function text(v: unknown, path: string): string {
  if (typeof v !== "string") fail(path, `expected a string, got ${show(v)}`);
  return v;
}
function flag(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") fail(path, `expected true or false, got ${show(v)}`);
  return v;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    fail(path, `expected one of ${allowed.join(", ")}; got ${show(v)}`);
  }
  return v as T;
}
function pair(v: unknown, path: string): [number, number] {
  const a = list(v, path);
  if (a.length !== 2) fail(path, `expected [low, high], two numbers; got ${show(v)}`);
  return [number(a[0], `${path}[0]`), number(a[1], `${path}[1]`)];
}
function positivePair(v: unknown, path: string): [number, number] {
  const p = pair(v, path);
  if (!(p[0] > 0 && p[1] > 0)) fail(path, `both values must be greater than zero; got ${show(v)}`);
  return p;
}
function zone(v: unknown, path: string): number {
  const n = number(v, path);
  if (!Number.isInteger(n) || n < 1) fail(path, `expected a zone number (1, 2, 3, …), got ${show(v)}`);
  return n;
}
function onlyKeys(o: Json, allowed: readonly string[], path: string, hints: Record<string, string> = {}): void {
  for (const key of Object.keys(o)) {
    if (allowed.includes(key)) continue;
    const hint = Object.hasOwn(hints, key) ? `; did you mean ${hints[key]!}?` : `; allowed: ${allowed.join(", ")}`;
    fail(path, `unknown key "${key}"${hint}`);
  }
}

/** Levenshtein distance. The candidate lists are small (at most a few hundred names). */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(next[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = next;
  }
  return prev[b.length]!;
}

/**
 * Up to `limit` candidates closest to `input`, best first. Case, spaces and punctuation are
 * ignored, so "barbell back squat" finds BARBELL_BACK_SQUAT first.
 */
export function suggest(input: string, candidates: readonly string[], limit = 5): string[] {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const q = norm(input);
  if (!q) return [];
  const words = q.split("_");
  return candidates
    .map((c) => {
      const n = norm(c);
      const parts = n.split("_");
      let score: number;
      if (n === q) score = 0;
      else if (n.includes(q) || q.includes(n)) score = 1 + Math.abs(n.length - q.length) / 1000;
      else if (words.every((w) => parts.includes(w))) score = 2 + parts.length / 1000;
      else score = 3 + distance(q, n) / Math.max(q.length, n.length);
      return { c, score };
    })
    .filter((s) => s.score < 3.5)
    .sort((a, b) => a.score - b.score || a.c.localeCompare(b.c))
    .slice(0, limit)
    .map((s) => s.c);
}

function target(v: unknown, path: string): StepTarget {
  const t = object(v, path);
  const keys = Object.keys(t);
  if (keys.length !== 1) {
    fail(
      path,
      `a target has exactly one key (one of ${SPEC_TARGET_KEYS.join(", ")}); got ${keys.length === 0 ? "none" : keys.join(", ")}`,
    );
  }
  const key = oneOf(keys[0], SPEC_TARGET_KEYS, path);
  const here = `${path}.${key}`;
  const value = t[key];
  switch (key) {
    case "pace": {
      const pace = object(value, here);
      onlyKeys(pace, ["minPerKm", "minPerMile"], here);
      if (("minPerKm" in pace) === ("minPerMile" in pace)) {
        fail(here, 'give exactly one of "minPerKm" or "minPerMile", as [fast, slow] minutes; 4:30 is 4.5');
      }
      return "minPerKm" in pace
        ? { pace: { minPerKm: positivePair(pace["minPerKm"], `${here}.minPerKm`) } }
        : { pace: { minPerMile: positivePair(pace["minPerMile"], `${here}.minPerMile`) } };
    }
    case "powerZone":
      return { powerZone: zone(value, here) };
    case "heartRateZone":
      return { heartRateZone: zone(value, here) };
    case "swimCssOffsetSeconds":
      return { swimCssOffsetSeconds: number(value, here) };
    case "speedMetresPerSecond":
      return { speedMetresPerSecond: pair(value, here) };
    case "powerWatts":
      return { powerWatts: pair(value, here) };
    case "heartRateBpm":
      return { heartRateBpm: pair(value, here) };
    case "cadence":
      return { cadence: pair(value, here) };
    case "gradePercent":
      return { gradePercent: pair(value, here) };
    case "resistance":
      return { resistance: pair(value, here) };
  }
}

function exercise(v: unknown, path: string, exercises: ExerciseCatalogue): WorkoutExercise {
  const e = object(v, path);
  onlyKeys(e, ["category", "name"], path, { exerciseName: "name", exercise: "name" });
  const raw = e["category"];
  if (typeof raw !== "string" || !(WORKOUT_EXERCISE_CATEGORIES as readonly string[]).includes(raw)) {
    const close = typeof raw === "string" ? suggest(raw, WORKOUT_EXERCISE_CATEGORIES) : [];
    fail(`${path}.category`, `${show(raw)} is not an exercise category${close.length ? `; closest: ${close.join(", ")}` : ""}`);
  }
  const category = raw as ExerciseCategory;
  if (e["name"] === undefined) return { category } as WorkoutExercise;
  const name = text(e["name"], `${path}.name`);
  const names = Object.hasOwn(exercises, category) ? (exercises[category] ?? []) : [];
  if (names.length === 0) fail(`${path}.name`, `category ${category} has no named exercises; omit "name"`);
  if (!names.includes(name)) {
    const close = suggest(name, names);
    fail(`${path}.name`, `"${name}" is not an exercise in ${category}${close.length ? `; closest: ${close.join(", ")}` : ""}`);
  }
  return { category, name } as unknown as WorkoutExercise;
}

function stepOptions(step: Json, path: string, exercises: ExerciseCatalogue): StepOptions {
  const o: StepOptions = {};
  for (const key of NUMERIC_END_KEYS) {
    if (step[key] !== undefined) o[key] = number(step[key], `${path}.${key}`);
  }
  if (step["lapButton"] !== undefined) o.lapButton = flag(step["lapButton"], `${path}.lapButton`);
  if (step["target"] !== undefined) o.target = target(step["target"], `${path}.target`);
  if (step["secondaryTarget"] !== undefined) {
    o.secondaryTarget = target(step["secondaryTarget"], `${path}.secondaryTarget`);
  }
  if (step["stroke"] !== undefined) o.stroke = oneOf(step["stroke"], STROKE_KEYS, `${path}.stroke`);
  if (step["drill"] !== undefined) o.drill = oneOf(step["drill"], DRILL_KEYS, `${path}.drill`);
  if (step["equipment"] !== undefined) o.equipment = oneOf(step["equipment"], EQUIPMENT_KEYS, `${path}.equipment`);
  if (step["exercise"] !== undefined) o.exercise = exercise(step["exercise"], `${path}.exercise`, exercises);
  if (step["weightKg"] !== undefined) o.weightKg = number(step["weightKg"], `${path}.weightKg`);
  if (step["notes"] !== undefined) o.notes = text(step["notes"], `${path}.notes`);
  return o;
}

function addSteps(block: WorkoutStepList, steps: unknown[], path: string, exercises: ExerciseCatalogue): void {
  steps.forEach((raw, i) => {
    const here = `${path}[${i}]`;
    const step = object(raw, here);
    const type = oneOf(step["type"], STEP_TYPES, `${here}.type`);
    if (type === "repeat" || type === "repeatForSeconds") {
      const countKey = type === "repeat" ? "times" : "seconds";
      onlyKeys(step, ["type", countKey, "steps"], here, REPEAT_HINTS);
      const count = number(step[countKey], `${here}.${countKey}`);
      const children = list(step["steps"], `${here}.steps`);
      const fill = (inner: WorkoutStepList) => addSteps(inner, children, `${here}.steps`, exercises);
      at(here, () => (type === "repeat" ? block.repeat(count, fill) : block.repeatForSeconds(count, fill)));
      return;
    }
    onlyKeys(step, ["type", ...SPEC_STEP_OPTION_KEYS], here, STEP_HINTS);
    const options = stepOptions(step, here, exercises);
    at(here, () => block[type](options));
  });
}

/**
 * Build a workout from JSON. The result goes straight to `uploadWorkout`.
 *
 * @example
 * ```ts
 * import { workoutFromSpec } from "garminconnect-js";
 * import { EXERCISES } from "garminconnect-js/exercises";
 *
 * const workout = workoutFromSpec(
 *   { name: "Tempo", sport: "running", steps: [{ type: "interval", time: 1200, target: { pace: { minPerKm: [4.5, 4.7] } } }] },
 *   EXERCISES,
 * );
 * await garmin.uploadWorkout(workout);
 * ```
 *
 * @throws GarminError with a message of the form `workout.steps[1].target: …` naming what is wrong.
 */
export function workoutFromSpec(spec: unknown, exercises: ExerciseCatalogue): WorkoutInput {
  const top = object(spec, "workout");
  onlyKeys(top, SPEC_TOP_KEYS, "workout", TOP_HINTS);
  const name = text(top["name"], "workout.name");
  const options: WorkoutBuildOptions = { sport: oneOf(top["sport"], WORKOUT_SPORTS, "workout.sport") };
  if (top["poolLength"] !== undefined) options.poolLength = number(top["poolLength"], "workout.poolLength");
  if (top["poolLengthUnit"] !== undefined) {
    options.poolLengthUnit = oneOf(top["poolLengthUnit"], ["meter", "yard"] as const, "workout.poolLengthUnit");
  }
  if (top["sessionTransitionsEnabled"] !== undefined) {
    options.sessionTransitionsEnabled = flag(top["sessionTransitionsEnabled"], "workout.sessionTransitionsEnabled");
  }
  if (top["estimatedDurationInSecs"] !== undefined) {
    options.estimatedDurationInSecs = number(top["estimatedDurationInSecs"], "workout.estimatedDurationInSecs");
  }

  const hasSteps = top["steps"] !== undefined;
  const hasLegs = top["legs"] !== undefined;
  if (hasSteps === hasLegs) {
    fail("workout", 'give exactly one of "steps" (a single-sport workout) or "legs" (multi-sport)');
  }

  const builder = at("workout", () => buildWorkout(name, options));
  if (hasSteps) {
    addSteps(builder, list(top["steps"], "workout.steps"), "workout.steps", exercises);
  } else {
    list(top["legs"], "workout.legs").forEach((raw, i) => {
      const path = `workout.legs[${i}]`;
      const leg = object(raw, path);
      onlyKeys(leg, ["sport", "steps"], path);
      const sport = oneOf(leg["sport"], WORKOUT_SPORTS, `${path}.sport`);
      const steps = list(leg["steps"], `${path}.steps`);
      at(path, () => builder.leg(sport, (block) => addSteps(block, steps, `${path}.steps`, exercises)));
    });
  }
  return at("workout", () => builder.build());
}
```

Note: `WORKOUT_SPORTS` includes `multi_sport`, and the builder refuses a leg whose sport is multi-sport only indirectly. That's fine: `workout.legs[0].sport` accepts any `WorkoutSport`, the same as `builder.leg()`.

- [ ] **Step 9: Export from the package root**

In `src/index.ts`, change the builder export line and add the spec exports right after the builder type exports:

```ts
export { buildWorkout, WorkoutBuilder, WorkoutStepList, WORKOUT_SPORTS } from "./workout-builder.js";
```

```ts
/**
 * JSON twin of `buildWorkout`: a workout as data, replayed through the builder. Pass `EXERCISES`
 * from `garminconnect-js/exercises` as the catalogue. See `src/workout-spec.ts`.
 */
export { workoutFromSpec } from "./workout-spec.js";
export type {
  WorkoutSpec,
  WorkoutSpecStep,
  WorkoutSpecLeg,
  SimpleStepType,
  ExerciseCatalogue,
} from "./workout-spec.js";
```

- [ ] **Step 10: Run tests and typecheck**

Run: `npx vitest run tests/workout-spec.test.ts tests/workout-builder.test.ts && npm run typecheck`
Expected: all PASS and typecheck clean. If `Equal<...>` fails typecheck, a key list has drifted from its type. Fix the list, not the test.

- [ ] **Step 11: Changelog and full check**

Under `## [Unreleased]` in `CHANGELOG.md` add:

```markdown
### Added

- **`workoutFromSpec(spec, EXERCISES)`**: build a workout from plain JSON (a database row, a form,
  an LLM tool call). It is replayed through `buildWorkout`, so every builder guard applies, and it
  is stricter than the builder: unknown keys and unknown exercise names are rejected with the JSON
  path and the closest valid names. `WORKOUT_SPORTS` is exported alongside it.

### Fixed

- **A reversed pace range is no longer stored backwards.** `target: { pace: { minPerKm: [5, 4.5] } }`
  put the slower speed first; both orders now store the faster speed in `targetValueOne`.
```

Run: `npm run check`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/workout-builder.ts src/workout-spec.ts src/index.ts tests/fixtures/workout-specs.ts tests/workout-spec.test.ts tests/workout-builder.test.ts CHANGELOG.md
git commit -m "feat: workoutFromSpec builds workouts from JSON; reversed pace ranges stored correctly"
git push
```

---

### Task 2: `WORKOUT_SPEC_JSON_SCHEMA`

**Files:**
- Create: `src/workout-spec-schema.ts`
- Modify: `src/index.ts`
- Create: `tests/workout-spec-schema.test.ts`
- Modify: `package.json` (devDependency `ajv`)
- Modify: `AGENTS.md` (new subsection after the `buildWorkout` section of §3), `WORKOUTS.md` (new section), `CHANGELOG.md`

**Interfaces:**
- Consumes: `SIMPLE_STEP_TYPES`, `SPEC_STEP_OPTION_KEYS`, `SPEC_TARGET_KEYS`, `STROKE_KEYS`, `DRILL_KEYS`, `EQUIPMENT_KEYS` from `src/workout-spec.ts`; `WORKOUT_SPORTS`; `WORKOUT_EXERCISE_CATEGORIES`.
- Produces: `WORKOUT_SPEC_JSON_SCHEMA: JsonSchemaDocument` and `interface JsonSchemaDocument { $schema: string; $defs: Record<string, unknown>; [key: string]: unknown }`, exported from the package root. All internal references are `#/$defs/<name>`, with defs `step`, `simpleStep`, `repeat`, `repeatForSeconds`, `leg`, `target`, `exercise`. The root has `type: "object"` and **no top-level `oneOf`/`anyOf`/`allOf`**, because the Claude API rejects those at the root of a tool schema.

- [ ] **Step 1: Add ajv (dev only)**

Run: `npm install --save-dev ajv@^8.20.0`
Expected: `package.json` gains `"ajv"` under `devDependencies`, and `dependencies` stays `{}`.

- [ ] **Step 2: Write the failing schema tests**

Create `tests/workout-spec-schema.test.ts`:

```ts
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { WORKOUT_EXERCISE_CATEGORIES } from "../src/types/workouts.js";
import { WORKOUT_SPORTS } from "../src/workout-builder.js";
import { WORKOUT_SPEC_JSON_SCHEMA } from "../src/workout-spec-schema.js";
import { SPEC_STEP_OPTION_KEYS } from "../src/workout-spec.js";
import { SPEC_FIXTURES } from "./fixtures/workout-specs.js";

const validate = new Ajv2020({ allErrors: true }).compile(WORKOUT_SPEC_JSON_SCHEMA);
const running = (steps: unknown[]) => ({ name: "x", sport: "running", steps });

describe("WORKOUT_SPEC_JSON_SCHEMA", () => {
  for (const [name, fixture] of Object.entries(SPEC_FIXTURES)) {
    it(`accepts the ${name} fixture`, () => {
      expect(validate(fixture.spec), JSON.stringify(validate.errors)).toBe(true);
    });
  }

  it("rejects an unknown step key", () => {
    expect(validate(running([{ type: "interval", time: 60, pace: 5 }]))).toBe(false);
  });

  it("rejects a target with two keys", () => {
    expect(validate(running([{ type: "interval", time: 60, target: { powerZone: 1, cadence: [1, 2] } }]))).toBe(false);
  });

  it("rejects a step without a type", () => {
    expect(validate(running([{ time: 60 }]))).toBe(false);
  });

  it("is derived from the library's own constants", () => {
    const defs = WORKOUT_SPEC_JSON_SCHEMA.$defs as Record<string, { properties: Record<string, { enum?: unknown[] }> }>;
    expect((WORKOUT_SPEC_JSON_SCHEMA.properties as Record<string, { enum: unknown[] }>).sport.enum).toEqual([...WORKOUT_SPORTS]);
    expect(defs.exercise!.properties.category!.enum).toEqual([...WORKOUT_EXERCISE_CATEGORIES]);
    expect(Object.keys(defs.simpleStep!.properties).sort()).toEqual(["type", ...SPEC_STEP_OPTION_KEYS].sort());
  });

  it("keeps the root usable as a tool input schema", () => {
    expect(WORKOUT_SPEC_JSON_SCHEMA.type).toBe("object");
    for (const k of ["oneOf", "anyOf", "allOf"]) expect(WORKOUT_SPEC_JSON_SCHEMA).not.toHaveProperty(k);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run tests/workout-spec-schema.test.ts`
Expected: FAIL (module `../src/workout-spec-schema.js` not found).

- [ ] **Step 4: Implement `src/workout-spec-schema.ts`**

```ts
/**
 * JSON Schema (draft 2020-12) for `workoutFromSpec`'s input.
 *
 * BUILT from the same constants the builder and `workoutFromSpec` use (sports, strokes, drills,
 * equipment, exercise categories, step option keys), never hand-listed, so it cannot drift from
 * them. The `Record<…>` tables below are exhaustive over the key lists, so a new step option or
 * target fails `tsc` until it is described here.
 *
 * Exercise NAMES are deliberately absent: 1830 of them would cost ~40 KB wherever this schema is
 * shown to a model. `workoutFromSpec` checks names at runtime instead.
 *
 * The root has no oneOf/anyOf/allOf: the Claude API rejects those at the top level of a tool's
 * input schema. "Exactly one of steps or legs" is enforced by `workoutFromSpec`.
 */
import { WORKOUT_EXERCISE_CATEGORIES } from "./types/workouts.js";
import { WORKOUT_SPORTS } from "./workout-builder.js";
import {
  DRILL_KEYS,
  EQUIPMENT_KEYS,
  SIMPLE_STEP_TYPES,
  SPEC_STEP_OPTION_KEYS,
  SPEC_TARGET_KEYS,
  STROKE_KEYS,
} from "./workout-spec.js";

export interface JsonSchemaDocument {
  $schema: string;
  $defs: Record<string, unknown>;
  [key: string]: unknown;
}

const positive = (description: string) => ({ type: "number", exclusiveMinimum: 0, description });
const range = (description: string) => ({ type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description });
const stepList = { type: "array", minItems: 1, items: { $ref: "#/$defs/step" } };

const TARGETS: Record<(typeof SPEC_TARGET_KEYS)[number], object> = {
  pace: {
    type: "object",
    description:
      "Pace range as [fast, slow] minutes, in decimals (4:30 is 4.5). Give exactly one of minPerKm or minPerMile.",
    properties: {
      minPerKm: range("e.g. [4.5, 5] = 4:30–5:00 per km"),
      minPerMile: range("e.g. [8.5, 9.5] = 8:30–9:30 per mile"),
    },
    minProperties: 1,
    maxProperties: 1,
    additionalProperties: false,
  },
  speedMetresPerSecond: range("Speed range in metres per second"),
  powerZone: { type: "integer", minimum: 1, description: "One of the user's configured power zones" },
  powerWatts: range("Power range in watts"),
  heartRateZone: { type: "integer", minimum: 1, description: "One of the user's configured heart-rate zones" },
  heartRateBpm: range("Heart-rate range in beats per minute"),
  cadence: range("Cadence range: rpm on a bike, steps per minute running"),
  gradePercent: range("Incline range in percent. Primary target only; rejected as a secondaryTarget"),
  resistance: range("Trainer resistance range"),
  swimCssOffsetSeconds: { type: "number", description: "Swim: seconds per 100 relative to critical swim speed" },
};

const STEP_PROPERTIES: Record<(typeof SPEC_STEP_OPTION_KEYS)[number], object> = {
  distance: positive("End after this many metres"),
  time: positive("End after this many seconds"),
  reps: { type: "integer", minimum: 1, description: "End after this many repetitions (strength, HIIT)" },
  lapButton: { type: "boolean", const: true, description: "End when the user presses lap" },
  restSeconds: positive("A fixed rest of this many seconds (use on rest steps)"),
  calories: positive("End after this many kilocalories"),
  heartRateBpm: positive("End when heart rate reaches this many bpm"),
  powerWatts: positive("End when power reaches this many watts"),
  fixedRepetition: { type: "integer", minimum: 1, description: "Swim: end after this many pool lengths" },
  target: { $ref: "#/$defs/target" },
  secondaryTarget: {
    $ref: "#/$defs/target",
    description: "A second simultaneous target, e.g. a power zone plus a cadence range. gradePercent is not allowed here.",
  },
  stroke: { enum: STROKE_KEYS, description: "Swim stroke" },
  drill: { enum: DRILL_KEYS, description: "Swim drill" },
  equipment: { enum: EQUIPMENT_KEYS, description: "Swim equipment" },
  exercise: { $ref: "#/$defs/exercise" },
  weightKg: positive("Weight in kilograms (strength)"),
  notes: { type: "string", description: "Free text shown on the watch" },
};

export const WORKOUT_SPEC_JSON_SCHEMA: JsonSchemaDocument = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "WorkoutSpec",
  description:
    "A Garmin workout. Give `steps` for one sport, or `legs` (each with its own sport) for a multi-sport workout, not both. " +
    "Distances are metres, times seconds.",
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    sport: { enum: WORKOUT_SPORTS, description: "Use multi_sport together with legs" },
    poolLength: positive("Swim: pool length, in poolLengthUnit"),
    poolLengthUnit: { enum: ["meter", "yard"] },
    sessionTransitionsEnabled: { type: "boolean", description: "Multi-sport: record transitions between legs" },
    estimatedDurationInSecs: { type: "number", minimum: 0 },
    steps: stepList,
    legs: { type: "array", minItems: 1, items: { $ref: "#/$defs/leg" } },
  },
  required: ["name", "sport"],
  additionalProperties: false,
  $defs: {
    step: {
      oneOf: [{ $ref: "#/$defs/simpleStep" }, { $ref: "#/$defs/repeat" }, { $ref: "#/$defs/repeatForSeconds" }],
    },
    simpleStep: {
      type: "object",
      description:
        "One step. Give exactly ONE end condition: distance, time, reps, lapButton, restSeconds, calories, " +
        "heartRateBpm, powerWatts or fixedRepetition.",
      properties: { type: { enum: SIMPLE_STEP_TYPES }, ...STEP_PROPERTIES },
      required: ["type"],
      additionalProperties: false,
    },
    repeat: {
      type: "object",
      description: "Repeat the nested steps a number of times",
      properties: { type: { const: "repeat" }, times: { type: "integer", minimum: 1 }, steps: stepList },
      required: ["type", "times", "steps"],
      additionalProperties: false,
    },
    repeatForSeconds: {
      type: "object",
      description: "Keep repeating the nested steps until this much time has passed",
      properties: { type: { const: "repeatForSeconds" }, seconds: positive("Total seconds"), steps: stepList },
      required: ["type", "seconds", "steps"],
      additionalProperties: false,
    },
    leg: {
      type: "object",
      properties: { sport: { enum: WORKOUT_SPORTS.filter((s) => s !== "multi_sport") }, steps: stepList },
      required: ["sport", "steps"],
      additionalProperties: false,
    },
    target: {
      type: "object",
      description: "Exactly one key",
      properties: TARGETS,
      minProperties: 1,
      maxProperties: 1,
      additionalProperties: false,
    },
    exercise: {
      type: "object",
      properties: {
        category: { enum: WORKOUT_EXERCISE_CATEGORIES },
        name: {
          type: "string",
          description:
            "Garmin's exercise key in SCREAMING_SNAKE_CASE, e.g. BARBELL_BACK_SQUAT. Look it up with search_exercises; " +
            "an unknown name is rejected. Omit it to use the category alone.",
        },
      },
      required: ["category"],
      additionalProperties: false,
    },
  },
};
```

- [ ] **Step 5: Export it**

In `src/index.ts`, after the `workoutFromSpec` export add:

```ts
export { WORKOUT_SPEC_JSON_SCHEMA, type JsonSchemaDocument } from "./workout-spec-schema.js";
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/workout-spec-schema.test.ts`
Expected: PASS. If ajv reports `strict mode` errors about a keyword, switch the constructor to `new Ajv2020({ allErrors: true, strict: false })` and note why in a comment. Do NOT change the schema to silence a warning.

- [ ] **Step 7: Document it**

In `AGENTS.md` §3, directly after the `buildWorkout` subsection ends (before `## 4.`), add:

````markdown
### `workoutFromSpec` (src/workout-spec.ts): workouts as JSON

**NOT upstream parity**, and not a `Garmin` method. It's the JSON twin of `buildWorkout`, for input
that cannot hold callbacks: a database row, a form, an LLM tool call.

```ts
import { workoutFromSpec } from "garminconnect-js";
import { EXERCISES } from "garminconnect-js/exercises";

const workout = workoutFromSpec(
  {
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
  },
  EXERCISES, // REQUIRED: the catalogue is a parameter so the root bundle stays free of it
);
await garmin.uploadWorkout(workout);
```

- A step is `{ type, ...StepOptions }` with `type` one of `warmup cooldown interval recovery main
  other rest`, or a block: `{ type: "repeat", times, steps }` / `{ type: "repeatForSeconds",
  seconds, steps }`. Multi-sport uses `legs: [{ sport, steps }]` instead of `steps`.
- It REPLAYS the spec through the real builder, so every builder guard applies.
- It is STRICTER than the builder: unknown keys throw with the JSON path
  (`workout.steps[1].steps[0]: unknown key "pace"; did you mean target: { pace: … }?`), and an
  exercise name missing from the catalogue throws with the closest valid names. Garmin itself
  would store it as `""`.
- `WORKOUT_SPEC_JSON_SCHEMA` (draft 2020-12) describes the input. It's built from the same
  constants, so it follows the library, and it leaves exercise names out on purpose (runtime check
  instead). Its root has no `oneOf`, so it's usable as a tool input schema.
````

In `WORKOUTS.md`, add a final section:

````markdown
## From JSON

When a workout arrives as data (from a database, a form, or an AI assistant), use
`workoutFromSpec` instead of the fluent builder. It takes the same options, as JSON, and runs
them through the same builder:

```ts
import { workoutFromSpec } from "garminconnect-js";
import { EXERCISES } from "garminconnect-js/exercises";

const workout = workoutFromSpec(
  {
    name: "Legs",
    sport: "strength_training",
    steps: [
      { type: "warmup", time: 300 },
      { type: "repeat", times: 3, steps: [
        { type: "interval", reps: 8, exercise: { category: "SQUAT", name: "BARBELL_BACK_SQUAT" }, weightKg: 60 },
        { type: "rest", restSeconds: 90 },
      ] },
    ],
  },
  EXERCISES,
);
```

Mistakes are reported with where they are, e.g.
`workout.steps[1].steps[0].exercise.name: "Barbell Back Squat" is not an exercise in SQUAT; closest: BARBELL_BACK_SQUAT`.
`WORKOUT_SPEC_JSON_SCHEMA` is the matching JSON Schema.
````

Add to `CHANGELOG.md` under `### Added` (Unreleased):

```markdown
- **`WORKOUT_SPEC_JSON_SCHEMA`**: the JSON Schema for `workoutFromSpec`'s input, built from the
  library's own constants so it follows every release.
```

- [ ] **Step 8: Full check**

Run: `npm run check`
Expected: PASS. That includes `tests/dist.test.ts`, which confirms the new value exports exist in both bundles, and `tests/doc-links.test.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/workout-spec-schema.ts src/index.ts tests/workout-spec-schema.test.ts package.json package-lock.json AGENTS.md WORKOUTS.md CHANGELOG.md
git commit -m "feat: WORKOUT_SPEC_JSON_SCHEMA, derived from the builder's constants"
git push
```

---

### Task 3: The method manifest (`garminconnect-js/manifest`)

**Files:**
- Create: `scripts/lib/garmin-source.ts` (moved code)
- Modify: `scripts/generate-api-docs.ts` (import the moved code instead of defining it)
- Create: `src/manifest.ts`
- Create: `scripts/generate-manifest.ts`
- Create (generated): `src/generated/manifest.ts`
- Create: `.prettierignore`
- Create: `tests/manifest.test.ts`
- Modify: `package.json` (`exports["./manifest"]`, `typesVersions`, `scripts.manifest`), `tsup.config.ts` (entry), `tests/build.test.ts` (subpath loop)
- Modify: `AGENTS.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `parseGarminClass(): { name; params; service }[]`, `parseAgentsTable(): Map<string, { signature; notes; verified }>`, `stripParityChatter(notes: string): string`, `CATEGORIES: Record<string, { slug; title; blurb }>` (moved in Step 1).
- Produces (`src/manifest.ts`, published as `garminconnect-js/manifest`):
  ```ts
  export type JsonSchema = { [key: string]: unknown };
  export type Safety = "read" | "write" | "destructive";
  export interface ManifestParam { name: string; optional: boolean; schema: JsonSchema; role?: "file" | "filename" }
  export interface ManifestMethod {
    name: string; category: string; description: string;
    params: ManifestParam[]; safety: Safety; io: "json" | "binary-in" | "binary-out";
  }
  export const GARMIN_METHODS: readonly ManifestMethod[];
  ```
  `category` is the docs:api slug: `wellness`, `activities`, `metrics`, `workouts`, `gear`, `courses`, `devices`, `badges-challenges`, `body-composition-weight`, `womens-health`, `golf`, `profile-and-misc`.
- Produces (`scripts/generate-manifest.ts`): `buildManifest(): ManifestMethod[]`, `renderManifest(m: ManifestMethod[]): string`, `classify(name: string): Safety`, `typeToSchema(type: ts.Type, checker: ts.TypeChecker, where: string): JsonSchema`, `MANIFEST_PATH: string`.

- [ ] **Step 1: Move the shared parsing into `scripts/lib/garmin-source.ts`**

Create `scripts/lib/garmin-source.ts` with this header:

```ts
/**
 * Parsing shared by the generators that read the library's own source: `generate-api-docs.ts`
 * (docs/api pages) and `generate-manifest.ts` (the method manifest). One copy, so the two cannot
 * disagree about which category a method belongs to or what its notes say.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
```

Then **cut** these four declarations from `scripts/generate-api-docs.ts` and paste them into this file unchanged, adding `export` to each: `const CATEGORIES`, `function parseGarminClass`, `function parseAgentsTable`, `function stripParityChatter`. Their bodies use `ROOT`, `path` and `readFileSync`, which the header above provides.

In `scripts/generate-api-docs.ts`, add:

```ts
import { CATEGORIES, parseAgentsTable, parseGarminClass, stripParityChatter } from "./lib/garmin-source.js";
```

Remove any imports there that are now unused, because lint will flag them.

- [ ] **Step 2: Prove the move changed nothing**

Run: `npx vitest run tests/api-docs.test.ts && npm run lint`
Expected: PASS. The generated pages are byte-identical.

- [ ] **Step 3: Create the manifest types entry point**

Create `src/manifest.ts`:

```ts
/**
 * A machine-readable description of every `Garmin` method, for tools generated FROM this library
 * (the `garminconnect-mcp` server is one): parameters as JSON Schema, a safety class, and whether
 * the method takes or returns a file.
 *
 * Published as the `garminconnect-js/manifest` subpath. The data is GENERATED from `src/garmin.ts`
 * by `scripts/generate-manifest.ts`, and `tests/manifest.test.ts` fails if it is stale, so a
 * signature change cannot ship without the manifest following it.
 *
 * Return types are intentionally not described: they are wide, mostly index-signature types.
 */
export type JsonSchema = { [key: string]: unknown };

/** `read` changes nothing; `destructive` deletes or overwrites; `write` is everything else. */
export type Safety = "read" | "write" | "destructive";

export interface ManifestParam {
  name: string;
  optional: boolean;
  schema: JsonSchema;
  /** `file` is a `Blob` argument; `filename` is the name that travels with it. */
  role?: "file" | "filename";
}

export interface ManifestMethod {
  name: string;
  category: string;
  description: string;
  params: ManifestParam[];
  safety: Safety;
  /** `binary-in` takes a file (a `file` param); `binary-out` resolves to a `Buffer`. */
  io: "json" | "binary-in" | "binary-out";
}

export { GARMIN_METHODS } from "./generated/manifest.js";
```

- [ ] **Step 4: Write the failing manifest tests**

Create `tests/manifest.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { buildManifest, classify, MANIFEST_PATH, renderManifest, typeToSchema } from "../scripts/generate-manifest.js";
import { Garmin } from "../src/garmin.js";
import { GARMIN_METHODS } from "../src/manifest.js";

const byName = new Map(GARMIN_METHODS.map((m) => [m.name, m]));
const method = (name: string) => {
  const m = byName.get(name);
  if (!m) throw new Error(`manifest has no ${name}`);
  return m;
};
const garminMethodNames = () =>
  Object.getOwnPropertyNames(Garmin.prototype).filter(
    (n) => n !== "constructor" && typeof Object.getOwnPropertyDescriptor(Garmin.prototype, n)?.value === "function",
  );

/** Compiles a snippet in memory and returns the type of its first type alias. */
function typeOf(source: string): { type: ts.Type; checker: ts.TypeChecker } {
  const file = "fixture.ts";
  const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, ...rest) =>
    name === file ? ts.createSourceFile(file, source, lang) : original(name, lang, ...rest);
  const program = ts.createProgram([file], options, host);
  const alias = program.getSourceFile(file)!.statements.find(ts.isTypeAliasDeclaration)!;
  const checker = program.getTypeChecker();
  return { type: checker.getTypeAtLocation(alias.name), checker };
}

describe("method manifest", () => {
  it("matches what is committed: run `npm run manifest` if this fails", () => {
    expect(existsSync(MANIFEST_PATH), "src/generated/manifest.ts is missing").toBe(true);
    const committed = readFileSync(MANIFEST_PATH, "utf8").replace(/\r\n/g, "\n");
    expect(committed === renderManifest(buildManifest()), "src/generated/manifest.ts is stale. Run `npm run manifest` and commit.").toBe(true);
  }, 120_000);

  it("describes every Garmin method exactly once", () => {
    expect([...byName.keys()].sort()).toEqual(garminMethodNames().sort());
    expect(GARMIN_METHODS).toHaveLength(byName.size);
  });

  it("classifies safety", () => {
    expect(method("getSleepData").safety).toBe("read");
    expect(method("displayName").safety).toBe("read");
    expect(method("scheduleWorkout").safety).toBe("write");
    expect(method("deleteGear").safety).toBe("destructive");
    expect(method("deleteWeighIns").safety).toBe("destructive");
    expect(method("unscheduleWorkout").safety).toBe("destructive");
    expect(method("updateMenstrualDailyLog").safety).toBe("destructive");
    expect(method("logout").safety).toBe("destructive");
  });

  it("maps parameter types to JSON Schema", () => {
    expect(method("getSleepData").params).toEqual([
      { name: "cdate", optional: false, schema: expect.objectContaining({ type: "string", format: "date" }) },
    ]);
    expect(method("getActivity").params[0]!.schema).toMatchObject({ type: ["integer", "string"] });
    expect(method("downloadActivity").params[1]).toMatchObject({
      name: "format",
      optional: true,
      schema: { type: "string", enum: expect.arrayContaining(["ORIGINAL", "GPX", "TCX"]) },
    });
    expect(method("getGoals").params[0]!.schema).toMatchObject({ enum: expect.arrayContaining(["active", "future", "past"]) });
    expect(method("createCourse").params[0]!.schema).toMatchObject({ type: "object", required: expect.arrayContaining(["name"]) });
  });

  it("marks file inputs and outputs", () => {
    expect(method("importActivity").io).toBe("binary-in");
    expect(method("importActivity").params.map((p) => p.role)).toEqual(["file", "filename"]);
    expect(method("downloadWorkout").io).toBe("binary-out");
    expect(method("getSleepData").io).toBe("json");
  });

  it("gives every method a non-empty, bounded description", () => {
    for (const m of GARMIN_METHODS) {
      expect(m.description.length, m.name).toBeGreaterThan(0);
      expect(m.description.length, m.name).toBeLessThanOrEqual(600);
    }
  });

  it("refuses to guess a safety class", () => {
    expect(() => classify("frobnicateThing")).toThrow(/SAFETY_OVERRIDES/);
  });

  it("refuses a type with no JSON Schema equivalent", () => {
    const { type, checker } = typeOf("type T = Map<string, number>;");
    expect(() => typeToSchema(type, checker, "fixture")).toThrow(/cannot map/);
  });

  it("maps a recursive type without looping", () => {
    const { type, checker } = typeOf("type Node = { value: number; children: Node[] };");
    expect(typeToSchema(type, checker, "fixture")).toMatchObject({ type: "object", properties: { value: { type: "number" } } });
  });
});
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `npx vitest run tests/manifest.test.ts`
Expected: FAIL (cannot find `../scripts/generate-manifest.js`).

- [ ] **Step 6: Implement `scripts/generate-manifest.ts`**

```ts
/**
 * Generates `src/generated/manifest.ts`: a machine-readable description of every `Garmin` method.
 *
 *   npm run manifest            # write the file
 *   npm run manifest -- --check # exit 1 if it is out of date
 *
 * It exists so tools built ON this library (the MCP server in `mcp/`) are generated from it rather
 * than hand-maintained. Types come from the TypeScript compiler, not regexes, so a parameter's
 * schema is read exactly the way `tsc` reads its declaration. TypeScript is a devDependency; this
 * runs at build time only and adds nothing to the published package's dependencies.
 *
 * Two things FAIL the run rather than guess, because both need a human decision:
 *  - a method whose name fits no safety rule (add it to SAFETY_OVERRIDES);
 *  - a parameter type with no JSON Schema equivalent.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { JsonSchema, ManifestMethod, ManifestParam, Safety } from "../src/manifest.js";
import { CATEGORIES, parseAgentsTable, parseGarminClass, stripParityChatter } from "./lib/garmin-source.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GARMIN_TS = path.join(ROOT, "src", "garmin.ts");
export const MANIFEST_PATH = path.join(ROOT, "src", "generated", "manifest.ts");
const MAX_DESCRIPTION = 600;

const READ_PREFIXES = ["get", "list", "count", "download"];
const DESTRUCTIVE_PREFIXES = ["delete", "unschedule"];
const WRITE_PREFIXES = [
  "set", "add", "create", "import", "upload", "update", "remove", "push", "schedule", "init", "confirm", "request", "query",
];

/** Exceptions to the prefix rules, each with its reason. */
export const SAFETY_OVERRIDES: Readonly<Record<string, Safety>> = {
  // Cached accessors over getUserProfile/getUserSettings: no prefix, pure reads.
  displayName: "read",
  fullName: "read",
  userName: "read",
  unitSystem: "read",
  // Deletes the saved login.
  logout: "destructive",
  // FULL REPLACE, not a merge: whatever is stored for that day/activity is overwritten.
  updateMenstrualDailyLog: "destructive",
  updateMenstrualCalendar: "destructive",
  setActivityExerciseSets: "destructive",
};

export function classify(name: string): Safety {
  if (Object.hasOwn(SAFETY_OVERRIDES, name)) return SAFETY_OVERRIDES[name]!;
  const has = (prefixes: string[]) => prefixes.some((p) => name.startsWith(p) && /^[A-Z]/.test(name.slice(p.length)));
  if (has(READ_PREFIXES)) return "read";
  if (has(DESTRUCTIVE_PREFIXES)) return "destructive";
  if (has(WRITE_PREFIXES)) return "write";
  throw new Error(
    `generate-manifest: cannot classify "${name}" as read, write or destructive. ` +
      "Add it to SAFETY_OVERRIDES in scripts/generate-manifest.ts.",
  );
}

const NULLISH = ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void;
const DATE: JsonSchema = { type: "string", format: "date", description: "Calendar date, YYYY-MM-DD (UTC)" };
const isNamed = (t: ts.Type, name: string) => t.getSymbol()?.getName() === name;

function unmappable(type: ts.Type, checker: ts.TypeChecker, where: string): Error {
  return new Error(`generate-manifest: ${where}: cannot map type "${checker.typeToString(type)}" to JSON Schema`);
}

export function typeToSchema(
  type: ts.Type,
  checker: ts.TypeChecker,
  where: string,
  seen: ReadonlySet<ts.Type> = new Set(),
): JsonSchema {
  if (type.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) return { description: "Any JSON value" };
  if (type.isUnion()) return unionToSchema(type, checker, where, seen);
  if (type.flags & ts.TypeFlags.StringLiteral) return { type: "string", enum: [(type as ts.StringLiteralType).value] };
  if (type.flags & ts.TypeFlags.NumberLiteral) return { type: "number", enum: [(type as ts.NumberLiteralType).value] };
  if (type.flags & ts.TypeFlags.BooleanLiteral) return { type: "boolean" };
  if (type.flags & ts.TypeFlags.String) return { type: "string" };
  if (type.flags & ts.TypeFlags.Number) return { type: "number" };
  if (type.flags & ts.TypeFlags.Boolean) return { type: "boolean" };
  if (isNamed(type, "Date")) return DATE;
  if (checker.isTupleType(type)) {
    const items = checker
      .getTypeArguments(type as ts.TypeReference)
      .map((t, i) => typeToSchema(t, checker, `${where}[${i}]`, seen));
    return { type: "array", prefixItems: items, minItems: items.length, maxItems: items.length };
  }
  if (checker.isArrayType(type)) {
    const [item] = checker.getTypeArguments(type as ts.TypeReference);
    return { type: "array", items: typeToSchema(item!, checker, `${where}[]`, seen) };
  }
  if (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) return objectToSchema(type, checker, where, seen);
  throw unmappable(type, checker, where);
}

function unionToSchema(type: ts.UnionType, checker: ts.TypeChecker, where: string, seen: ReadonlySet<ts.Type>): JsonSchema {
  const parts = type.types.filter((t) => !(t.flags & NULLISH));
  if (parts.length === 0) throw unmappable(type, checker, where);
  if (parts.every((t) => t.flags & ts.TypeFlags.StringLiteral)) {
    return { type: "string", enum: parts.map((t) => (t as ts.StringLiteralType).value) };
  }
  if (parts.every((t) => t.flags & ts.TypeFlags.BooleanLiteral)) return { type: "boolean" };
  const hasString = parts.some((t) => t.flags & ts.TypeFlags.String);
  if (parts.length === 2 && hasString && parts.some((t) => isNamed(t, "Date"))) return DATE;
  if (parts.length === 2 && hasString && parts.some((t) => t.flags & ts.TypeFlags.Number)) {
    return { type: ["integer", "string"], description: "Numeric id" };
  }
  if (parts.length === 1) return typeToSchema(parts[0]!, checker, where, seen);
  return { anyOf: parts.map((t, i) => typeToSchema(t, checker, `${where}|${i}`, seen)) };
}

function objectToSchema(type: ts.Type, checker: ts.TypeChecker, where: string, seen: ReadonlySet<ts.Type>): JsonSchema {
  if (seen.has(type)) {
    return { type: "object", description: `Recursive: same shape as the enclosing ${checker.typeToString(type)}` };
  }
  if (type.getCallSignatures().length > 0) throw unmappable(type, checker, where);
  const inner = new Set(seen).add(type);
  const index = checker.getIndexInfoOfType(type, ts.IndexKind.String);
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const prop of checker.getPropertiesOfType(type)) {
    const name = prop.getName();
    const schema = typeToSchema(checker.getTypeOfSymbol(prop), checker, `${where}.${name}`, inner);
    const doc = ts.displayPartsToString(prop.getDocumentationComment(checker)).trim();
    properties[name] = doc ? { ...schema, description: doc } : schema;
    if (!(prop.flags & ts.SymbolFlags.Optional)) required.push(name);
  }
  if (Object.keys(properties).length === 0 && !index) throw unmappable(type, checker, where);
  const additional = !index
    ? false
    : index.type.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)
      ? true
      : typeToSchema(index.type, checker, `${where}[key]`, inner);
  return {
    type: "object",
    ...(Object.keys(properties).length > 0 && { properties }),
    ...(required.length > 0 && { required }),
    additionalProperties: additional,
  };
}

function paramsOf(member: ts.MethodDeclaration, checker: ts.TypeChecker, method: string): ManifestParam[] {
  const out: ManifestParam[] = [];
  member.parameters.forEach((param, i) => {
    const name = param.name.getText();
    const optional = param.questionToken !== undefined || param.initializer !== undefined;
    const type = checker.getTypeAtLocation(param);
    if (isNamed(checker.getNonNullableType(type), "Blob")) {
      out.push({ name, optional, role: "file", schema: { description: "File contents" } });
    } else if (out[i - 1]?.role === "file" && name === "filename") {
      out.push({ name, optional, role: "filename", schema: { type: "string" } });
    } else {
      out.push({ name, optional, schema: typeToSchema(type, checker, `${method}(${name})`) });
    }
  });
  return out;
}

function returnsBuffer(member: ts.MethodDeclaration, checker: ts.TypeChecker): boolean {
  const signature = checker.getSignatureFromDeclaration(member);
  if (!signature) return false;
  let t = checker.getReturnTypeOfSignature(signature);
  if (isNamed(t, "Promise")) t = checker.getTypeArguments(t as ts.TypeReference)[0] ?? t;
  return isNamed(t, "Buffer");
}

const humanize = (name: string) => {
  const words = name.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
};

function describe(
  name: string,
  member: ts.MethodDeclaration,
  checker: ts.TypeChecker,
  notes: ReturnType<typeof parseAgentsTable>,
): string {
  const note = stripParityChatter(notes.get(name)?.notes ?? "");
  const symbol = checker.getSymbolAtLocation(member.name);
  const doc = symbol ? ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim() : "";
  const text = (note || doc || humanize(name)).replace(/\s+/g, " ").trim();
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;
}

export function buildManifest(): ManifestMethod[] {
  const program = ts.createProgram([GARMIN_TS], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    types: ["node"],
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(GARMIN_TS);
  const cls = source?.statements.find(
    (s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === "Garmin",
  );
  if (!cls) throw new Error("generate-manifest: class Garmin not found in src/garmin.ts");

  const services = new Map(parseGarminClass().map((m) => [m.name, m.service]));
  const notes = parseAgentsTable();
  const methods: ManifestMethod[] = [];
  for (const member of cls.members) {
    // Skips the constructor, fields, and #private members (their names are PrivateIdentifiers).
    if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
    const name = member.name.text;
    const service = services.get(name);
    const category = service !== undefined && Object.hasOwn(CATEGORIES, service) ? CATEGORIES[service]!.slug : undefined;
    if (!category) {
      throw new Error(
        `generate-manifest: no category for ${name} (service "${service ?? "?"}"). ` +
          "See HAND_PLACED in parseGarminClass (scripts/lib/garmin-source.ts).",
      );
    }
    const params = paramsOf(member, checker, name);
    methods.push({
      name,
      category,
      description: describe(name, member, checker, notes),
      params,
      safety: classify(name),
      io: params.some((p) => p.role === "file") ? "binary-in" : returnsBuffer(member, checker) ? "binary-out" : "json",
    });
  }
  return methods;
}

export function renderManifest(methods: ManifestMethod[]): string {
  return [
    "// GENERATED by scripts/generate-manifest.ts. Do not edit; run `npm run manifest`.",
    "// tests/manifest.test.ts fails if this file is out of date.",
    'import type { ManifestMethod } from "../manifest.js";',
    "",
    `export const GARMIN_METHODS: readonly ManifestMethod[] = ${JSON.stringify(methods, null, 2)};`,
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const expected = renderManifest(buildManifest());
  if (process.argv.includes("--check")) {
    const current = readFileSync(MANIFEST_PATH, "utf8").replace(/\r\n/g, "\n");
    if (current !== expected) {
      console.error("src/generated/manifest.ts is out of date. Run `npm run manifest`.");
      process.exit(1);
    }
    console.log("src/generated/manifest.ts is up to date.");
  } else {
    mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    writeFileSync(MANIFEST_PATH, expected);
    console.log(`Wrote ${expected.match(/"name": "[a-z]/g)?.length ?? 0} method entries to src/generated/manifest.ts`);
  }
}
```

(The count in the final log line is only informational. The test is the real check.)

- [ ] **Step 7: Wire the script, the subpath and the build**

`package.json` changes:

```jsonc
// scripts: add
"manifest": "tsx scripts/generate-manifest.ts",
// exports: add after "./exercises"
"./manifest": {
  "import": { "types": "./dist/manifest.d.ts", "default": "./dist/manifest.js" },
  "require": { "types": "./dist/manifest.d.cts", "default": "./dist/manifest.cjs" }
},
// typesVersions["*"]: add
"manifest": ["./dist/manifest.d.ts"]
```

`tsup.config.ts`: change `entry` to `["src/index.ts", "src/exercises.ts", "src/manifest.ts"]` and extend the comment: "`src/manifest.ts` is the generated method manifest, published as `garminconnect-js/manifest` for tools built on this library."

`tests/build.test.ts`: in "gives import and require each their own types", change the tuple list to:

```ts
    for (const [subpath, ext] of [[".", "index"], ["./exercises", "exercises"], ["./manifest", "manifest"]] as const) {
```

Create `.prettierignore`:

```
# Generated, and compared byte-for-byte by tests; formatting them would make those tests fail.
src/generated/
docs/api/
```

- [ ] **Step 8: Generate, then run the tests**

Run: `npm run manifest && npx vitest run tests/manifest.test.ts`
Expected: "Wrote … method entries", then PASS.

If the generator throws `cannot map type`, look at the named parameter. A structured type the converter doesn't know gets a new branch in `typeToSchema` with a test in `tests/manifest.test.ts`. Never make it fall back to `{}`. If it throws `cannot classify`, add the method to `SAFETY_OVERRIDES` with a reason comment.

Spot-check `src/generated/manifest.ts` by eye: `getSleepData` should have one `cdate` date param and `safety: "read"`, and `createGear`'s `usageType` should be an enum.

- [ ] **Step 9: Document**

In `AGENTS.md` §3, after the `workoutFromSpec` subsection, add (no table whose first cell is a backticked name, because `tests/agents-md.test.ts` parses those as method rows):

````markdown
### `garminconnect-js/manifest`: every method, machine-readable

`GARMIN_METHODS` describes every `Garmin` method: `name`, `category` (the docs/api slug),
`description`, `params` (each with a JSON Schema, `optional`, and `role: "file" | "filename"` for
`Blob` inputs), `safety` (`read` / `write` / `destructive`) and `io` (`json` / `binary-in` /
`binary-out`). It exists so tools can be GENERATED from this library; the MCP server in `mcp/` is
one.

It is generated from `src/garmin.ts` by `scripts/generate-manifest.ts` using the TypeScript
compiler, and committed as `src/generated/manifest.ts`. `tests/manifest.test.ts` fails if it is
stale, so **after changing any `Garmin` method signature, run `npm run manifest`**. A new method
whose name fits no safety prefix fails generation until it is added to `SAFETY_OVERRIDES` with a
reason.
````

`CHANGELOG.md`, Unreleased, `### Added`:

```markdown
- **`garminconnect-js/manifest`**: `GARMIN_METHODS`, a generated, machine-readable description of
  every `Garmin` method (JSON Schema parameters, a read/write/destructive safety class, file
  input/output), for building tools on top of this library.
```

- [ ] **Step 10: Full check**

Run: `npm run check`
Expected: PASS, including `tests/dist.test.ts` and `tests/build.test.ts` for the new subpath.

- [ ] **Step 11: Commit**

```bash
git add scripts/lib/garmin-source.ts scripts/generate-api-docs.ts scripts/generate-manifest.ts src/manifest.ts src/generated/manifest.ts .prettierignore tests/manifest.test.ts tests/build.test.ts package.json tsup.config.ts AGENTS.md CHANGELOG.md
git commit -m "feat: garminconnect-js/manifest, a generated description of every Garmin method"
git push
```

---

### Task 4: The `mcp/` workspace: session, server, errors, login and CLI

**Files:**
- Create: `mcp/package.json`, `mcp/tsconfig.json`, `mcp/tsup.config.ts`, `mcp/vitest.config.ts`
- Create: `mcp/src/session.ts`, `mcp/src/errors.ts`, `mcp/src/results.ts`, `mcp/src/server.ts`, `mcp/src/tools.ts`, `mcp/src/login.ts`, `mcp/src/cli.ts`
- Create: `mcp/tests/helpers.ts`, `mcp/tests/session.test.ts`, `mcp/tests/server.test.ts`, `mcp/tests/results.test.ts`, `mcp/tests/login.test.ts`
- Modify: root `package.json` (`workspaces`, `scripts.check`, `scripts.lint`), `eslint.config.js`

**Interfaces:**
- Consumes: `FileTokenStore`, `Garmin`, `GarminClient`, `GarminClientOptions`, `GarminAuthError`, `GarminHttpError`, `GarminRateLimitError`, `LoginResult`, `MfaState`, `Tokens` from `garminconnect-js`.
- Produces:
  - `session.ts`: `interface McpConfig { tokenDir: string; downloadDir: string; groups: ReadonlySet<string> | null; enableGraphql: boolean }`, `loadConfig(env?): McpConfig`, `interface Session { get(): Promise<Garmin>; reset(): void }`, `fileSession(tokenDir: string, options?: Omit<GarminClientOptions, "tokenStore">): Session`, `class NotLoggedInError extends GarminAuthError`.
  - `errors.ts`: `describeError(error: unknown): string`, `errorResult(error: unknown): CallToolResult`, `LOGIN_HINT`.
  - `results.ts`: `MAX_RESULT_CHARS = 100_000`, `truncate(text: string): string`, `textResult(text: string): CallToolResult`, `jsonResult(value: unknown): CallToolResult`.
  - `server.ts`: `interface ToolDef { tool: Tool; run(input: Record<string, unknown>): Promise<CallToolResult> }`, `interface ServerDeps { config: McpConfig; session: Session; version?: string }`, `type ToolFactory = (deps: ServerDeps) => ToolDef[]`, `createServer(deps: ServerDeps, factories: readonly ToolFactory[]): Server`.
  - `tools.ts`: `TOOL_FACTORIES: readonly ToolFactory[]` (empty in this task; Tasks 5 and 6 add to it).
  - `login.ts`: `interface LoginClient`, `interface LoginIo`, `login(io: LoginIo, client: LoginClient, env?): Promise<void>`, `terminalIo(): LoginIo`.
  - `tests/helpers.ts`: `TOKENS`, `fakeFetch(routes)`, `json(value, status?)`, `PROFILE_ROUTE`, `testConfig(overrides?)`, `sessionFor(fetchImpl)`, `connect(deps, factories)`, `textOf(result)`.

- [ ] **Step 1: Scaffold the package**

`mcp/package.json`:

```json
{
  "name": "garminconnect-mcp",
  "version": "0.6.0",
  "description": "MCP server for Garmin Connect: create workouts and read your Garmin data from Claude. Built on garminconnect-js.",
  "keywords": ["garmin", "garmin-connect", "mcp", "model-context-protocol", "claude", "workouts"],
  "homepage": "https://github.com/DynamicsNinja/garminconnect-js/tree/main/mcp#readme",
  "repository": { "type": "git", "url": "git+https://github.com/DynamicsNinja/garminconnect-js.git", "directory": "mcp" },
  "bugs": { "url": "https://github.com/DynamicsNinja/garminconnect-js/issues" },
  "author": "ificko",
  "license": "MIT",
  "type": "module",
  "bin": { "garminconnect-mcp": "./dist/cli.js" },
  "files": ["dist", "README.md"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit -p .",
    "test": "vitest run",
    "check": "npm run typecheck && npm run build && npm test",
    "prepublishOnly": "npm run check"
  },
  "dependencies": {}
}
```

Set `"version"` to whatever the root `package.json` version is at the time; it's `0.6.0` as of writing.

Run: `npm install @modelcontextprotocol/sdk@^1.30.1 -w mcp`
Expected: `mcp/package.json` `dependencies` becomes `{ "@modelcontextprotocol/sdk": "^1.30.1" }` and the root lockfile updates. `npm install` also adds `"workspaces": ["mcp"]` to the root `package.json` if it isn't there. If it doesn't, add it by hand, right after `"files"`.

`mcp/tsconfig.json`:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    // The server uses the library ONLY through its three public entry points, resolved to THIS
    // commit's source. tsup inlines them at build time (see tsup.config.ts), so a published server
    // always contains exactly the library it was tested against.
    "paths": {
      "garminconnect-js": ["../src/index.ts"],
      "garminconnect-js/exercises": ["../src/exercises.ts"],
      "garminconnect-js/manifest": ["../src/manifest.ts"]
    }
  },
  "include": ["src", "tests", "scripts"]
}
```

`mcp/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  sourcemap: true,
  // Inline garminconnect-js (resolved to ../src through tsconfig `paths`). The server is released in
  // lockstep with the library and must never run against a different version of it.
  noExternal: [/^garminconnect-js/],
});
```

`mcp/vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (file: string) => fileURLToPath(new URL(`../src/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^garminconnect-js\/exercises$/, replacement: src("exercises.ts") },
      { find: /^garminconnect-js\/manifest$/, replacement: src("manifest.ts") },
      { find: /^garminconnect-js$/, replacement: src("index.ts") },
    ],
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
```

Root `package.json` scripts:

```jsonc
"lint": "eslint src tests scripts examples mcp/src mcp/tests",
"check": "npm run typecheck && npm run lint && npm run build && npm test && npm run check -w mcp",
```

(`mcp/scripts` joins the lint list in Task 7, when the folder first exists. ESLint 9 errors on a path that matches no files.)

`eslint.config.js`: change the relaxed block's `files` to `["tests/**/*.ts", "scripts/**/*.ts", "mcp/tests/**/*.ts", "mcp/scripts/**/*.ts"]`, and append this block at the end of the config array:

```js
  {
    // The MCP server may use the library ONLY through its public entry points. Reaching into
    // ../../src would couple it to internals that are free to change between releases.
    files: ["mcp/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(\\.\\./)+\\.\\./src/",
              message:
                'Import from "garminconnect-js", "garminconnect-js/exercises" or "garminconnect-js/manifest" instead.',
            },
          ],
        },
      ],
    },
  },
```

Keep `mcp/src` flat, with no subdirectories, so a legitimate import never needs two `../`.

- [ ] **Step 2: Write the shared test helpers**

`mcp/tests/helpers.ts`:

```ts
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Garmin, GarminClient, type Tokens } from "garminconnect-js";
import { createServer, type ServerDeps, type ToolFactory } from "../src/server.js";
import type { McpConfig, Session } from "../src/session.js";

export const TOKENS: Tokens = {
  oauth1: { oauth_token: "o1", oauth_token_secret: "s1", domain: "garmin.com" },
  oauth2: {
    scope: "CONNECT_READ",
    jti: "j",
    token_type: "Bearer",
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token_expires_in: 7200,
    refresh_token_expires_at: Math.floor(Date.now() / 1000) + 7200,
  },
};

export interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

/**
 * A fetch stand-in. `routes` maps "METHOD url-fragment" to a response; the first match wins.
 * An unmatched request throws, which the client surfaces as a failure, so tests notice it.
 */
export function fakeFetch(routes: Record<string, (call: FetchCall) => Response>) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : init?.body;
    const call = { url, method, body };
    calls.push(call);
    for (const [key, respond] of Object.entries(routes)) {
      const [routeMethod, fragment] = key.split(" ", 2);
      if (routeMethod === method && fragment !== undefined && url.includes(fragment)) return respond(call);
    }
    throw new Error(`fakeFetch: no route for ${method} ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

export const PROFILE_ROUTE = {
  "GET /userprofile-service/socialProfile": () =>
    json({ displayName: "abc-display", userName: "u", fullName: "Test User", profileId: 1 }),
};

export function testConfig(overrides: Partial<McpConfig> = {}): McpConfig {
  return { tokenDir: "/nonexistent", downloadDir: os.tmpdir(), groups: null, enableGraphql: false, ...overrides };
}

/** A session over an in-memory client that talks to `fetchImpl`, counting resets. */
export function sessionFor(fetchImpl: typeof fetch): Session & { resets: number } {
  const client = new GarminClient({ fetchImpl, retries: 0 });
  client.setTokens(TOKENS);
  const garmin = new Garmin(client);
  const session = {
    resets: 0,
    get: async () => garmin,
    reset() {
      session.resets++;
    },
  };
  return session;
}

export async function connect(deps: ServerDeps, factories: readonly ToolFactory[]): Promise<Client> {
  const server = createServer(deps, factories);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
}

export function textOf(result: unknown): string {
  return (result as { content: { text?: string }[] }).content.map((c) => c.text ?? "").join("\n");
}
```

- [ ] **Step 3: Write the failing tests**

`mcp/tests/session.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileTokenStore } from "garminconnect-js";
import { fileSession, loadConfig, NotLoggedInError } from "../src/session.js";
import { TOKENS } from "./helpers.js";

describe("loadConfig", () => {
  it("defaults under the home directory", () => {
    const c = loadConfig({});
    expect(c.tokenDir).toBe(path.join(os.homedir(), ".garminconnect-mcp", "tokens"));
    expect(c.downloadDir).toBe(path.join(os.homedir(), "Downloads", "garmin"));
    expect(c.groups).toBeNull();
    expect(c.enableGraphql).toBe(false);
  });

  it("reads overrides", () => {
    const c = loadConfig({
      GARMIN_MCP_TOKEN_DIR: "/t",
      GARMIN_MCP_DOWNLOAD_DIR: "/d",
      GARMIN_MCP_GROUPS: " workouts, metrics ,",
      GARMIN_MCP_ENABLE_GRAPHQL: "1",
    });
    expect(c).toEqual({ tokenDir: "/t", downloadDir: "/d", groups: new Set(["workouts", "metrics"]), enableGraphql: true });
  });
});

describe("fileSession", () => {
  it("reports a missing login, and picks up a login made afterwards without a restart", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gc-mcp-"));
    const session = fileSession(dir);
    await expect(session.get()).rejects.toBeInstanceOf(NotLoggedInError);
    await new FileTokenStore(dir).save(TOKENS);
    await expect(session.get()).resolves.toBeDefined();
  });

  it("caches the session until reset", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gc-mcp-"));
    await new FileTokenStore(dir).save(TOKENS);
    const session = fileSession(dir);
    const first = await session.get();
    expect(await session.get()).toBe(first);
    session.reset();
    expect(await session.get()).not.toBe(first);
  });
});
```

`mcp/tests/results.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { jsonResult, MAX_RESULT_CHARS, truncate } from "../src/results.js";

describe("results", () => {
  it("leaves short text alone", () => {
    expect(truncate("abc")).toBe("abc");
  });
  it("truncates long text and says so", () => {
    const out = truncate("x".repeat(MAX_RESULT_CHARS + 5));
    expect(out.startsWith("x".repeat(MAX_RESULT_CHARS))).toBe(true);
    expect(out.endsWith(`[truncated: ${MAX_RESULT_CHARS} of ${MAX_RESULT_CHARS + 5} characters]`)).toBe(true);
  });
  it("serializes JSON, and says so when there is nothing", () => {
    expect(jsonResult({ a: 1 }).content).toEqual([{ type: "text", text: '{\n  "a": 1\n}' }]);
    expect(jsonResult(null).content).toEqual([{ type: "text", text: "null (Garmin returned no data)" }]);
    expect(jsonResult(undefined).content).toEqual([{ type: "text", text: "Done. Garmin returned no content." }]);
  });
});
```

`mcp/tests/server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GarminAuthError, GarminHttpError } from "garminconnect-js";
import { createServer, type ToolFactory } from "../src/server.js";
import { textResult } from "../src/results.js";
import { connect, fakeFetch, sessionFor, testConfig, textOf } from "./helpers.js";

const tool = (name: string, run: () => Promise<never> | ReturnType<typeof textResult>): ToolFactory => () => [
  { tool: { name, inputSchema: { type: "object" } }, run: async () => run() },
];

describe("createServer", () => {
  const deps = () => ({ config: testConfig(), session: sessionFor(fakeFetch({}).fetchImpl) });

  it("lists and runs tools", async () => {
    const client = await connect(deps(), [tool("hello", () => textResult("hi"))]);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["hello"]);
    expect(textOf(await client.callTool({ name: "hello", arguments: {} }))).toBe("hi");
  });

  it("answers an unknown tool with an error result", async () => {
    const client = await connect(deps(), []);
    const result = await client.callTool({ name: "nope", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Unknown tool "nope"');
  });

  it("turns library errors into error results", async () => {
    const client = await connect(deps(), [
      tool("boom", () => Promise.reject(new GarminHttpError("server error", 500, "https://x", ""))),
    ]);
    const result = await client.callTool({ name: "boom", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Garmin returned HTTP 500: server error");
  });

  it("resets the session on an auth error so a fresh login is picked up", async () => {
    const d = deps();
    const client = await connect(d, [tool("auth", () => Promise.reject(new GarminAuthError("expired")))]);
    const result = await client.callTool({ name: "auth", arguments: {} });
    expect(textOf(result)).toContain("npx garminconnect-mcp login");
    expect(d.session.resets).toBe(1);
  });

  it("refuses duplicate tool names", () => {
    expect(() => createServer(deps(), [tool("a", () => textResult("")), tool("a", () => textResult(""))])).toThrow(
      /Duplicate tool name a/,
    );
  });
});
```

`mcp/tests/login.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { LoginResult, MfaState } from "garminconnect-js";
import { login, type LoginIo } from "../src/login.js";

const io = (answers: Record<string, string>): LoginIo => ({
  ask: async (q) => answers[q] ?? "",
  askHidden: async (q) => answers[q] ?? "",
  log: () => {},
});

describe("login", () => {
  it("logs in without MFA", async () => {
    const client = { login: vi.fn().mockResolvedValue({ state: "success" } as LoginResult), resumeLogin: vi.fn() };
    await login(io({ "Garmin email: ": "a@b.c", "Garmin password: ": "pw" }), client, {});
    expect(client.login).toHaveBeenCalledWith("a@b.c", "pw");
    expect(client.resumeLogin).not.toHaveBeenCalled();
  });

  it("asks for the MFA code when Garmin wants one", async () => {
    const mfaState = { flow: "mobile" } as unknown as MfaState;
    const client = {
      login: vi.fn().mockResolvedValue({ state: "mfa_required", mfaState } as LoginResult),
      resumeLogin: vi.fn().mockResolvedValue(undefined),
    };
    await login(io({ "Garmin email: ": "a@b.c", "Garmin password: ": "pw", "MFA code from Garmin: ": " 123456 " }), client, {});
    expect(client.resumeLogin).toHaveBeenCalledWith(mfaState, "123456");
  });

  it("uses GARMIN_EMAIL / GARMIN_PASSWORD when set", async () => {
    const client = { login: vi.fn().mockResolvedValue({ state: "success" } as LoginResult), resumeLogin: vi.fn() };
    await login(io({}), client, { GARMIN_EMAIL: "e@x.y", GARMIN_PASSWORD: "p" });
    expect(client.login).toHaveBeenCalledWith("e@x.y", "p");
  });

  it("refuses an empty password", async () => {
    const client = { login: vi.fn(), resumeLogin: vi.fn() };
    await expect(login(io({ "Garmin email: ": "a@b.c" }), client, {})).rejects.toThrow("Email and password are required.");
  });
});
```

- [ ] **Step 4: Run them and confirm they fail**

Run: `npm test -w mcp`
Expected: FAIL (the modules in `../src/` don't exist).

- [ ] **Step 5: Implement the modules**

`mcp/src/session.ts`:

```ts
import os from "node:os";
import path from "node:path";
import { FileTokenStore, Garmin, GarminAuthError, GarminClient, type GarminClientOptions } from "garminconnect-js";

export interface McpConfig {
  tokenDir: string;
  downloadDir: string;
  /** Manifest categories to expose; `null` means all. */
  groups: ReadonlySet<string> | null;
  enableGraphql: boolean;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  const home = os.homedir();
  const groups = (env["GARMIN_MCP_GROUPS"] ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  return {
    tokenDir: env["GARMIN_MCP_TOKEN_DIR"] || path.join(home, ".garminconnect-mcp", "tokens"),
    downloadDir: env["GARMIN_MCP_DOWNLOAD_DIR"] || path.join(home, "Downloads", "garmin"),
    groups: groups.length > 0 ? new Set(groups) : null,
    enableGraphql: env["GARMIN_MCP_ENABLE_GRAPHQL"] === "1",
  };
}

/** No saved login to load. */
export class NotLoggedInError extends GarminAuthError {}

/**
 * Where tools get their `Garmin` from. Today: one session from a token directory. A hosted
 * version would supply one per user; tool code only ever sees this interface.
 */
export interface Session {
  get(): Promise<Garmin>;
  /** Drop the cached client so the next `get()` reloads tokens from disk. */
  reset(): void;
}

export function fileSession(tokenDir: string, options: Omit<GarminClientOptions, "tokenStore"> = {}): Session {
  let current: Promise<Garmin> | null = null;
  return {
    get() {
      current ??= (async () => {
        const client = new GarminClient({ ...options, tokenStore: new FileTokenStore(tokenDir) });
        if (!(await client.loadTokens())) throw new NotLoggedInError(`No saved Garmin login in ${tokenDir}`);
        return new Garmin(client);
      })().catch((error: unknown) => {
        current = null; // a failure is never cached: a login made later is picked up on the next call
        throw error;
      });
      return current;
    },
    reset() {
      current = null;
    },
  };
}
```

`mcp/src/results.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** One tool result may not exceed this; some Garmin responses run to megabytes. */
export const MAX_RESULT_CHARS = 100_000;

export function truncate(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated: ${MAX_RESULT_CHARS} of ${text.length} characters]`;
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text: truncate(text) }] };
}

export function jsonResult(value: unknown): CallToolResult {
  if (value === undefined) return textResult("Done. Garmin returned no content.");
  if (value === null) return textResult("null (Garmin returned no data)");
  return textResult(JSON.stringify(value, null, 2));
}
```

`mcp/src/errors.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { GarminAuthError, GarminHttpError, GarminRateLimitError } from "garminconnect-js";
import { NotLoggedInError } from "./session.js";

export const LOGIN_HINT = "run `npx garminconnect-mcp login` in a terminal, then try again";

/** Plain-language text for a failure. Library messages are already free of tokens. */
export function describeError(error: unknown): string {
  if (error instanceof NotLoggedInError) return `Not logged in to Garmin: ${LOGIN_HINT}.`;
  if (error instanceof GarminAuthError) {
    return `Garmin session expired or was rejected (${error.message}): ${LOGIN_HINT}.`;
  }
  if (error instanceof GarminRateLimitError) {
    const wait = error.retryAfter !== undefined ? `; retry after ${error.retryAfter} s` : "";
    return `Garmin is rate limiting requests${wait}. ${error.message}`;
  }
  if (error instanceof GarminHttpError) return `Garmin returned HTTP ${error.status}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function errorResult(error: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: describeError(error) }] };
}
```

`mcp/src/server.ts`:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { GarminAuthError } from "garminconnect-js";
import { errorResult } from "./errors.js";
import type { McpConfig, Session } from "./session.js";

export interface ToolDef {
  tool: Tool;
  run(input: Record<string, unknown>): Promise<CallToolResult>;
}

export interface ServerDeps {
  config: McpConfig;
  session: Session;
  version?: string;
}

export type ToolFactory = (deps: ServerDeps) => ToolDef[];

export function createServer(deps: ServerDeps, factories: readonly ToolFactory[]): Server {
  const tools = factories.flatMap((factory) => factory(deps));
  const byName = new Map<string, ToolDef>();
  for (const def of tools) {
    if (byName.has(def.tool.name)) throw new Error(`Duplicate tool name ${def.tool.name}`);
    byName.set(def.tool.name, def);
  }

  const server = new Server(
    { name: "garminconnect-mcp", version: deps.version ?? "0.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map((t) => t.tool) }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const def = byName.get(request.params.name);
    if (!def) return errorResult(new Error(`Unknown tool "${request.params.name}"`));
    try {
      return await def.run(request.params.arguments ?? {});
    } catch (error) {
      // After `login` in a terminal, the next call must use the NEW tokens, not the cached client.
      if (error instanceof GarminAuthError) deps.session.reset();
      return errorResult(error);
    }
  });
  return server;
}
```

`mcp/src/tools.ts`:

```ts
import type { ToolFactory } from "./server.js";

/** Every tool the server exposes, in listing order. */
export const TOOL_FACTORIES: readonly ToolFactory[] = [];
```

`mcp/src/login.ts`:

```ts
import { createInterface } from "node:readline/promises";
import type { LoginResult, MfaState } from "garminconnect-js";

export interface LoginClient {
  login(email: string, password: string): Promise<LoginResult>;
  resumeLogin(mfaState: MfaState, code: string): Promise<void>;
}

export interface LoginIo {
  ask(question: string): Promise<string>;
  askHidden(question: string): Promise<string>;
  log(line: string): void;
}

/** Sign in once. The client's token store saves the session; nothing is printed to stdout. */
export async function login(io: LoginIo, client: LoginClient, env: Record<string, string | undefined> = process.env): Promise<void> {
  const email = env["GARMIN_EMAIL"]?.trim() || (await io.ask("Garmin email: ")).trim();
  const password = env["GARMIN_PASSWORD"] || (await io.askHidden("Garmin password: "));
  if (!email || !password) throw new Error("Email and password are required.");
  const result = await client.login(email, password);
  if (result.state === "mfa_required") {
    const code = (await io.ask("MFA code from Garmin: ")).trim();
    if (!code) throw new Error("No MFA code entered.");
    await client.resumeLogin(result.mfaState, code);
  }
}

/** Prompts on stderr, so stdout stays clean even here. */
export function terminalIo(): LoginIo {
  return {
    async ask(question) {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    askHidden(question) {
      return new Promise((resolve, reject) => {
        const stdin = process.stdin;
        process.stderr.write(question);
        stdin.setRawMode?.(true);
        stdin.resume();
        stdin.setEncoding("utf8");
        let value = "";
        const done = (error?: Error) => {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          if (error) reject(error);
          else resolve(value);
        };
        const onData = (chunk: string) => {
          for (const ch of chunk) {
            if (ch === "\r" || ch === "\n") return done();
            if (ch === "\u0003") return done(new Error("Cancelled."));
            if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
            else value += ch;
          }
        };
        stdin.on("data", onData);
      });
    },
    log: (line) => console.error(line),
  };
}
```

`mcp/src/cli.ts`:

```ts
#!/usr/bin/env node
/**
 * `garminconnect-mcp`        start the MCP server on stdio (Claude Desktop runs this)
 * `garminconnect-mcp login`  sign in once and save the session
 *
 * stdout carries MCP protocol frames only; everything human-readable goes to stderr.
 */
import { createRequire } from "node:module";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FileTokenStore, Garmin, GarminClient } from "garminconnect-js";
import { describeError } from "./errors.js";
import { login, terminalIo } from "./login.js";
import { createServer } from "./server.js";
import { fileSession, loadConfig } from "./session.js";
import { TOOL_FACTORIES } from "./tools.js";

// From src/cli.ts and from dist/cli.js alike, ../package.json is this package's manifest.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
const USAGE = `garminconnect-mcp ${version}

  garminconnect-mcp          start the MCP server (stdio); Claude Desktop runs this
  garminconnect-mcp login    sign in to Garmin once and save the session
`;

const config = loadConfig();
const command = process.argv[2];
try {
  if (command === "login") {
    const client = new GarminClient({ tokenStore: new FileTokenStore(config.tokenDir) });
    await login(terminalIo(), client);
    const profile = await new Garmin(client).getUserProfile();
    console.error(`Logged in as ${profile.displayName}. Session saved to ${config.tokenDir}.`);
  } else if (command === undefined) {
    const server = createServer({ config, session: fileSession(config.tokenDir), version }, TOOL_FACTORIES);
    await server.connect(new StdioServerTransport());
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}
```

- [ ] **Step 6: Run the mcp tests, typecheck and build**

Run: `npm run check -w mcp`
Expected: typecheck clean, build writes `mcp/dist/cli.js`, and all tests PASS.

If `Server`/`Tool` typing complains about `inputSchema`'s shape in `server.test.ts`, keep `{ type: "object" }`. That's the minimum the SDK's `Tool` type accepts.

- [ ] **Step 7: Smoke the CLI by hand**

Run: `node mcp/dist/cli.js --help; echo "exit $?"`
Expected: the usage text on stderr and `exit 2`.

Run: `GARMIN_MCP_TOKEN_DIR=/nonexistent node mcp/dist/cli.js < /dev/null; echo "exit $?"`
Expected: the process starts and exits once stdin closes, with nothing printed to stdout.

- [ ] **Step 8: Root check and lint rule**

Run: `npm run check`
Expected: PASS, including `check -w mcp`.

Then prove the lint rule works: temporarily add `import "../../src/index.js";` to `mcp/src/tools.ts` and run `npx eslint mcp/src/tools.ts`. Expected: the `no-restricted-imports` error with the message above. Remove the line.

- [ ] **Step 9: Commit**

```bash
git add mcp/package.json mcp/tsconfig.json mcp/tsup.config.ts mcp/vitest.config.ts mcp/src mcp/tests package.json package-lock.json eslint.config.js
git commit -m "feat(mcp): garminconnect-mcp workspace with session, server, login and CLI"
git push
```

(Make sure `mcp/dist` is ignored. The root `.gitignore` has `dist`; check it matches nested dirs. If not, add `mcp/dist/`.)

---

### Task 5: Generated tools, one per manifest method

**Files:**
- Create: `mcp/src/files.ts`, `mcp/src/method-tools.ts`
- Modify: `mcp/src/tools.ts`
- Create: `mcp/tests/files.test.ts`, `mcp/tests/method-tools.test.ts`

**Interfaces:**
- Consumes: `GARMIN_METHODS`, `ManifestMethod` from `garminconnect-js/manifest`; `ToolDef`, `ToolFactory`, `ServerDeps` from `server.ts`; `jsonResult` from `results.ts`.
- Produces:
  - `files.ts`: `UPLOAD_EXTENSIONS = [".fit", ".gpx", ".tcx"]`, `expandHome(p: string): string`, `readUpload(filePath: unknown): Promise<{ blob: Blob; filename: string }>`, `sniffExtension(bytes: Uint8Array): string`, `saveDownload(dir: string, baseName: string, bytes: Uint8Array): Promise<{ path: string; bytes: number }>`.
  - `method-tools.ts`: `EXCLUDED: Readonly<Record<string, string>>`, `OPT_IN: Readonly<Record<string, "enableGraphql">>`, `toolName(method: string): string`, `methodTools: ToolFactory`.

- [ ] **Step 1: Write the failing file-helper tests**

`mcp/tests/files.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandHome, readUpload, saveDownload, sniffExtension } from "../src/files.js";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("expandHome", () => {
  it("expands a leading ~", () => {
    expect(expandHome("~/Downloads/run.gpx")).toBe(path.join(os.homedir(), "Downloads", "run.gpx"));
    expect(expandHome("~")).toBe(os.homedir());
    expect(expandHome("/abs/x.gpx")).toBe("/abs/x.gpx");
  });
});

describe("readUpload", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gc-up-"));
  const gpx = path.join(dir, "run.gpx");
  writeFileSync(gpx, "<gpx></gpx>");

  it("reads an absolute path to an allowed file", async () => {
    const { blob, filename } = await readUpload(gpx);
    expect(filename).toBe("run.gpx");
    expect(await blob.text()).toBe("<gpx></gpx>");
  });
  it("rejects a relative path", async () => {
    await expect(readUpload("run.gpx")).rejects.toThrow("filePath must be an absolute path");
  });
  it("rejects another extension", async () => {
    await expect(readUpload(path.join(dir, "notes.txt"))).rejects.toThrow('Only .fit, .gpx and .tcx files can be uploaded; got ".txt"');
  });
  it("rejects a missing file", async () => {
    await expect(readUpload(path.join(dir, "missing.fit"))).rejects.toThrow(/Cannot read .*missing\.fit/);
  });
});

describe("sniffExtension", () => {
  it("recognises the formats Garmin returns", () => {
    const fit = new Uint8Array(14);
    fit.set(bytes(".FIT"), 8);
    expect(sniffExtension(fit)).toBe("fit");
    expect(sniffExtension(bytes("PK\u0003\u0004rest"))).toBe("zip");
    expect(sniffExtension(bytes('<?xml version="1.0"?>\n<gpx version="1.1">'))).toBe("gpx");
    expect(sniffExtension(bytes("<TrainingCenterDatabase>"))).toBe("tcx");
    expect(sniffExtension(bytes("<kml>"))).toBe("kml");
    expect(sniffExtension(bytes('{"a":1}'))).toBe("json");
    expect(sniffExtension(bytes("a,b\n1,2\n"))).toBe("csv");
    expect(sniffExtension(new Uint8Array([1, 2, 3]))).toBe("bin");
  });
});

describe("saveDownload", () => {
  it("creates the directory and writes the file", async () => {
    const dir = path.join(mkdtempSync(path.join(os.tmpdir(), "gc-dl-")), "nested", "deeper");
    const saved = await saveDownload(dir, "download_workout-42", bytes('{"x":1}'));
    expect(saved).toEqual({ path: path.join(dir, "download_workout-42.json"), bytes: 7 });
    expect(readFileSync(saved.path, "utf8")).toBe('{"x":1}');
  });
});
```

- [ ] **Step 2: Run and confirm it fails; then implement `mcp/src/files.ts`**

Run: `npx vitest run --root mcp tests/files.test.ts`
Expected: FAIL (module missing).

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const UPLOAD_EXTENSIONS = [".fit", ".gpx", ".tcx"] as const;

/** `~/x` means the home directory, as it does in any shell the user would copy a path from. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export async function readUpload(filePath: unknown): Promise<{ blob: Blob; filename: string }> {
  const p = typeof filePath === "string" ? expandHome(filePath.trim()) : "";
  if (!p || !path.isAbsolute(p)) {
    throw new Error("filePath must be an absolute path to a local file, e.g. /Users/me/Downloads/run.gpx");
  }
  const ext = path.extname(p).toLowerCase();
  if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(`Only .fit, .gpx and .tcx files can be uploaded; got "${ext || "no extension"}"`);
  }
  let data: Buffer;
  try {
    data = await readFile(p);
  } catch {
    throw new Error(`Cannot read ${p}: the file does not exist or is not readable`);
  }
  return { blob: new Blob([data]), filename: path.basename(p) };
}

/** A file extension from the bytes themselves, so the server needs no per-endpoint knowledge. */
export function sniffExtension(bytes: Uint8Array): string {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "zip";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(8, 12)) === ".FIT") return "fit";
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
  if (head.startsWith("<")) {
    if (/<gpx[\s>]/.test(head)) return "gpx";
    if (/<TrainingCenterDatabase[\s>]/.test(head)) return "tcx";
    if (/<kml[\s>]/.test(head)) return "kml";
    return "xml";
  }
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  if (/^[^\n]*,[^\n]*\n/.test(head)) return "csv";
  return "bin";
}

export async function saveDownload(dir: string, baseName: string, bytes: Uint8Array): Promise<{ path: string; bytes: number }> {
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `${baseName}.${sniffExtension(bytes)}`);
  await writeFile(target, bytes);
  return { path: target, bytes: bytes.length };
}
```

Run: `npx vitest run --root mcp tests/files.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing generated-tool tests**

`mcp/tests/method-tools.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GARMIN_METHODS } from "garminconnect-js/manifest";
import { EXCLUDED, methodTools, OPT_IN, toolName } from "../src/method-tools.js";
import { connect, fakeFetch, json, PROFILE_ROUTE, sessionFor, testConfig, textOf } from "./helpers.js";
import type { McpConfig } from "../src/session.js";

const deps = (fetchImpl: typeof fetch, config: Partial<McpConfig> = {}) => ({
  config: testConfig(config),
  session: sessionFor(fetchImpl),
});
const names = (config: Partial<McpConfig> = {}) => methodTools(deps(fakeFetch({}).fetchImpl, config)).map((t) => t.tool.name);

describe("methodTools", () => {
  it("exposes every manifest method except the exclusions and opt-ins", () => {
    const expected = GARMIN_METHODS.filter((m) => !(m.name in EXCLUDED) && !(m.name in OPT_IN)).map((m) => toolName(m.name));
    expect(names().sort()).toEqual(expected.sort());
    for (const hidden of ["logout", "upload_workout", "update_workout", "query_garmin_graphql"]) {
      expect(names()).not.toContain(hidden);
    }
  });

  it("uses unique, valid MCP names", () => {
    const all = names({ enableGraphql: true });
    expect(new Set(all).size).toBe(all.length);
    for (const n of all) expect(n).toMatch(/^[a-z0-9_]{1,64}$/);
    expect(toolName("getSpo2Data")).toBe("get_spo2_data");
  });

  it("sets annotations from the safety class", () => {
    const tools = methodTools(deps(fakeFetch({}).fetchImpl));
    const find = (n: string) => tools.find((t) => t.tool.name === n)!.tool.annotations;
    expect(find("get_sleep_data")).toMatchObject({ readOnlyHint: true });
    expect(find("schedule_workout")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(find("delete_gear")).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it("offers GraphQL only when enabled", () => {
    expect(names({ enableGraphql: true })).toContain("query_garmin_graphql");
  });

  it("filters by group and rejects unknown groups", () => {
    const wellness = GARMIN_METHODS.filter((m) => m.category === "wellness").map((m) => toolName(m.name));
    expect(names({ groups: new Set(["wellness"]) }).sort()).toEqual(wellness.sort());
    expect(() => names({ groups: new Set(["welness"]) })).toThrow(/Unknown GARMIN_MCP_GROUPS value\(s\): welness\. Valid: .*wellness/);
  });

  it("replaces a Blob parameter with filePath in the input schema", () => {
    const tool = methodTools(deps(fakeFetch({}).fetchImpl)).find((t) => t.tool.name === "import_activity")!.tool;
    expect(tool.inputSchema.properties).toHaveProperty("filePath");
    expect(tool.inputSchema.properties).not.toHaveProperty("file");
    expect(tool.inputSchema.properties).not.toHaveProperty("filename");
    expect(tool.inputSchema.required).toEqual(["filePath"]);
  });

  it("calls the library and returns its JSON", async () => {
    const { fetchImpl, calls } = fakeFetch({
      ...PROFILE_ROUTE,
      "GET /wellness-service/wellness/dailySleepData": () => json({ dailySleepDTO: { id: 7 } }),
    });
    const client = await connect(deps(fetchImpl), [methodTools]);
    const result = await client.callTool({ name: "get_sleep_data", arguments: { cdate: "2026-09-20" } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ dailySleepDTO: { id: 7 } });
    expect(calls.some((c) => c.url.includes("dailySleepData") && c.url.includes("2026-09-20"))).toBe(true);
  });

  it("saves downloads to the download directory", async () => {
    const downloadDir = mkdtempSync(path.join(os.tmpdir(), "gc-dl-"));
    const fit = new Uint8Array(16);
    fit.set(new TextEncoder().encode(".FIT"), 8);
    const { fetchImpl } = fakeFetch({ "GET /workout-service/workout/FIT/42": () => new Response(fit) });
    const client = await connect(deps(fetchImpl, { downloadDir }), [methodTools]);
    const result = await client.callTool({ name: "download_workout", arguments: { workoutId: 42 } });
    expect(JSON.parse(textOf(result))).toEqual({ path: path.join(downloadDir, "download_workout-42.fit"), bytes: 16 });
  });

  it("uploads a local file", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gc-up-"));
    const gpx = path.join(dir, "run.gpx");
    writeFileSync(gpx, '<?xml version="1.0"?><gpx></gpx>');
    const { fetchImpl, calls } = fakeFetch({ "POST /upload-service/upload/gpx": () => json({ detailedImportResult: {} }) });
    const client = await connect(deps(fetchImpl), [methodTools]);
    const result = await client.callTool({ name: "import_activity", arguments: { filePath: gpx } });
    expect(result.isError, textOf(result)).toBeFalsy();
    expect(calls.find((c) => c.method === "POST")?.url).toContain("/upload-service/upload/gpx");
  });

  it("returns a bad file path as a tool error without calling Garmin", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    const client = await connect(deps(fetchImpl), [methodTools]);
    const result = await client.callTool({ name: "import_activity", arguments: { filePath: "run.gpx" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("absolute path");
    expect(calls).toEqual([]);
  });

  it("passes Garmin HTTP errors back as tool errors", async () => {
    const { fetchImpl } = fakeFetch({ ...PROFILE_ROUTE, "GET /activity-service/activity/9": () => json({ message: "nope" }, 500) });
    const client = await connect(deps(fetchImpl), [methodTools]);
    const result = await client.callTool({ name: "get_activity", arguments: { activityId: 9 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Garmin returned HTTP 500/);
  });
});
```

If `getActivity`'s real path differs from `/activity-service/activity/9`, check `src/services/activities.ts` and use its path. The point of the test is the 500 mapping.

- [ ] **Step 4: Run and confirm it fails**

Run: `npx vitest run --root mcp tests/method-tools.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 5: Implement `mcp/src/method-tools.ts`**

```ts
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { GARMIN_METHODS, type ManifestMethod } from "garminconnect-js/manifest";
import { readUpload, saveDownload } from "./files.js";
import { jsonResult } from "./results.js";
import type { ServerDeps, ToolDef, ToolFactory } from "./server.js";

/** Methods deliberately NOT exposed, each with the reason. */
export const EXCLUDED: Readonly<Record<string, string>> = {
  logout: "Deletes the saved Garmin login; not something to do from a chat.",
  uploadWorkout: "Takes raw workout JSON, skipping the builder's checks. create_workout replaces it.",
  uploadRunningWorkout: "Raw workout JSON; create_workout replaces it.",
  uploadCyclingWorkout: "Raw workout JSON; create_workout replaces it.",
  uploadSwimmingWorkout: "Raw workout JSON; create_workout replaces it.",
  uploadStrengthWorkout: "Raw workout JSON; create_workout replaces it.",
  updateWorkout: "Raw workout JSON; update_workout (which takes a spec) replaces it.",
};

/** Methods exposed only when a config flag is on. */
export const OPT_IN: Readonly<Record<string, "enableGraphql">> = {
  queryGarminGraphql: "enableGraphql",
};

export const toolName = (method: string) => method.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function inputSchemaOf(m: ManifestMethod): Tool["inputSchema"] {
  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const p of m.params) {
    if (p.role === "filename") continue; // derived from filePath
    if (p.role === "file") {
      properties["filePath"] = {
        type: "string",
        description: "Absolute path to a local .fit, .gpx or .tcx file (~ is expanded)",
      };
      required.push("filePath");
      continue;
    }
    properties[p.name] = p.schema;
    if (!p.optional) required.push(p.name);
  }
  return { type: "object", properties, ...(required.length > 0 && { required }), additionalProperties: false };
}

function descriptionOf(m: ManifestMethod): string {
  if (m.safety === "destructive") return `${m.description} IRREVERSIBLE: confirm with the user before calling.`;
  return m.description;
}

async function argsFor(m: ManifestMethod, input: Record<string, unknown>): Promise<unknown[]> {
  const args: unknown[] = [];
  let filename: string | undefined;
  for (const p of m.params) {
    if (p.role === "file") {
      const upload = await readUpload(input["filePath"]);
      filename = upload.filename;
      args.push(upload.blob);
    } else if (p.role === "filename") {
      args.push(filename);
    } else {
      args.push(input[p.name]);
    }
  }
  while (args.length > 0 && args[args.length - 1] === undefined) args.pop(); // let defaults apply
  return args;
}

function downloadName(m: ManifestMethod, input: Record<string, unknown>): string {
  const first = m.params[0] ? input[m.params[0].name] : undefined;
  const id = first === undefined ? "file" : String(first).replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64);
  return `${toolName(m.name)}-${id}`;
}

function toolFor(m: ManifestMethod, deps: ServerDeps): ToolDef {
  return {
    tool: {
      name: toolName(m.name),
      description: descriptionOf(m),
      inputSchema: inputSchemaOf(m),
      annotations: {
        title: m.name,
        readOnlyHint: m.safety === "read",
        // MCP treats a MISSING destructiveHint as true, so writes say false explicitly.
        ...(m.safety !== "read" && { destructiveHint: m.safety === "destructive" }),
        openWorldHint: true,
      },
    },
    async run(input) {
      const args = await argsFor(m, input); // file errors surface BEFORE any Garmin call
      const garmin = await deps.session.get();
      const fn = (garmin as unknown as Record<string, unknown>)[m.name];
      if (typeof fn !== "function") throw new Error(`garminconnect-js has no method ${m.name}`);
      const result: unknown = await (fn as (...a: unknown[]) => Promise<unknown>).apply(garmin, args);
      if (m.io === "binary-out") {
        return jsonResult(await saveDownload(deps.config.downloadDir, downloadName(m, input), result as Uint8Array));
      }
      return jsonResult(result);
    },
  };
}

export const methodTools: ToolFactory = (deps) => {
  const known = new Set(GARMIN_METHODS.map((m) => m.category));
  if (deps.config.groups) {
    const unknown = [...deps.config.groups].filter((g) => !known.has(g));
    if (unknown.length > 0) {
      throw new Error(`Unknown GARMIN_MCP_GROUPS value(s): ${unknown.join(", ")}. Valid: ${[...known].sort().join(", ")}`);
    }
  }
  return GARMIN_METHODS.filter((m) => !Object.hasOwn(EXCLUDED, m.name))
    .filter((m) => !Object.hasOwn(OPT_IN, m.name) || deps.config[OPT_IN[m.name]!])
    .filter((m) => deps.config.groups === null || deps.config.groups.has(m.category))
    .map((m) => toolFor(m, deps));
};
```

`mcp/src/tools.ts`:

```ts
import { methodTools } from "./method-tools.js";
import type { ToolFactory } from "./server.js";

/** Every tool the server exposes, in listing order. */
export const TOOL_FACTORIES: readonly ToolFactory[] = [methodTools];
```

- [ ] **Step 6: Run the mcp suite**

Run: `npm run check -w mcp`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mcp/src/files.ts mcp/src/method-tools.ts mcp/src/tools.ts mcp/tests/files.test.ts mcp/tests/method-tools.test.ts
git commit -m "feat(mcp): one tool per Garmin method, generated from the manifest"
git push
```

---

### Task 6: Workout tools (preview, create, update, search) and the summary

**Files:**
- Create: `mcp/src/summary.ts`, `mcp/src/workout-tools.ts`
- Modify: `mcp/src/tools.ts`
- Create: `mcp/tests/summary.test.ts`, `mcp/tests/workout-tools.test.ts`

**Interfaces:**
- Consumes: `workoutFromSpec`, `WORKOUT_SPEC_JSON_SCHEMA`, `WORKOUT_EXERCISE_CATEGORIES`, `WorkoutInput` from `garminconnect-js`; `EXERCISES` from `garminconnect-js/exercises`; `textResult`; `ToolFactory`.
- Produces: `summarizeWorkout(workout: WorkoutInput): string`, `clock(seconds: number): string`, `searchExercises(query: string, category?: string, limit?: number): string[]`, `workoutTools: ToolFactory` (tools `preview_workout`, `create_workout`, `update_workout`, `search_exercises`).

- [ ] **Step 1: Write the failing summary tests**

`mcp/tests/summary.test.ts`:

```ts
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
        "   1. Interval: 400 m · @ 4:00–4:12 /km",
        "   2. Recovery: 2:00",
        "3. Cool-down: 10:00",
      ].join("\n"),
    );
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
```

- [ ] **Step 2: Run and confirm it fails; then implement `mcp/src/summary.ts`**

Run: `npx vitest run --root mcp tests/summary.test.ts`
Expected: FAIL (module missing).

```ts
/**
 * A workout as a person reads it. Presentation only: it reads the built `WorkoutInput`, so what
 * the user confirms in a preview is exactly what would be uploaded.
 */
import type { WorkoutInput } from "garminconnect-js";

type Doc = Record<string, unknown>;

const key = (ref: unknown, field: string): string | undefined => {
  const v = (ref as Doc | null | undefined)?.[field];
  return typeof v === "string" ? v : undefined;
};
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const words = (k: string) => k.toLowerCase().replace(/[._]+/g, " ");
const trim = (n: number) => String(+n.toFixed(1));

export function clock(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

const metres = (m: number) => (m >= 1000 ? `${+(m / 1000).toFixed(2)} km` : `${trim(m)} m`);
const pace = (metresPerSecond: number) => clock(1000 / metresPerSecond);

const STEP_LABEL: Record<string, string> = {
  warmup: "Warm-up",
  cooldown: "Cool-down",
  interval: "Interval",
  recovery: "Recovery",
  rest: "Rest",
  main: "Main",
  other: "Other",
};

function end(step: Doc): string {
  const kind = key(step["endCondition"], "conditionTypeKey");
  const v = num(step["endConditionValue"]) ?? 0;
  switch (kind) {
    case "time":
      return clock(v);
    case "distance":
      return metres(v);
    case "lap.button":
      return "until lap button";
    case "reps":
      return `${v} reps`;
    case "fixed.rest":
      return `${clock(v)} rest`;
    case "calories":
      return `${v} kcal`;
    case "heart.rate":
      return `until heart rate ${v} bpm`;
    case "power":
      return `until ${v} W`;
    case "fixed.repetition":
      return `${v} lengths`;
    default:
      return kind ?? "no end condition";
  }
}

function target(step: Doc, secondary: boolean): string | undefined {
  const f = (primary: string, second: string) => step[secondary ? second : primary];
  const type = key(f("targetType", "secondaryTargetType"), "workoutTargetTypeKey");
  const one = num(f("targetValueOne", "secondaryTargetValueOne"));
  const two = num(f("targetValueTwo", "secondaryTargetValueTwo"));
  const zone = num(f("zoneNumber", "secondaryZoneNumber"));
  const range = (unit: string) => (one !== undefined && two !== undefined ? `${trim(one)}–${trim(two)} ${unit}` : undefined);
  switch (type) {
    case undefined:
    case "no.target":
      return undefined;
    case "pace.zone":
      return one && two ? `${pace(one)}–${pace(two)} /km` : undefined;
    case "speed.zone":
      return range("m/s");
    case "heart.rate.zone":
      return zone !== undefined ? `heart-rate zone ${zone}` : range("bpm");
    case "power.zone":
      return zone !== undefined ? `power zone ${zone}` : range("W");
    case "cadence":
      return range("rpm");
    case "grade":
      return range("% grade");
    case "resistance":
      return range("resistance");
    case "swim.css.offset":
      return one !== undefined ? `CSS ${one >= 0 ? "+" : ""}${one} s` : undefined;
    default:
      return words(type);
  }
}

function stepLine(step: Doc): string {
  const parts = [`${STEP_LABEL[key(step["stepType"], "stepTypeKey") ?? ""] ?? "Step"}: ${end(step)}`];
  const primary = target(step, false);
  const second = target(step, true);
  if (primary) parts.push(`@ ${primary}`);
  if (second) parts.push(`+ ${second}`);
  const exercise = key(step, "exerciseName") ?? key(step, "category");
  if (exercise) parts.push(words(exercise));
  const weight = num(step["weightValue"]);
  if (weight !== undefined) parts.push(`${trim(weight)} kg`);
  for (const [field, k] of [["strokeType", "strokeTypeKey"], ["drillType", "drillTypeKey"], ["equipmentType", "equipmentTypeKey"]] as const) {
    const v = key(step[field], k);
    if (v) parts.push(words(v));
  }
  const note = key(step, "description");
  if (note) parts.push(`"${note}"`);
  return parts.join(" · ");
}

function lines(steps: Doc[], indent: string, out: string[]): void {
  steps.forEach((step, i) => {
    const n = `${indent}${i + 1}. `;
    if (step["type"] === "RepeatGroupDTO") {
      const times = num(step["numberOfIterations"]);
      out.push(`${n}${times !== undefined ? `Repeat ${times}×` : `Repeat for ${clock(num(step["endConditionValue"]) ?? 0)}`}:`);
      lines(step["workoutSteps"] as Doc[], `${indent}   `, out);
    } else {
      out.push(`${n}${stepLine(step)}`);
    }
  });
}

export function summarizeWorkout(workout: WorkoutInput): string {
  const doc = workout as unknown as Doc;
  const sport = key(doc["sportType"], "sportTypeKey") ?? "unknown sport";
  const pool = num(doc["poolLength"]);
  const poolUnit = key(doc["poolLengthUnit"], "unitKey") === "yard" ? "yd" : "m";
  const out = [`${workout.workoutName} — ${words(sport)}${pool !== undefined ? `, ${pool} ${poolUnit} pool` : ""}`];
  const segments = doc["workoutSegments"] as Doc[];
  if (segments.length === 1) {
    lines(segments[0]!["workoutSteps"] as Doc[], "", out);
  } else {
    segments.forEach((segment, i) => {
      out.push(`Leg ${i + 1}: ${words(key(segment["sportType"], "sportTypeKey") ?? "?")}`);
      lines(segment["workoutSteps"] as Doc[], "   ", out);
    });
  }
  return out.join("\n");
}
```

The bike leg's secondary cadence renders as `+ 85–95 rpm` because `parts.join(" · ")` puts ` · ` before it. That matches the expected string in the test.

Run: `npx vitest run --root mcp tests/summary.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing workout-tool tests**

`mcp/tests/workout-tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { workoutFromSpec } from "garminconnect-js";
import { EXERCISES } from "garminconnect-js/exercises";
import { GARMIN_METHODS } from "garminconnect-js/manifest";
import { EXCLUDED, OPT_IN } from "../src/method-tools.js";
import { TOOL_FACTORIES } from "../src/tools.js";
import { searchExercises, workoutTools } from "../src/workout-tools.js";
import { connect, fakeFetch, json, PROFILE_ROUTE, sessionFor, testConfig, textOf } from "./helpers.js";

const SPEC = {
  name: "6x400",
  sport: "running",
  steps: [
    { type: "warmup", lapButton: true },
    { type: "repeat", times: 6, steps: [
      { type: "interval", distance: 400, target: { pace: { minPerKm: [4, 4.2] } } },
      { type: "recovery", time: 120 },
    ] },
  ],
};

const setup = async (routes: Parameters<typeof fakeFetch>[0] = {}) => {
  const { fetchImpl, calls } = fakeFetch({ ...PROFILE_ROUTE, ...routes });
  const client = await connect({ config: testConfig(), session: sessionFor(fetchImpl) }, [workoutTools]);
  return { client, calls };
};

describe("workout tools", () => {
  it("previews without calling Garmin", async () => {
    const { client, calls } = await setup();
    const text = textOf(await client.callTool({ name: "preview_workout", arguments: { spec: SPEC } }));
    expect(text).toContain("2. Repeat 6×:");
    expect(text).toContain("Nothing has been saved");
    expect(calls).toEqual([]);
  });

  it("creates exactly what workoutFromSpec builds", async () => {
    const { client, calls } = await setup({ "POST /workout-service/workout": () => json({ workoutId: 777 }) });
    const result = await client.callTool({ name: "create_workout", arguments: { spec: SPEC } });
    expect(textOf(result)).toMatch(/^Created workout 777\./);
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual(workoutFromSpec(SPEC, EXERCISES));
  });

  it("updates a workout by id", async () => {
    const { client, calls } = await setup({ "PUT /workout-service/workout/5": () => json({ workoutId: 5 }) });
    const result = await client.callTool({ name: "update_workout", arguments: { workoutId: 5, spec: SPEC } });
    expect(result.isError, textOf(result)).toBeFalsy();
    expect(calls.find((c) => c.method === "PUT")!.body).toMatchObject({ workoutId: 5, workoutName: "6x400" });
  });

  it("returns spec mistakes as tool errors, with the path, and sends nothing", async () => {
    const { client, calls } = await setup();
    const bad = { ...SPEC, steps: [{ type: "interval", distance: 400, pace: { minPerKm: [4, 5] } }] };
    const result = await client.callTool({ name: "create_workout", arguments: { spec: bad } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('workout.steps[0]: unknown key "pace"');
    expect(calls).toEqual([]);
  });

  it("finds exercises", async () => {
    expect(searchExercises("back squat")).toContain("SQUAT / BARBELL_BACK_SQUAT");
    expect(searchExercises("squat", "LUNGE").every((l) => l.startsWith("LUNGE / "))).toBe(true);
    expect(searchExercises("", "PLANK").length).toBeGreaterThan(0);
    expect(searchExercises("")).toEqual([]);
    const { client } = await setup();
    expect(textOf(await client.callTool({ name: "search_exercises", arguments: { query: "back squat" } }))).toContain("BARBELL_BACK_SQUAT");
  });

  it("exposes the spec schema with $defs at the tool root", async () => {
    const { client } = await setup();
    const tool = (await client.listTools()).tools.find((t) => t.name === "create_workout")!;
    expect(tool.inputSchema.required).toEqual(["spec"]);
    expect(tool.inputSchema).toHaveProperty("$defs.step");
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });

  it("registers every tool once, across all factories", () => {
    const deps = { config: testConfig(), session: sessionFor(fakeFetch({}).fetchImpl) };
    const all = TOOL_FACTORIES.flatMap((f) => f(deps)).map((t) => t.tool.name);
    const generated = GARMIN_METHODS.filter((m) => !(m.name in EXCLUDED) && !(m.name in OPT_IN)).length;
    expect(all).toHaveLength(generated + 4);
    expect(new Set(all).size).toBe(all.length);
  });
});
```

- [ ] **Step 4: Run and confirm it fails**

Run: `npx vitest run --root mcp tests/workout-tools.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 5: Implement `mcp/src/workout-tools.ts`**

```ts
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { WORKOUT_EXERCISE_CATEGORIES, WORKOUT_SPEC_JSON_SCHEMA, workoutFromSpec, type WorkoutInput } from "garminconnect-js";
import { EXERCISES } from "garminconnect-js/exercises";
import { textResult } from "./results.js";
import type { ToolFactory } from "./server.js";
import { summarizeWorkout } from "./summary.js";

// The spec schema nests under `spec`; its $defs must sit at the TOOL root for "#/$defs/…" refs.
const { $schema: _schema, $defs, ...SPEC } = WORKOUT_SPEC_JSON_SCHEMA;

function specInput(extra: Record<string, object> = {}): Tool["inputSchema"] {
  return {
    type: "object",
    properties: { ...extra, spec: SPEC },
    required: [...Object.keys(extra), "spec"],
    additionalProperties: false,
    $defs,
  };
}

const build = (input: Record<string, unknown>): WorkoutInput => workoutFromSpec(input["spec"], EXERCISES);
const asJson = (w: WorkoutInput) => w as unknown as Record<string, unknown>;

const UNITS = "Paces are minutes as decimals (4:30 = 4.5), distances metres, times seconds.";

export function searchExercises(query: string, category?: string, limit = 25): string[] {
  const words = query.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (words.length === 0 && !category) return [];
  const hits: { line: string; score: number }[] = [];
  for (const [cat, names] of Object.entries(EXERCISES) as [string, readonly string[]][]) {
    if (category && cat !== category) continue;
    for (const name of names) {
      const parts = name.split("_").filter(Boolean);
      const matched = words.filter((w) => parts.some((p) => p.startsWith(w))).length;
      if (words.length > 0 && matched === 0) continue;
      hits.push({ line: `${cat} / ${name}`, score: matched * 100 - parts.length });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score || a.line.localeCompare(b.line))
    .slice(0, limit)
    .map((h) => h.line);
}

export const workoutTools: ToolFactory = ({ session }) => [
  {
    tool: {
      name: "preview_workout",
      description:
        "Check a workout and show it in readable form WITHOUT saving anything. Always call this first, show the user " +
        `the result, and wait for them to confirm before create_workout. ${UNITS}`,
      inputSchema: specInput(),
      annotations: { title: "Preview workout", readOnlyHint: true, openWorldHint: false },
    },
    run: async (input) =>
      textResult(
        `${summarizeWorkout(build(input))}\n\nNothing has been saved. If the user confirms, call create_workout with the same spec.`,
      ),
  },
  {
    tool: {
      name: "create_workout",
      description:
        "Save a workout to the user's Garmin Connect workout library. Only after the user has confirmed a " +
        "preview_workout of the same spec. Look exercise names up with search_exercises first; an unknown name is " +
        "rejected. Afterwards, schedule_workout puts it on the calendar and push_workout_to_device sends it to the " +
        `watch. ${UNITS}`,
      inputSchema: specInput(),
      annotations: { title: "Create workout", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    run: async (input) => {
      const workout = build(input);
      const created = await (await session.get()).uploadWorkout(asJson(workout));
      const id = (created as { workoutId?: unknown } | null)?.workoutId;
      return textResult(`Created workout${id !== undefined ? ` ${String(id)}` : ""}.\n\n${summarizeWorkout(workout)}`);
    },
  },
  {
    tool: {
      name: "update_workout",
      description:
        "Replace an existing workout with a new spec. This OVERWRITES the whole workout; confirm with the user first, " +
        `ideally after preview_workout. ${UNITS}`,
      inputSchema: specInput({ workoutId: { type: ["integer", "string"], description: "From get_workouts or create_workout" } }),
      annotations: { title: "Update workout", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    run: async (input) => {
      const workout = build(input);
      const id = input["workoutId"] as number | string;
      await (await session.get()).updateWorkout(id, asJson(workout));
      return textResult(`Updated workout ${String(id)}.\n\n${summarizeWorkout(workout)}`);
    },
  },
  {
    tool: {
      name: "search_exercises",
      description:
        "Find Garmin exercise names for strength, HIIT, cardio, yoga, pilates and mobility steps. Returns " +
        "CATEGORY / NAME lines; use them as exercise: { category, name }.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: 'Words to look for, e.g. "back squat" or "push up"' },
          category: { enum: [...WORKOUT_EXERCISE_CATEGORIES], description: "Only search this category" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { title: "Search exercises", readOnlyHint: true, openWorldHint: false },
    },
    run: async (input) => {
      const hits = searchExercises(String(input["query"] ?? ""), input["category"] as string | undefined);
      return textResult(
        hits.length > 0 ? hits.join("\n") : "No matching exercises. Try fewer or different words, or a category alone (e.g. SQUAT).",
      );
    },
  },
];
```

`mcp/src/tools.ts`:

```ts
import { methodTools } from "./method-tools.js";
import type { ToolFactory } from "./server.js";
import { workoutTools } from "./workout-tools.js";

/** Every tool the server exposes, in listing order: the hand-written workout tools first. */
export const TOOL_FACTORIES: readonly ToolFactory[] = [workoutTools, methodTools];
```

- [ ] **Step 6: Run the mcp suite and the root check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mcp/src/summary.ts mcp/src/workout-tools.ts mcp/src/tools.ts mcp/tests/summary.test.ts mcp/tests/workout-tools.test.ts
git commit -m "feat(mcp): preview, create, update and search workout tools"
git push
```

---

### Task 7: Lockstep release, live smoke, docs

**Files:**
- Create: `tests/mcp-package.test.ts`, `mcp/tests/dist.test.ts`, `mcp/scripts/smoke.ts`, `mcp/README.md`
- Modify: root `package.json` (scripts `bump`, `smoke:mcp`), `.github/workflows/publish.yml`, `AGENTS.md`, `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `createServer`, `TOOL_FACTORIES`, `fileSession`, `loadConfig` from `mcp/src`; the MCP SDK client + in-memory transport.
- Produces: `npm run bump -- X.Y.Z` (bumps both versions), `npm run smoke:mcp` (live round-trip, test account only), and publishing of both packages from one `v*` tag.

- [ ] **Step 1: Write the failing contract tests**

`tests/mcp-package.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe("garminconnect-mcp package contract", () => {
  const root = read("package.json");
  const mcp = read("mcp/package.json");

  it("is released in lockstep with the library", () => {
    expect(mcp.version, "run `npm run bump -- <version>` to bump both").toBe(root.version);
  });

  it("depends only on the MCP SDK; the library is bundled, not installed", () => {
    expect(Object.keys(mcp.dependencies)).toEqual(["@modelcontextprotocol/sdk"]);
    expect(readFileSync("mcp/tsup.config.ts", "utf8")).toContain("noExternal: [/^garminconnect-js/]");
  });

  it("is a workspace of this repo, and the library keeps zero dependencies", () => {
    expect(root.workspaces).toEqual(["mcp"]);
    expect(root.dependencies).toEqual({});
  });
});
```

`mcp/tests/dist.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `npm run check -w mcp` builds before it tests, so dist exists there. A bare `vitest` without a
// build skips instead of failing, the same convention as the root tests/dist.test.ts.
const CLI = new URL("../dist/cli.js", import.meta.url);
const describeBuilt = existsSync(CLI) ? describe : describe.skip;

describeBuilt("built CLI", () => {
  const source = existsSync(CLI) ? readFileSync(CLI, "utf8") : "";
  it("is executable as a bin", () => {
    expect(source.startsWith("#!/usr/bin/env node")).toBe(true);
  });
  it("inlines garminconnect-js instead of importing it", () => {
    expect(source).not.toMatch(/from\s*["']garminconnect-js/);
    expect(source).toContain("workoutFromSpec");
  });
});
```

Run: `npx vitest run tests/mcp-package.test.ts && npm run check -w mcp`
Expected: PASS right away if Tasks 4–6 were followed. These tests pin the contract so it can't erode later. If one fails, fix the package, not the test.

- [ ] **Step 2: Bump and smoke scripts**

Root `package.json` scripts:

```jsonc
"bump": "npm version --no-git-tag-version --workspaces --include-workspace-root",
"smoke:mcp": "tsx --tsconfig mcp/tsconfig.json mcp/scripts/smoke.ts",
"lint": "eslint src tests scripts examples mcp/src mcp/tests mcp/scripts",
```

Check the bump without keeping it: `npm run bump -- 0.6.1 && git diff --stat && git checkout package.json mcp/package.json package-lock.json`
Expected: the diff shows both `package.json` versions and the lockfile changed, then they're restored.

- [ ] **Step 3: Write the live smoke script**

`mcp/scripts/smoke.ts`:

```ts
/**
 * Drives the REAL server through an MCP client against the TEST account: preview, create, read
 * back, assert the STORED workout, delete. A 2xx proves nothing (that is how the walking/hiking
 * helpers once shipped "verified" while storing a null sport), so this checks the stored document.
 *
 *   npm run smoke:mcp
 */
import "../../scripts/load-env.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { fileSession, loadConfig } from "../src/session.js";
import { TOOL_FACTORIES } from "../src/tools.js";

const session = fileSession("./tokens");
const garmin = await session.get().catch(() => {
  console.error("No tokens in ./tokens. Run `npm run login` first.");
  process.exit(1);
});

// SAFETY GATE: identical to every other write script here. Not conditional, not skippable.
const expected = process.env["GARMIN_TEST_PROFILE_ID"];
if (!expected) {
  console.error("Refusing to run: GARMIN_TEST_PROFILE_ID is not set. Nothing was written.");
  process.exit(1);
}
const profile = await garmin.getUserProfile();
if (String(profile.profileId) !== String(expected)) {
  console.error(`Refusing to run: profile ${String(profile.profileId)} is not the test account. Nothing was written.`);
  process.exit(1);
}
console.log(`Safety gate passed: ${String(profile.profileId)}\n`);

const server = createServer({ config: loadConfig({ GARMIN_MCP_TOKEN_DIR: "./tokens" }), session }, TOOL_FACTORIES);
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "smoke", version: "0" });
await client.connect(clientSide);

const text = (r: unknown) => (r as { content: { text?: string }[] }).content.map((c) => c.text ?? "").join("\n");
const call = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name} failed: ${text(r)}`);
  return text(r);
};

const SPEC = {
  name: `mcp smoke ${new Date().toISOString()}`,
  sport: "running",
  steps: [
    { type: "warmup", lapButton: true },
    { type: "repeat", times: 6, steps: [
      { type: "interval", distance: 400, target: { pace: { minPerKm: [4.2, 4] } } }, // deliberately reversed
      { type: "recovery", time: 120 },
    ] },
    { type: "cooldown", time: 600 },
  ],
};

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

type Doc = Record<string, unknown>;
let workoutId: string | undefined;
try {
  console.log(await call("preview_workout", { spec: SPEC }), "\n");
  const created = await call("create_workout", { spec: SPEC });
  workoutId = /Created workout (\d+)/.exec(created)?.[1];
  check("create_workout returned an id", workoutId !== undefined, created.split("\n")[0]);
  if (workoutId) {
    const stored = JSON.parse(await call("get_workout_by_id", { workoutId })) as Doc;
    const segment = (stored["workoutSegments"] as Doc[])[0]!;
    const steps = segment["workoutSteps"] as Doc[];
    const repeat = steps[1]!;
    const interval = (repeat["workoutSteps"] as Doc[])[0]!;
    const orders: number[] = [];
    const walk = (list: Doc[]) => list.forEach((s) => { orders.push(s["stepOrder"] as number); if (s["type"] === "RepeatGroupDTO") walk(s["workoutSteps"] as Doc[]); });
    walk(steps);
    check("stored sport is running", (stored["sportType"] as Doc)["sportTypeKey"] === "running");
    check("stepOrders are globally unique", new Set(orders).size === orders.length, orders.join(","));
    check("repeat stored 6 iterations", repeat["numberOfIterations"] === 6);
    const one = interval["targetValueOne"] as number;
    const two = interval["targetValueTwo"] as number;
    check("pace stored fastest first despite reversed input", one > two && Math.abs(one - 1000 / 240) < 0.01, `${one} / ${two}`);
  }
} finally {
  if (workoutId) {
    await call("delete_workout", { workoutId });
    const after = await client.callTool({ name: "get_workout_by_id", arguments: { workoutId } });
    check("delete_workout removed it", after.isError === true || text(after).startsWith("null"), text(after).slice(0, 80));
  }
  await client.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

Run: `npm run lint && npx tsc --noEmit -p mcp`
Expected: clean.

- [ ] **Step 4: Run the live smoke against the test account**

Precondition: `./tokens` holds the TEST account's session and `.env` sets `GARMIN_TEST_PROFILE_ID`. If either is missing, STOP. Report to the maintainer and do not log in with any other account.

Run: `npm run smoke:mcp`
Expected: `Safety gate passed`, a readable preview, five `PASS` lines, and `All checks passed.`

A FAIL is a real finding. Report it verbatim; don't loosen the check.

- [ ] **Step 5: Publish workflow**

In `.github/workflows/publish.yml`, after the `- run: npm publish` step, add:

```yaml
      # The MCP server ships from the same tag, AFTER the library. tests/mcp-package.test.ts (run by
      # both packages' prepublishOnly) guarantees its version equals the library's.
      # FIRST RELEASE ONLY: garminconnect-mcp must exist on npm before trusted publishing can be
      # configured for it — the maintainer publishes it once by hand (`npm publish -w mcp`), then
      # adds this repo + publish.yml as its trusted publisher on npmjs.com.
      - run: npm publish -w mcp
```

- [ ] **Step 6: `mcp/README.md`**

````markdown
# garminconnect-mcp

Talk to Claude to create Garmin workouts, and read or manage the rest of your Garmin Connect data,
through an [MCP](https://modelcontextprotocol.io) server built on
[garminconnect-js](https://github.com/DynamicsNinja/garminconnect-js).

> "Make me a 6×400 m session at 5k pace with 2-minute jog recoveries, put it on Thursday, and send
> it to my watch."

Claude previews the workout, waits for your OK, saves it to your Garmin workout library, schedules
it, and pushes it to your device.

## Set up

1. **Sign in once** (in a terminal; your password never passes through Claude):

   ```sh
   npx garminconnect-mcp login
   ```

   It asks for your Garmin email, password and, if enabled, your MFA code. The session is saved to
   `~/.garminconnect-mcp/tokens` and renews itself as long as you use it at least once every 30 days.

2. **Add it to Claude Desktop**: Settings → Developer → Edit Config, then in
   `claude_desktop_config.json`:

   ```json
   {
     "mcpServers": {
       "garmin": { "command": "npx", "args": ["-y", "garminconnect-mcp"] }
     }
   }
   ```

   On Windows, if Claude Desktop cannot start `npx`, use
   `"command": "cmd", "args": ["/c", "npx", "-y", "garminconnect-mcp"]`.

3. Restart Claude Desktop.

## What it can do

- **Workouts**: `preview_workout`, `create_workout`, `update_workout`, `search_exercises`, for every
  sport the builder supports (running, cycling, swimming, strength, HIIT, yoga, pilates, mobility,
  cardio, rucking, multi-sport). Workouts are checked before anything is sent: an unknown exercise
  name or a malformed step is reported back to Claude with exactly where the problem is.
- **Everything else in garminconnect-js**: sleep, HRV, stress, training readiness and status, race
  predictions, activities (list, details, download, upload files), gear, courses, devices, badges,
  weigh-ins, and more. One tool per library method.

Tools that delete or overwrite data are marked destructive, so Claude Desktop asks before running
them even if you auto-approve the rest.

**Not exposed:** `logout` (it would delete your saved session), the raw-JSON workout uploads (the
checked `create_workout` replaces them), and the raw GraphQL passthrough unless you opt in.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `GARMIN_MCP_TOKEN_DIR` | `~/.garminconnect-mcp/tokens` | Where the session is saved |
| `GARMIN_MCP_DOWNLOAD_DIR` | `~/Downloads/garmin` | Where downloaded files (FIT, GPX, …) go |
| `GARMIN_MCP_GROUPS` | all | Comma-separated tool groups: `wellness`, `activities`, `metrics`, `workouts`, `gear`, `courses`, `devices`, `badges-challenges`, `body-composition-weight`, `womens-health`, `golf`, `profile-and-misc`. The workout-builder tools are always on. Fewer groups means less of Claude's context used. |
| `GARMIN_MCP_ENABLE_GRAPHQL` | off | Set to `1` to expose `query_garmin_graphql` |

Set them under `"env"` in the Claude Desktop config entry.

## Good to know

- Dates are calendar dates in UTC (`YYYY-MM-DD`).
- Everything runs on your machine. Your Garmin session stays in your token folder and is sent only
  to Garmin.
- Garmin Connect's API is unofficial and can change; this server moves in lockstep with
  garminconnect-js, and each release is tested against the library version it contains.
````

- [ ] **Step 7: AGENTS.md, README, CHANGELOG**

Append a new section to `AGENTS.md`:

````markdown
## 9. The MCP server (`mcp/`, npm `garminconnect-mcp`)

A workspace package that exposes this library to Claude over MCP (stdio, for Claude Desktop).
It holds NO Garmin knowledge of its own:

- **Workout tools** (`preview_workout`, `create_workout`, `update_workout`, `search_exercises`) wrap
  `workoutFromSpec` + `WORKOUT_SPEC_JSON_SCHEMA` + `garminconnect-js/exercises`.
- **Every other tool is generated** from `garminconnect-js/manifest` (one per `Garmin` method,
  snake_case), minus the exclusions in `mcp/src/method-tools.ts` (`EXCLUDED`, `OPT_IN`), each with
  a reason. Annotations come from the manifest's safety class.
- It imports the library ONLY through `garminconnect-js`, `/exercises` and `/manifest`, resolved to
  `../src` by `mcp/tsconfig.json` `paths` and INLINED by tsup. An ESLint rule forbids
  `../../src` imports. So after changing a `Garmin` method, run `npm run manifest`; the MCP tools
  follow automatically, and `npm run check` (which runs `check -w mcp`) fails if they break.
- Released in lockstep: `npm run bump -- X.Y.Z` bumps both versions, and one `vX.Y.Z` tag publishes
  the library, then the server (`publish.yml`). `tests/mcp-package.test.ts` pins that.
- `npm run smoke:mcp` round-trips a workout through the real server against the TEST account only
  (same `GARMIN_TEST_PROFILE_ID` gate as every write script).
- stdout is reserved for MCP frames; the server logs to stderr only.
````

In `README.md`, right before `## 📊 API coverage`, add:

```markdown
## 🤖 Use it from Claude

[`garminconnect-mcp`](mcp/README.md) puts this library behind an MCP server, so you can ask Claude
Desktop to build a workout, schedule it and send it to your watch, or to read your sleep and
training data. It ships from this repo, in lockstep with the library.
```

In `README.md`'s `## 🛠️ Development setup`, add a line: "Release: `npm run bump -- X.Y.Z` bumps the library and `garminconnect-mcp` together; pushing tag `vX.Y.Z` publishes both."

`CHANGELOG.md`, Unreleased, `### Added`:

```markdown
- **`garminconnect-mcp`**, a new package in `mcp/`: an MCP server for Claude Desktop. Describe a
  workout in plain English and Claude previews it, saves it, schedules it and sends it to your
  watch; every other library method is available as a tool too. Generated from
  `garminconnect-js/manifest` and released in lockstep with the library. See `mcp/README.md`.
```

- [ ] **Step 8: Full check**

Run: `npm run check`
Expected: PASS, including `tests/agents-md.test.ts` and `tests/doc-links.test.ts`, which cover the new README link to `mcp/README.md`.

- [ ] **Step 9: Commit**

```bash
git add tests/mcp-package.test.ts mcp/tests/dist.test.ts mcp/scripts/smoke.ts mcp/README.md package.json .github/workflows/publish.yml AGENTS.md README.md CHANGELOG.md
git commit -m "feat(mcp): lockstep release, live smoke test, and docs"
git push
```

Do NOT bump the version, tag or publish. The release is the maintainer's call, and so is the first manual `npm publish -w mcp`.
