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
