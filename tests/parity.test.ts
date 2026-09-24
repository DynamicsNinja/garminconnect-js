import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Garmin } from "../src/garmin.js";

/**
 * The plan's closing argument: mechanically assert that every one of upstream
 * `python-garminconnect`'s 154 public methods (`docs/upstream-method-inventory.md`, the
 * authoritative record built by reading `gc.py` row by row) has a real counterpart on this port's
 * `Garmin` class.
 *
 * This test does not hardcode the method list on either side. It reflects on `Garmin` at runtime
 * (same technique as `tests/agents-md.test.ts`'s drift guard) and parses the inventory table at
 * read time, so it keeps testing the real thing as both sides evolve, rather than freezing a
 * snapshot that silently stops meaning anything.
 *
 * Two upstream rows are satisfied by a PRE-EXISTING method under a DIFFERENT name than the
 * inventory's own `ts_name` column suggests (Task 12's naming ruling, `src/services/userProfile.ts`)
 * plus a third row (`get_full_name`) already existing as a cached accessor with no HTTP call:
 *
 *   - `get_full_name`    -> `fullName()`       (cached accessor, no HTTP call)
 *   - `get_unit_system`  -> `unitSystem()`     (cached accessor, no HTTP call)
 *   - `get_user_profile` -> `getUserSettings()` (same `user-settings` endpoint, different name;
 *      upstream's own name collides with this port's PRE-EXISTING `getUserProfile()`, which hits
 *      an unrelated endpoint, `/userprofile-service/socialProfile` — repointing or shadowing it
 *      was rejected as unsafe, see `src/services/userProfile.ts`)
 *
 * These are satisfied parity, not omissions — modelled separately from `DELIBERATE_OMISSIONS`
 * below, per the task brief's explicit instruction not to silently exclude them.
 */

const INVENTORY_PATH = fileURLToPath(
  new URL("../docs/upstream-method-inventory.md", import.meta.url),
);
const inventory = readFileSync(INVENTORY_PATH, "utf8");

/** One row of the inventory: upstream's own name, and the `ts_name` the inventory records for it. */
interface InventoryRow {
  pythonName: string;
  tsName: string;
}

/**
 * Parses every `| python_name | ts_name | verb | ... |` row across every `## <service>` section.
 * Deliberately broad — matches ANY table row shaped like that, not just rows under a recognized
 * section heading — so a future service section added without updating this test is still caught.
 * Skips the header row (`python_name`) and separator rows (`---`).
 */
function parseInventoryRows(): InventoryRow[] {
  const rows: InventoryRow[] = [];
  const rowPattern = /^\|\s*([a-z][a-z0-9_]*)\s*\|\s*([a-zA-Z_$][\w$]*)\s*\|/gm;
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(inventory)) !== null) {
    const pythonName = match[1];
    const tsName = match[2];
    if (!pythonName || !tsName) continue;
    if (pythonName === "python_name") continue; // header row
    // Method rows have the full 10-column shape (python_name|ts_name|verb|path|params|body|args|
    // returns|null_behaviour|notes|). The only OTHER tables in this document that can match the
    // first two columns loosely (e.g. the per-service summary counts table, `| service | count |`)
    // are much narrower — reject anything without at least 9 pipe separators on the full line.
    const fullLine = inventory.slice(
      inventory.lastIndexOf("\n", match.index) + 1,
      inventory.indexOf("\n", match.index),
    );
    const pipeCount = (fullLine.match(/\|/g) ?? []).length;
    if (pipeCount < 10) continue;
    rows.push({ pythonName, tsName });
  }
  return rows;
}

/**
 * Rows whose upstream method is satisfied by a real, pre-existing `Garmin` method under a name
 * OTHER than the inventory's own `ts_name` column — see the file-level comment. Keyed by
 * `pythonName` (stable across any future edit to the inventory's `ts_name` column).
 */
const SATISFIED_UNDER_DIFFERENT_NAME: Record<string, string> = {
  get_full_name: "fullName",
  get_unit_system: "unitSystem",
  get_user_profile: "getUserSettings",
};

/**
 * Rows deliberately NOT ported, each with a real, auditable reason — not "not portable" (the
 * standing rule this file's own header comment inherits from the task brief). Empty as of Task 15:
 * every upstream method this project set out to port now has a real `Garmin` counterpart. Kept as
 * a live structure (not deleted) so a genuine future omission has an obvious place to be recorded
 * with its reason, rather than tempting whoever hits a failure here to just delete the failing row
 * from the inventory-derived list instead.
 */
const DELIBERATE_OMISSIONS: Record<string, string> = {};

/** Own, enumerable-on-prototype, non-private instance methods of `Garmin`. Mirrors agents-md.test.ts. */
function garminMethodNames(): Set<string> {
  return new Set(
    Object.getOwnPropertyNames(Garmin.prototype).filter((name) => {
      if (name === "constructor") return false;
      if (name.startsWith("_") || name.startsWith("#")) return false;
      const descriptor = Object.getOwnPropertyDescriptor(Garmin.prototype, name);
      return typeof descriptor?.value === "function";
    }),
  );
}

describe("upstream parity", () => {
  it("parses at least 154 rows from the inventory (sanity check on the parser itself)", () => {
    const rows = parseInventoryRows();
    expect(
      rows.length,
      "Expected to parse at least 154 rows (one per upstream public method) from " +
        "docs/upstream-method-inventory.md. Got fewer, which means this test's own row parser is " +
        "broken (a section's table format drifted) rather than the port being incomplete — fix the " +
        "parser, don't weaken the count check below to match a broken parse.",
    ).toBeGreaterThanOrEqual(154);
  });

  it("every upstream method has a real Garmin counterpart, or a stated, reasoned omission", () => {
    const rows = parseInventoryRows();
    const actual = garminMethodNames();

    const missing: string[] = [];
    for (const { pythonName, tsName } of rows) {
      if (pythonName in DELIBERATE_OMISSIONS) continue;
      const resolvedName = SATISFIED_UNDER_DIFFERENT_NAME[pythonName] ?? tsName;
      if (!actual.has(resolvedName)) {
        missing.push(
          `${pythonName} (expected Garmin.${resolvedName}${
            resolvedName !== tsName ? ` [mapped from inventory ts_name ${tsName}]` : ""
          })`,
        );
      }
    }

    expect(
      missing,
      `${missing.length} upstream method(s) have no real Garmin counterpart and are not listed in ` +
        `DELIBERATE_OMISSIONS (tests/parity.test.ts): ${missing.join(", ")}. Either an earlier task ` +
        "in this plan is incomplete (port the method), or the omission is genuinely deliberate (add " +
        "it to DELIBERATE_OMISSIONS with a real, specific reason — 'not portable' does not count). " +
        "Do not weaken this test to make it pass; a missing method here means the controller needs " +
        "to know about it.",
    ).toEqual([]);
  });

  it("pins the surface that goes BEYOND upstream, so it cannot grow unannounced", () => {
    // The other direction. Every test above asks "does upstream's surface exist here?"; none asks
    // "what exists here that upstream never had?" — and that set is now the interesting one. It is
    // what makes this library more than a port, it is what README.md and AGENTS.md advertise, and
    // without a guard it drifts the moment someone adds a convenience method.
    //
    // A name landing here is not a failure. It means: decide whether it is a deliberate addition
    // (add it below, with the reason) or an accident (rename it to match upstream).
    const BEYOND_UPSTREAM: Record<string, string> = {
      getUserProfile: "hits /userprofile-service/socialProfile; upstream's get_user_profile is a DIFFERENT endpoint, satisfied here by getUserSettings",
      displayName: "cached accessor over getUserProfile",
      userName: "cached accessor over getUserProfile",
      deleteGear: "upstream has no delete-gear method; endpoint found in Garmin's own web client",
      setGearActivityDefaults: "working replacement for setGearDefault, whose upstream endpoint is dead",
    };

    const rows = parseInventoryRows();
    const claimed = new Set<string>();
    for (const { pythonName, tsName } of rows) {
      claimed.add(SATISFIED_UNDER_DIFFERENT_NAME[pythonName] ?? tsName);
    }

    const unexplained = [...garminMethodNames()].filter(
      (name) => !claimed.has(name) && !(name in BEYOND_UPSTREAM),
    );
    expect(
      unexplained.sort(),
      `Garmin has ${unexplained.length} method(s) that no upstream inventory row accounts for and ` +
        `that BEYOND_UPSTREAM does not explain: ${unexplained.join(", ")}. Add each to ` +
        "BEYOND_UPSTREAM with the reason it exists, or rename it to the upstream counterpart.",
    ).toEqual([]);

    // And the reverse: an entry that upstream has since been found to cover is stale.
    const stale = Object.keys(BEYOND_UPSTREAM).filter((name) => claimed.has(name));
    expect(
      stale,
      `BEYOND_UPSTREAM claims ${stale.join(", ")} go beyond upstream, but the inventory now maps ` +
        "to them. Remove the stale entry.",
    ).toEqual([]);
  });

  it("DELIBERATE_OMISSIONS contains no stale entries (every key is a real upstream python_name)", () => {
    const rows = parseInventoryRows();
    const pythonNames = new Set(rows.map((r) => r.pythonName));
    const stale = Object.keys(DELIBERATE_OMISSIONS).filter((name) => !pythonNames.has(name));
    expect(
      stale,
      `DELIBERATE_OMISSIONS names ${stale.length} python_name(s) that no longer appear in the ` +
        `inventory: ${stale.join(", ")}. Remove the stale entry — it is no longer excusing anything.`,
    ).toEqual([]);
  });

  it("SATISFIED_UNDER_DIFFERENT_NAME contains no stale entries", () => {
    const rows = parseInventoryRows();
    const pythonNames = new Set(rows.map((r) => r.pythonName));
    const stale = Object.keys(SATISFIED_UNDER_DIFFERENT_NAME).filter(
      (name) => !pythonNames.has(name),
    );
    expect(
      stale,
      `SATISFIED_UNDER_DIFFERENT_NAME names ${stale.length} python_name(s) that no longer appear ` +
        `in the inventory: ${stale.join(", ")}. Remove the stale entry.`,
    ).toEqual([]);
  });
});
