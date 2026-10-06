import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The library started from another project and has long since grown its own surface. Describing
 * it as a port of that project — "upstream", "parity", "python-garminconnect" — or crediting each
 * endpoint to another client is noise in the code, the docs and the agent briefing, and it reads
 * as if those projects still defined what this one is. This keeps the wording from creeping back.
 *
 * Out of scope on purpose: NOTICE (the license-required attribution), CHANGELOG.md (released
 * entries are history), and the dated design notes under docs/superpowers and docs/webapp-*.
 * README's single credit line, which points at NOTICE, is the one allowed mention.
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
// `garmin_mcp` is matched case-SENSITIVELY: the MCP server's own GARMIN_MCP_* env vars are fine.
const PATTERN = /\bupstream\b|\bparity\b|python-garminconnect|taxuspt|florianpasteur/i;
const CASE_SENSITIVE = /garmin_mcp/;
const ALLOWED_LINES: [string, RegExp][] = [
  ["README.md", /attribution is in \[`NOTICE`\]|^\[python-garminconnect-url\]:/],
];

const FILES = ["README.md", "AGENTS.md", "WORKOUTS.md", "SECURITY.md", "mcp/README.md", "mcp/PRIVACY.md"];
const DIRS = ["src", "docs/api", "scripts", "tests", "mcp/src", "mcp/tests", "mcp/scripts", "examples"];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|md|mjs|json)$/.test(name)) out.push(full);
  }
  return out;
}

describe("no origin chatter", () => {
  it("never describes the library as a port of another project", () => {
    const self = fileURLToPath(import.meta.url);
    const files = [
      ...FILES.map((f) => join(ROOT, f)),
      ...DIRS.flatMap((d) => walk(join(ROOT, d))),
    ].filter((f) => f !== self);
    const offences: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      let lines: string[];
      try {
        lines = readFileSync(file, "utf8").split(/\r?\n/);
      } catch {
        continue;
      }
      lines.forEach((line, i) => {
        if (!PATTERN.test(line) && !CASE_SENSITIVE.test(line)) return;
        if (ALLOWED_LINES.some(([f, re]) => f === rel && re.test(line))) return;
        offences.push(`${rel}:${String(i + 1)}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(offences, `Found ${String(offences.length)} mention(s):\n${offences.join("\n")}`).toEqual([]);
  });
});
