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
  // `lib` is pinned to ES2022 only (no DOM): the default lib set for an ES2022 target includes
  // `lib.dom.d.ts`, whose global `Node` interface otherwise shadows this fixture's own `Node`
  // type alias when resolving the self-referencing `children: Node[]` array's item type — the
  // recursion then walks DOM's `Node` (`childNodes`, `appendChild`, …) instead of the fixture.
  const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts"] };
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

  it("is the same on every platform: no CR characters from a CRLF checkout", () => {
    // Doc comments read from a Windows (CRLF) clone once leaked "\r\n" into the JSON strings, so
    // the committed manifest matched locally and was "stale" in CI's LF checkout.
    expect(JSON.stringify(GARMIN_METHODS)).not.toContain("\\r");
  });

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
    expect(method("queryGarminGraphql").safety).toBe("destructive");
    // Replaces the WHOLE gear-defaults list, not a merge: `[]` clears every default.
    expect(method("setGearActivityDefaults").safety).toBe("destructive");
  });

  it("marks every bare-Date param for coercion, and only those", () => {
    for (const m of GARMIN_METHODS) {
      for (const p of m.params) {
        if (p.schema["format"] === "date-time") {
          expect(p.coerce, `${m.name}.${p.name}`).toBe("date");
        } else {
          expect(p.coerce, `${m.name}.${p.name}`).toBeUndefined();
        }
      }
    }
    expect(method("addWeighIn").params.find((p) => p.name === "when")).toMatchObject({
      coerce: "date",
      schema: { type: "string", format: "date-time" },
    });
    // `string | Date` stays a calendar date, not a coerced moment-in-time.
    expect(method("getSleepData").params[0]).toMatchObject({ schema: { format: "date" } });
    expect(method("getSleepData").params[0]!.coerce).toBeUndefined();
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

  it("only gives 'Numeric id' wording to number|string params whose name looks like an id", () => {
    expect(method("getActivity").params[0]).toMatchObject({ name: "activityId", schema: { description: "Numeric id" } });
    expect(method("deleteBloodPressure").params[0]).toMatchObject({ name: "version" });
    expect(method("deleteBloodPressure").params[0]!.schema["description"]).toBeUndefined();
    for (const p of method("getScheduledWorkouts").params) {
      expect(p.schema["description"], p.name).toBeUndefined();
    }
  });

  it("strips internal-jargon phrases out of descriptions", () => {
    for (const m of GARMIN_METHODS) {
      expect(m.description, m.name).not.toMatch(/passes through unchecked/i);
      expect(m.description, m.name).not.toMatch(/\bupstream\b|\bparity\b/i);
      expect(m.description, m.name).not.toMatch(/see gotchas/i);
      expect(m.description, m.name).not.toMatch(/no proven inverse write/i);
      // Removal leftovers: a dangling separator where a phrase was cut out.
      expect(m.description, m.name).not.toMatch(/[,;]\s*:/);
      // …or an orphaned clause that only made sense after "see gotchas".
      expect(m.description, m.name).not.toMatch(/for (the payload shape|where the body shape)/);
    }
  });

  it("keeps literal ellipses from the notes intact while stripping jargon", () => {
    // A blanket punctuation collapse once turned `/heartRate/...` into `/heartRate/.` and
    // `.../stats` into `./stats`, which reads as a different path.
    expect(method("getActivitiesForDate").description).toContain("/mobile-gateway/heartRate/...");
    expect(method("getEnduranceScore").description).toContain(".../stats");
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
