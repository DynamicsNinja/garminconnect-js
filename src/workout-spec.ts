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
const NUMERIC_END_KEYS = SPEC_END_KEYS.filter((k) => k !== "lapButton");

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
  const s = JSON.stringify(v) ?? Object.prototype.toString.call(v);
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
  if (e["name"] === undefined) return { category };
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
