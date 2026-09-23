import { defineConfig } from "tsup";

export default defineConfig({
  // Two entry points. `src/exercises.ts` is ~60 KB of catalogue data that most callers never
  // need, so it is published as the `garminconnect-js/exercises` subpath rather than folded into
  // the root bundle — importing the root pulls in none of it.
  entry: ["src/index.ts", "src/exercises.ts"],
  format: ["esm", "cjs"],
  // The emitted `.d.ts` references `Buffer` in four public signatures
  // (`GarminClient.download`, `downloadActivity`, `downloadWorkout`,
  // `downloadHealthSnapshot`). `@types/node` is a devDependency only, so without this
  // triple-slash directive a consumer who has not installed `@types/node` themselves gets
  // `TS2580: Cannot find name 'Buffer'` from our own declarations. The public return types stay
  // `Buffer` (not `Uint8Array`) — narrowing them would be a real API change and `Buffer`'s
  // methods are useful to callers here.
  dts: { banner: '/// <reference types="node" />' },
  clean: true,
  sourcemap: true,
  target: "node18",
  platform: "node",
});
