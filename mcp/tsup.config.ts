import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig([
  {
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
  },
  {
    // The Desktop Extension's server: EVERYTHING inlined (SDK, ajv, the library) so it runs from an
    // extension folder with no node_modules. The npm build above keeps SDK/ajv external.
    entry: { index: "src/cli.ts" },
    outDir: "dist-bundle",
    format: ["esm"],
    target: "node18",
    platform: "node",
    clean: true,
    sourcemap: false,
    define: { __MCP_VERSION__: JSON.stringify(version) },
    noExternal: [/.*/],
    // The extension folder ships with no package.json, so there is no "type": "module" for Node to
    // read. Node 22 auto-detects ESM from source; Node 18/20 don't and fail with "Cannot use import
    // statement outside a module". A `.mjs` extension forces ESM regardless of Node version.
    outExtension: () => ({ js: ".mjs" }),
    // CommonJS dependencies (ajv) call require(); give the ESM bundle one.
    banner: { js: "import { createRequire as __gcCreateRequire } from 'node:module'; const require = __gcCreateRequire(import.meta.url);" },
    // Keep the MIT/license comments of the inlined dependencies (MCP SDK, ajv, …) in the bundle,
    // collected at the end of the file, instead of esbuild's default of stripping them.
    esbuildOptions(options) {
      options.legalComments = "eof";
    },
  },
]);
