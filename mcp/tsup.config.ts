import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  sourcemap: true,
  define: { __MCP_VERSION__: JSON.stringify(version) },
  // Inline garminconnect-js (resolved to ../src through tsconfig `paths`). The server is released in
  // lockstep with the library and must never run against a different version of it.
  noExternal: [/^garminconnect-js/],
});
