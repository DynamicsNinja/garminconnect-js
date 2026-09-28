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
