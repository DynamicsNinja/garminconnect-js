import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
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
