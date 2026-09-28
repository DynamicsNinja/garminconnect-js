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
    expect((WORKOUT_SPEC_JSON_SCHEMA.properties as Record<string, { enum: unknown[] }>).sport!.enum).toEqual([...WORKOUT_SPORTS]);
    expect(defs.exercise!.properties.category!.enum).toEqual([...WORKOUT_EXERCISE_CATEGORIES]);
    expect(Object.keys(defs.simpleStep!.properties).sort()).toEqual(["type", ...SPEC_STEP_OPTION_KEYS].sort());
  });

  it("keeps the root usable as a tool input schema", () => {
    expect(WORKOUT_SPEC_JSON_SCHEMA.type).toBe("object");
    for (const k of ["oneOf", "anyOf", "allOf"]) expect(WORKOUT_SPEC_JSON_SCHEMA).not.toHaveProperty(k);
  });
});
