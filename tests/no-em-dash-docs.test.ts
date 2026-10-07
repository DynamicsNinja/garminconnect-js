import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const EM = "\u2014";

const FILES = [
  "README.md",
  "WORKOUTS.md",
  "CHANGELOG.md",
  "mcp/README.md",
  ...readdirSync(path.join(ROOT, "docs", "api"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/api/${f}`),
];

describe("rendered docs carry no em dashes", () => {
  it("has no U+2014 in any published markdown page", () => {
    const hits: string[] = [];
    for (const file of FILES) {
      readFileSync(path.join(ROOT, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (line.includes(EM)) hits.push(`${file}:${String(i + 1)}`);
        });
    }
    expect(hits, `em dashes found (fix the source, then regenerate):\n${hits.join("\n")}`).toEqual([]);
  });
});
