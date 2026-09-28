import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `npm run check -w mcp` builds before it tests, so dist exists there. A bare `vitest` without a
// build skips instead of failing, the same convention as the root tests/dist.test.ts.
const CLI = new URL("../dist/cli.js", import.meta.url);
const describeBuilt = existsSync(CLI) ? describe : describe.skip;

describeBuilt("built CLI", () => {
  const source = existsSync(CLI) ? readFileSync(CLI, "utf8") : "";
  it("is executable as a bin", () => {
    expect(source.startsWith("#!/usr/bin/env node")).toBe(true);
  });
  it("inlines garminconnect-js instead of importing it", () => {
    expect(source).not.toMatch(/from\s*["']garminconnect-js/);
    expect(source).toContain("workoutFromSpec");
  });
});
