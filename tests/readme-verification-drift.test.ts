import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

/** Test files the DEFAULT suite runs — mirroring vitest.config.ts's include and exclude. */
function countedTestFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "live") continue; // excluded from the default run
      countedTestFiles(full, out);
    } else if (entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("README test-count claim", () => {
  /**
   * "521 tests across 35 files" sat in the README while the suite was at 625 across 44 — the
   * fourth stale number this project has shipped in prose, after the method count, the coverage
   * table and four source comments. A number in a README is a claim; this makes it one the
   * repository checks.
   *
   * The FILE count is asserted exactly, because it is countable here — and it must mirror
   * vitest's own exclude, or it reports 45 where the suite runs 44 and fails on a correct README.
   * The TEST count gets a band instead: counting `it(` blocks is a proxy that misses `it.each`,
   * so demanding equality would fail on prose that is right. Overstating is the failure that
   * actually misleads a reader, so the upper bound is tight and the lower bound catches staleness.
   */
  it("states the real number of test files, and a test count neither inflated nor stale", () => {
    const files = countedTestFiles(fileURLToPath(new URL(".", import.meta.url)));
    const its = files.reduce(
      (n, f) => n + (readFileSync(f, "utf8").match(/^\s*it\(/gm) ?? []).length,
      0,
    );

    const claim = /(\d+) tests across (\d+) files/.exec(README);
    expect(claim, "README no longer states '<N> tests across <M> files'").not.toBeNull();
    const claimedTests = Number(claim?.[1]);
    const claimedFiles = Number(claim?.[2]);

    expect(claimedFiles, "README's test-FILE count is wrong").toBe(files.length);
    expect(
      claimedTests,
      `README claims ${String(claimedTests)} tests but only ~${String(its)} exist — do not overstate the suite.`,
    ).toBeLessThanOrEqual(Math.round(its * 1.05));
    expect(
      claimedTests,
      `README claims ${String(claimedTests)} tests and the suite has ~${String(its)} — stale.`,
    ).toBeGreaterThanOrEqual(Math.round(its * 0.9));
  });
});

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
