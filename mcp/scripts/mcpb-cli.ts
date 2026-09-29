/** Locates Anthropic's `mcpb` CLI entry point. Shared by build-mcpb.ts and tests/mcpb.test.ts. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The mcpb CLI entry, found by walking up from `startDir` to the nearest node_modules (workspaces
 * hoist it).
 *
 * Deviation from the task-4 brief: `@anthropic-ai/mcpb@2.1.2`'s package.json declares `"bin"` as a
 * plain STRING (`"dist/cli/cli.js"`), not an object keyed by command name as the brief's snippet
 * assumed (`bin["mcpb"]`). Handle both shapes so this keeps working if a future version switches.
 */
export function mcpbCli(startDir: string): string {
  for (let dir = startDir; ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, "node_modules", "@anthropic-ai", "mcpb", "package.json");
    if (existsSync(manifest)) {
      const bin = (JSON.parse(readFileSync(manifest, "utf8")) as { bin: string | Record<string, string> }).bin;
      const rel = typeof bin === "string" ? bin : bin["mcpb"]!;
      return path.join(path.dirname(manifest), rel);
    }
    if (path.dirname(dir) === dir) throw new Error("@anthropic-ai/mcpb is not installed");
  }
}
