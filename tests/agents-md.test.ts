import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Garmin } from "../src/garmin.js";

/**
 * Drift guard for AGENTS.md, the agent-facing briefing shipped in the
 * package. Its whole value is that a coding agent trusts it over its own
 * (possibly stale, possibly upstream-python-shaped) assumptions about this
 * library's surface. A doc that has drifted from the real `Garmin` class is
 * worse than no doc: it teaches an agent to write confident, wrong calls.
 *
 * This test does not hardcode the method list — it reflects on `Garmin` at
 * runtime, so it keeps working unchanged as the surface grows from ~14
 * methods toward upstream's ~155.
 */

const AGENTS_MD_PATH = fileURLToPath(new URL("../AGENTS.md", import.meta.url));
const agentsMd = readFileSync(AGENTS_MD_PATH, "utf8");

/** Own, enumerable-on-prototype, non-private instance methods of `Garmin`. */
function garminMethodNames(): string[] {
  return Object.getOwnPropertyNames(Garmin.prototype).filter((name) => {
    if (name === "constructor") return false;
    if (name.startsWith("_") || name.startsWith("#")) return false;
    const descriptor = Object.getOwnPropertyDescriptor(Garmin.prototype, name);
    return typeof descriptor?.value === "function";
  });
}

/**
 * Pulls the method names AGENTS.md *documents as existing on `Garmin`*, by
 * reading only the `### \`Garmin\`` reference table (section 3) — not the
 * whole file. Section 4 ("these methods do NOT exist") and the gotchas in
 * section 6 also mention method names in backticks, deliberately, but those
 * are prose, not a claim that a method exists; the reference table is the
 * one place this file asserts "this method is real, here is its signature".
 * Scoping the reverse-direction check to that table keeps this test honest
 * about what it's actually verifying.
 */
function documentedGarminMethodNames(): string[] {
  const start = agentsMd.indexOf("### `Garmin`");
  if (start === -1) {
    throw new Error(
      'AGENTS.md drift guard: could not find the "### `Garmin`" section heading. ' +
        "The method inventory table this test checks against has apparently been " +
        "renamed or removed — update AGENTS.md section 3 (or this test, if the " +
        "heading text intentionally changed) so the two stay in sync.",
    );
  }
  const nextHeading = agentsMd.indexOf("### `GarminClient`", start);
  const end = nextHeading === -1 ? agentsMd.length : nextHeading;
  const section = agentsMd.slice(start, end);

  const names = new Set<string>();
  // Table rows look like: | `methodName` | `(sig): ReturnType` | yes |
  const rowPattern = /^\|\s*`([a-zA-Z_$][\w$]*)`\s*\|/gm;
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(section)) !== null) {
    const name = match[1];
    if (name) names.add(name);
  }
  return [...names];
}

describe("AGENTS.md drift guard", () => {
  it("documents every public Garmin method", () => {
    const actual = garminMethodNames();
    const documented = new Set(documentedGarminMethodNames());
    const missing = actual.filter((name) => !documented.has(name));

    expect(
      missing,
      `AGENTS.md is missing ${missing.length} method(s) that exist on the Garmin class: ` +
        `${missing.join(", ")}. Add each one to the "### \`Garmin\`" table in AGENTS.md ` +
        "(section 3) with its real signature and live-verification status. A coding agent " +
        "reading AGENTS.md has no other way to learn this method exists, and will either " +
        "miss it or reinvent it incorrectly.",
    ).toEqual([]);
  });

  it("never claims a Garmin method that does not actually exist", () => {
    const actual = new Set(garminMethodNames());
    const documented = documentedGarminMethodNames();
    const phantom = documented.filter((name) => !actual.has(name));

    expect(
      phantom,
      `AGENTS.md documents ${phantom.length} method(s) that do NOT exist on the Garmin ` +
        `class: ${phantom.join(", ")}. Remove or correct these rows in the "### \`Garmin\`" ` +
        "table (section 3) of AGENTS.md. This is worse than an omission: an agent that " +
        "trusts AGENTS.md will call a method that was renamed or removed and get a " +
        "confusing runtime TypeError instead of a compile error, because the doc told it " +
        "the method was real.",
    ).toEqual([]);
  });
});
