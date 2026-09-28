import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (file: string) => fileURLToPath(new URL(`../src/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^garminconnect-js\/exercises$/, replacement: src("exercises.ts") },
      { find: /^garminconnect-js\/manifest$/, replacement: src("manifest.ts") },
      { find: /^garminconnect-js$/, replacement: src("index.ts") },
    ],
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
