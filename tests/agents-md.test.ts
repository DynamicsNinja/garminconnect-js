import { readdirSync, readFileSync } from "node:fs";
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

  /**
   * Section 4's headline count drifted twice before this test existed: it was incremented by each
   * task's author on top of a figure nobody re-derived, reaching "~83" when the real surface was
   * 134, then "136" when it was 140. A freshly-edited wrong number looks more trustworthy than a
   * stale one, and the two directional checks above only compare NAMES — never the count.
   */
  it("states the correct method count in section 4", () => {
    const actual = garminMethodNames().length;
    const match = /partial port\*\*: (\d+) of upstream/.exec(agentsMd);
    expect(
      match,
      'AGENTS.md section 4 no longer contains a "**partial port**: <N> of upstream" sentence. ' +
        "Restore it (or update this test if the wording intentionally changed) — it is the " +
        "figure an agent uses to judge how much of upstream is reachable without connectapi.",
    ).not.toBeNull();
    expect(
      Number(match?.[1]),
      `AGENTS.md section 4 claims ${match?.[1]} methods; Garmin.prototype actually has ${actual}. ` +
        "Update the number (both places on that line) rather than incrementing the old one.",
    ).toBe(actual);
  });

  /**
   * Section 4's worked example teaches the `connectapi` escape hatch, so it must demonstrate an
   * endpoint this library genuinely does NOT wrap. It has been retargeted twice after the endpoint
   * it named got ported underneath it (`get_devices`, then `get_goals`) — each time leaving a
   * snippet that told agents to hand-roll a call a real method already covered. The `get_goals`
   * version was worse than redundant: it omitted that endpoint's load-bearing `Sec-Fetch-Site`
   * header, so copying it would have silently returned `[]`.
   */
  it("does not demonstrate connectapi for an endpoint a real Garmin method already covers", () => {
    const section = agentsMd.slice(agentsMd.indexOf("## 4. These methods do NOT exist"));
    const example = /```ts\n([\s\S]*?)```/.exec(section)?.[1] ?? "";
    expect(example, "Section 4's TypeScript example block is missing.").not.toBe("");

    // Deliberately broad: an earlier version required a `-service`/`-gateway` suffix, which would
    // have let a path like `/gcs-golfcommunity/api/v2/...` slip past the check entirely. Any
    // absolute path in the example is a candidate.
    const paths = [...example.matchAll(/["'`](\/[a-z0-9][a-z0-9/-]*\/[^"'`${}\s]*)/gi)]
      .map((m) => m[1])
      .filter((p): p is string => p !== undefined);
    expect(
      paths.length,
      `No endpoint path found in section 4's example:\n${example}`,
    ).toBeGreaterThan(0);

    // Every service module's source, concatenated: if the example's path prefix appears there, a
    // real method already wraps it and the example is teaching the wrong thing.
    const servicesDir = fileURLToPath(new URL("../src/services", import.meta.url));
    const sources = readdirSync(servicesDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readFileSync(`${servicesDir}/${f}`, "utf8"))
      .join("\n");

    for (const path of paths) {
      const prefix = path.split("/").slice(0, 3).join("/");
      expect(
        sources.includes(prefix),
        `Section 4's connectapi example uses "${path}", but "${prefix}" is already wrapped by a ` +
          "real method in src/services. The example must demonstrate a genuinely absent endpoint " +
          "— pick one from the 'Notably absent' list and verify it against upstream first.",
      ).toBe(false);
    }
  });
});
