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
            "Garmin's exercise key in SCREAMING_SNAKE_CASE. Look it up with search_exercises; " +
            "an unknown name is rejected. Omit it to use the category alone.",
        },
      },
      required: ["category"],
      additionalProperties: false,
    },
  },
};
