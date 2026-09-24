import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * README.md's coverage table summarises AGENTS.md's per-method `Live-verified` column. Summaries
 * rot: the table sat for weeks telling readers that `setBloodPressure`, `deleteBloodPressure`,
 * `addHydrationData` and `addBodyComposition` were "implemented but not live-verified" AFTER every
 * one of them had been round-tripped against a live account — seven rows were wrong in total, and
 * a reader spotted it, not a test.
 *
 * This is the cheap direction to check mechanically: the README must never claim a method is
 * unverified when AGENTS.md's own row says it is verified. The opposite direction (README
 * over-claiming) is deliberately NOT checked here — the README speaks in categories, not methods,
 * so there is no honest mechanical mapping for it, and a guard that pretends otherwise would fail
 * on correct prose until someone deleted it.
 */
const read = (n: string) => readFileSync(fileURLToPath(new URL(`../${n}`, import.meta.url)), "utf8");
const AGENTS = read("AGENTS.md");
const README = read("README.md");

/** Method names whose AGENTS.md row asserts live verification (the cell starts with "yes"). */
function verifiedMethods(): string[] {
  const out: string[] = [];
  for (const line of AGENTS.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const cells = line.split("|");
    const name = cells[1]?.trim().replace(/`/g, "");
    const verdict = cells[cells.length - 2]?.trim().toLowerCase() ?? "";
    if (name && verdict.startsWith("yes")) out.push(name);
  }
  return out;
}

/** Phrases that assert a method has NOT been verified. */
const NEGATIVE = /not live-verified|unverifiable|unverified|never live-tested|implemented but not/i;

describe("README vs AGENTS.md verification drift", () => {
  it("finds verified methods to check against at all", () => {
    // Without this, a parser change would make the real assertion pass vacuously.
    expect(verifiedMethods().length).toBeGreaterThan(100);
  });

  it("never calls a method unverified that AGENTS.md marks verified", () => {
    const verified = new Set(verifiedMethods());
    const offences: string[] = [];

    for (const [i, line] of README.split("\n").entries()) {
      if (!NEGATIVE.test(line)) continue;
      // `\b` would not do: these are backtick-quoted identifiers in prose and table cells.
      for (const match of line.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)) {
        const name = match[1]!;
        if (verified.has(name)) {
          offences.push(`README.md:${String(i + 1)} calls \`${name}\` unverified`);
        }
      }
    }

    expect(
      offences,
      `${offences.length} stale claim(s) in README.md — AGENTS.md's table says these methods ARE ` +
        `live-verified:\n  ${offences.join("\n  ")}\n` +
        "Update the README's coverage table; AGENTS.md's per-method column is the source of truth.",
    ).toEqual([]);
  });
});
