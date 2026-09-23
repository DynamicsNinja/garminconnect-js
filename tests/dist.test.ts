import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The build-contract suite (`tests/build.test.ts`) only ever read `package.json` and grepped
 * `src/` — nothing loaded the built artifact. That is why two packaging defects shipped green:
 *
 *  - C1: `src/index.ts` used `export type *` for `types/workouts.js`, which also declares four
 *    RUNTIME constants. tsup's d.ts rollup listed them in the final export list WITHOUT a `type`
 *    modifier while neither JS bundle exported them at all, so `require(...).WORKOUT_SPORT_TYPE_ID`
 *    was `undefined` and the ESM import threw `SyntaxError: does not provide an export named ...`.
 *  - I3: the emitted `.d.ts` referenced `Buffer` with no `/// <reference types="node" />`, so a
 *    consumer without `@types/node` got `TS2580: Cannot find name 'Buffer'`.
 *
 * This suite closes both by loading `dist` for real. It SKIPS when `dist/` is absent, because
 * `npm test` runs before `npm run build`; it genuinely fails whenever `dist` exists and drifts.
 */
const DIST = path.resolve("dist");
const ESM = path.join(DIST, "index.js");
const CJS = path.join(DIST, "index.cjs");
const DTS = path.join(DIST, "index.d.ts");

const built = existsSync(ESM) && existsSync(CJS) && existsSync(DTS);
const describeBuilt = built ? describe : describe.skip;

/**
 * Pulls the names from the final `export { ... };` statement of the rolled-up `.d.ts` and splits
 * them into type-only names (`type Foo`) and value names (bare `Foo`). A value name in the
 * declarations is a promise that the JS bundles export it at runtime.
 */
function declaredExports(source: string): { values: string[]; types: string[] } {
  const statements = [...source.matchAll(/export\s*\{([^}]*)\}\s*;/g)];
  const last = statements[statements.length - 1];
  if (!last) throw new Error("dist/index.d.ts has no `export { ... };` statement");
  const values: string[] = [];
  const types: string[] = [];
  for (const raw of last[1]!.split(",")) {
    const name = raw.trim();
    if (!name) continue;
    // Handle `X as Y` by taking the exported (right-hand) name.
    const exported = name.split(/\s+as\s+/).pop()!.trim();
    if (/^type\s/.test(name)) types.push(exported);
    else values.push(exported);
  }
  return { values, types };
}

describeBuilt("built package (dist)", () => {
  const dts = built ? readFileSync(DTS, "utf8") : "";
  const declared = built ? declaredExports(dts) : { values: [], types: [] };

  it("declares Buffer's types so a consumer without @types/node can compile (I3)", () => {
    expect(dts).toMatch(/^\/\/\/ <reference types="node" \/>/);
    expect(readFileSync(path.join(DIST, "index.d.cts"), "utf8")).toMatch(
      /^\/\/\/ <reference types="node" \/>/,
    );
  });

  it("finds value exports in the declarations at all", () => {
    // A guard on the guard: if the d.ts parse silently produced an empty list, the two
    // export-set assertions below would pass vacuously.
    expect(declared.values.length).toBeGreaterThan(5);
    expect(declared.types.length).toBeGreaterThan(50);
  });

  it("CJS exports exactly the non-type names the declarations promise (C1, M7)", () => {
    const require = createRequire(import.meta.url);
    const mod = require(CJS) as Record<string, unknown>;
    expect(Object.keys(mod).sort()).toEqual([...declared.values].sort());
  });

  it("ESM exports exactly the non-type names the declarations promise (C1, M7)", async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(ESM).href)) as Record<
      string,
      unknown
    >;
    const keys = Object.keys(mod).filter((k) => k !== "default" && k !== "__esModule");
    expect(keys.sort()).toEqual([...declared.values].sort());
  });

  it("the four workout constants are real runtime values in both bundles (C1)", async () => {
    const names = [
      "WORKOUT_SPORT_TYPE_ID",
      "WORKOUT_STEP_TYPE_ID",
      "WORKOUT_CONDITION_TYPE_ID",
      "WORKOUT_TARGET_TYPE_ID",
    ] as const;
    const require = createRequire(import.meta.url);
    const cjs = require(CJS) as Record<string, unknown>;
    const esm = (await import(/* @vite-ignore */ pathToFileURL(ESM).href)) as Record<
      string,
      unknown
    >;
    for (const name of names) {
      expect(cjs[name], `CJS must export ${name}`).toBeTypeOf("object");
      expect(esm[name], `ESM must export ${name}`).toBeTypeOf("object");
    }
    expect((cjs["WORKOUT_SPORT_TYPE_ID"] as Record<string, number>)["RUNNING"]).toBe(1);
  });
});
