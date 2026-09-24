import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPages } from "../scripts/generate-api-docs.js";
import { Garmin } from "../src/garmin.js";

/**
 * `docs/api/` is generated from `src/garmin.ts` and `AGENTS.md`. Generation alone does not keep it
 * honest — a generated file that nobody regenerates is just a stale file with a confident header.
 * This regenerates in memory and fails if what is committed differs, so the pages cannot drift
 * from the code without CI going red.
 *
 * It also checks the property generation cannot give you for free: that EVERY method on `Garmin`
 * lands on some page. The generator maps a method to a category by the service it delegates to,
 * and seven methods have a real body instead of a delegation — those are hand-placed in a list
 * that would otherwise rot silently as methods are added.
 */
const API_DIR = fileURLToPath(new URL("../docs/api", import.meta.url));

function garminMethodNames(): string[] {
  return Object.getOwnPropertyNames(Garmin.prototype).filter((name) => {
    if (name === "constructor" || name.startsWith("_") || name.startsWith("#")) return false;
    return typeof Object.getOwnPropertyDescriptor(Garmin.prototype, name)?.value === "function";
  });
}

describe("generated API reference", () => {
  const pages = buildPages();

  it("generates a page per category plus an index", () => {
    expect(pages.size).toBeGreaterThan(5);
    expect(pages.has("README.md")).toBe(true);
  });

  it("matches what is committed — run `npm run docs:api` if this fails", () => {
    const stale: string[] = [];
    for (const [file, expected] of pages) {
      const target = path.join(API_DIR, file);
      if (!existsSync(target)) {
        stale.push(`${file} (missing)`);
        continue;
      }
      // Normalise line endings: the repo checks out CRLF on Windows, the generator emits LF.
      if (readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== expected) stale.push(file);
    }
    expect(
      stale,
      `docs/api is out of date: ${stale.join(", ")}. Run \`npm run docs:api\` and commit the result.`,
    ).toEqual([]);
  });

  it("leaves no orphan files behind after a category is renamed or removed", () => {
    const onDisk = readdirSync(API_DIR).filter((f) => f.endsWith(".md"));
    const orphans = onDisk.filter((f) => !pages.has(f));
    expect(
      orphans,
      `docs/api contains ${orphans.join(", ")}, which the generator no longer produces. Delete them.`,
    ).toEqual([]);
  });

  it("documents every method on Garmin, including the hand-placed ones", () => {
    // The generator drops any method whose service it cannot resolve. Silently. This is the check
    // that turns "a new method quietly missing from the docs" into a failing test.
    const documented = new Set<string>();
    for (const [file, content] of pages) {
      if (file === "README.md") continue;
      for (const m of content.matchAll(/^## (\w+)$/gm)) documented.add(m[1]!);
    }
    const missing = garminMethodNames().filter((n) => !documented.has(n));
    expect(
      missing,
      `${missing.length} Garmin method(s) appear on no page: ${missing.join(", ")}. Either the ` +
        "method's service is not in CATEGORIES, or it does not delegate in the shape the parser " +
        "expects and needs adding to HAND_PLACED (both in scripts/generate-api-docs.ts).",
    ).toEqual([]);
  });

  it("keeps README's coverage table in step with the pages it links to", () => {
    // The README table linked to these pages while quoting different counts — Gear said 10 when
    // its page lists 6, because the four gear/activity-association methods live in the activities
    // service. A count next to a link is a claim about that link; this makes it one the code
    // decides. Three rows were wrong the first time this ran.
    const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");
    const perPage = new Map<string, number>();
    for (const [file, content] of pages) {
      if (file === "README.md") continue;
      perPage.set(file.replace(/\.md$/, ""), [...content.matchAll(/^## \w+$/gm)].length);
    }

    const mismatches: string[] = [];
    let rowsChecked = 0;
    for (const row of readme.matchAll(/\| \[[^\]]+\]\(docs\/api\/([a-z-]+)\.md\) \| (\d+) \|/g)) {
      const [, slug, claimed] = row;
      const real = perPage.get(slug!);
      rowsChecked++;
      if (real !== undefined && real !== Number(claimed)) {
        mismatches.push(`${slug!}: README says ${claimed!}, the page lists ${String(real)}`);
      }
    }
    // Guard the guard: if the row regex stops matching, everything above passes vacuously.
    expect(rowsChecked, "README's coverage table no longer links to docs/api pages").toBeGreaterThan(8);
    expect(mismatches, mismatches.join("; ")).toEqual([]);
  });

  it("tells the reader what every method returns", () => {
    // The pages first shipped with signatures only: `Promise<SleepData | null>` and no hint of
    // what SleepData holds, which is the one thing you need before calling anything.
    for (const [file, content] of pages) {
      if (file === "README.md") continue;
      const sections = content.split(/^## /m).slice(1);
      const silent = sections
        .filter((s) => !s.includes("**Returns**"))
        .map((s) => s.split("\n")[0]!);
      expect(silent, `${file} documents no return shape for: ${silent.join(", ")}`).toEqual([]);
    }
  });

  it("resolves named return types instead of only naming them", () => {
    // A resolver that fails open would render `\`SleepData\`` and move on, which reads like a
    // real answer. Most responses should resolve to a field table or an explicit "unparsed" note.
    let resolved = 0;
    let total = 0;
    for (const [file, content] of pages) {
      if (file === "README.md") continue;
      for (const section of content.split(/^## /m).slice(1)) {
        total++;
        // Four honest outcomes, all of which tell a reader something: a field table, a type
        // alias expanded to what it aliases, a primitive, or an explicit "unparsed"/bytes note.
        // Only a bare `` `SomeType` `` with nothing after it is a resolver that gave up.
        if (/\| Field \| Type \| Always present \|/.test(section)) resolved++;
        else if (/^`\w+` = /m.test(section)) resolved++;
        else if (/^`(string|number|boolean|null|void)`$/m.test(section)) resolved++;
        else if (/passed through unparsed|Buffer` of file bytes|Nothing\./.test(section)) resolved++;
      }
    }
    expect(total).toBeGreaterThan(100);
    expect(
      resolved / total,
      `only ${String(resolved)}/${String(total)} methods resolve to a concrete return shape`,
    ).toBeGreaterThan(0.95);
  });

  it("keeps upstream-parity bookkeeping and repo process language out of consumer pages", () => {
    // These pages are read by someone who installed the package. "UNCERTAIN upstream null
    // handling" (16 occurrences before this was stripped) tells them nothing, and "fixed in
    // Task 7's fix-round-1" names an artefact they cannot see. Comparing against upstream is
    // load-bearing in AGENTS.md, which an agent reads with python-garminconnect in its training
    // data — it is noise here. A deny-list, not a budget: a count would fight accurate prose,
    // and mentions that carry BEHAVIOUR (a corrected return type, a load-bearing header) stay.
    const banned: [RegExp, string][] = [
      [/UNCERTAIN upstream null handling/i, "internal porting note"],
      [/kept for parity with upstream/i, "internal porting note"],
      [/Task \d+'s fix-round/i, "repo process language"],
      [/\bthis task's\b/i, "repo process language"],
      [/no inventory task ever ported/i, "repo process language"],
    ];
    const offences: string[] = [];
    for (const [file, content] of pages) {
      for (const [pattern, why] of banned) {
        if (pattern.test(content)) offences.push(`${file}: ${pattern.source} (${why})`);
      }
    }
    expect(
      offences,
      `generated pages leaked internal notes: ${offences.join("; ")}. ` +
        "Extend stripParityChatter() in scripts/generate-api-docs.ts rather than editing the " +
        "generated file, which is overwritten.",
    ).toEqual([]);
  });

  it("gives every documented method a real signature, not a parser leftover", () => {
    // The first generated run truncated every signature containing a TypeScript union, because
    // AGENTS.md escapes `|` as `\|` inside table cells and the row was split on a bare `|`.
    // Pages rendered `cdate?: string \` and stopped. A trailing backslash is that fingerprint.
    for (const [file, content] of pages) {
      if (file === "README.md") continue;
      const truncated = [...content.matchAll(/^garmin\.\w+\(.*\\$/gm)].map((m) => m[0]);
      expect(truncated, `${file} has truncated signature(s)`).toEqual([]);
      expect(content, `${file} leaked an escaped pipe`).not.toMatch(/\\\|/);
    }
  });
});
