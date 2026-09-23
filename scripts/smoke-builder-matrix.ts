/**
 * Exhaustive combination test for the workout builder.
 *
 *   npx tsx scripts/smoke-builder-matrix.ts
 *
 * Generates the full cross-products of every builder option for swim, bike and run, uploads them in
 * batches, READS EACH ONE BACK and compares every stored step field-by-field against what was asked
 * for. A mismatch names the case, the field, the expected value and the stored value.
 *
 * Steps are emitted flat (no repeats) so stored step N maps to case N — the repeat nesting is
 * covered separately by `smoke-builder.ts`. Batches exist because a workout has a practical step
 * ceiling; `BATCH` is deliberately conservative.
 */
import "./load-env.js";
import { GarminClient, Garmin, FileTokenStore, GarminHttpError, buildWorkout } from "../src/index.js";
import type { StepOptions, StepTarget, StrokeKey, DrillKey, EquipmentKey } from "../src/index.js";

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
if (!(await client.loadTokens())) {
  console.error("No tokens. Run `npm run login` first.");
  process.exit(1);
}
const g = new Garmin(client);

// SAFETY GATE — same unconditional check as every other write script here.
const expectedProfile = process.env["GARMIN_TEST_PROFILE_ID"];
if (!expectedProfile) {
  console.error("Refusing to run: GARMIN_TEST_PROFILE_ID is not set. Nothing was written.");
  process.exit(1);
}
const profile = await g.getUserProfile();
if (String(profile.profileId) !== String(expectedProfile)) {
  console.error(
    `Refusing to run: expected profile ${expectedProfile}, found ${String(profile.profileId)} ` +
      `(userName: ${profile.userName.slice(0, 2)}***@***). Nothing was written.`,
  );
  process.exit(1);
}
console.log(`Safety gate passed: ${String(profile.profileId)}\n`);

type Doc = Record<string, unknown>;
const key = (o: unknown, f: string): unknown => (o as Doc | null)?.[f];
const near = (a: unknown, b: number, tol = 0.01) => typeof a === "number" && Math.abs(a - b) < tol;

interface Case {
  label: string;
  opts: StepOptions;
  /** Returns a description of the first mismatch, or null if the stored step is as intended. */
  verify: (stored: Doc) => string | null;
}

// --- expectation helpers ---------------------------------------------------------------------
const endIs = (conditionKey: string, value?: number) => (s: Doc): string | null => {
  const got = key(s["endCondition"], "conditionTypeKey");
  if (got !== conditionKey) return `endCondition ${JSON.stringify(got)} != "${conditionKey}"`;
  if (value !== undefined && s["endConditionValue"] !== value) {
    return `endConditionValue ${String(s["endConditionValue"])} != ${value}`;
  }
  return null;
};

/** Verifies a target under either the primary or the secondary field family. */
function targetIs(t: StepTarget, secondary = false) {
  const tf = secondary ? "secondaryTargetType" : "targetType";
  const one = secondary ? "secondaryTargetValueOne" : "targetValueOne";
  const two = secondary ? "secondaryTargetValueTwo" : "targetValueTwo";
  const zn = secondary ? "secondaryZoneNumber" : "zoneNumber";
  const where = secondary ? "secondary" : "primary";

  return (s: Doc): string | null => {
    const check = (expectKey: string, a?: number, b?: number, zone?: number): string | null => {
      const got = key(s[tf], "workoutTargetTypeKey");
      if (got !== expectKey) return `${where} target ${JSON.stringify(got)} != "${expectKey}"`;
      if (zone !== undefined && s[zn] !== zone) return `${where} ${zn} ${String(s[zn])} != ${zone}`;
      if (a !== undefined && !near(s[one], a, 0.001)) return `${where} ${one} ${String(s[one])} != ${a}`;
      if (b !== undefined && !near(s[two], b, 0.001)) return `${where} ${two} ${String(s[two])} != ${b}`;
      return null;
    };
    if ("pace" in t) {
      const [fast, slow] =
        "minPerKm" in t.pace
          ? [1000 / (t.pace.minPerKm[0] * 60), 1000 / (t.pace.minPerKm[1] * 60)]
          : [1609.344 / (t.pace.minPerMile[0] * 60), 1609.344 / (t.pace.minPerMile[1] * 60)];
      return check("pace.zone", fast, slow);
    }
    if ("speedMetresPerSecond" in t) {
      const [a, b] = t.speedMetresPerSecond;
      return check("speed.zone", Math.max(a, b), Math.min(a, b));
    }
    if ("powerZone" in t) return check("power.zone", undefined, undefined, t.powerZone);
    if ("powerWatts" in t) return check("power.zone", Math.min(...t.powerWatts), Math.max(...t.powerWatts));
    if ("heartRateZone" in t) return check("heart.rate.zone", undefined, undefined, t.heartRateZone);
    if ("heartRateBpm" in t) {
      return check("heart.rate.zone", Math.min(...t.heartRateBpm), Math.max(...t.heartRateBpm));
    }
    if ("cadence" in t) return check("cadence", Math.min(...t.cadence), Math.max(...t.cadence));
    if ("gradePercent" in t) {
      return check("grade", Math.min(...t.gradePercent), Math.max(...t.gradePercent));
    }
    if ("resistance" in t) return check("resistance", Math.min(...t.resistance), Math.max(...t.resistance));
    return check("swim.css.offset", t.swimCssOffsetSeconds);
  };
}

const all = (...checks: ((s: Doc) => string | null)[]) => (s: Doc): string | null => {
  for (const c of checks) {
    const problem = c(s);
    if (problem) return problem;
  }
  return null;
};

// --- option inventories ----------------------------------------------------------------------
const STROKES: StrokeKey[] = [
  "any_stroke",
  "backstroke",
  "breaststroke",
  "drill",
  "fly",
  "free",
  "individual_medley",
  "mixed",
  "individual_medley_by_round",
  "reverse_individual_medley_by_round",
];
const DRILLS: DrillKey[] = ["kick", "pull", "drill"];
const EQUIPMENT: EquipmentKey[] = ["fins", "kickboard", "paddles", "pull_buoy", "snorkel"];

/** Targets that make sense on a bike or a run. */
const TARGETS: { label: string; t: StepTarget }[] = [
  { label: "pace km", t: { pace: { minPerKm: [4.5, 5] } } },
  { label: "pace mile", t: { pace: { minPerMile: [8.5, 9.5] } } },
  { label: "speed m/s", t: { speedMetresPerSecond: [3.3, 3.0] } },
  { label: "power zone", t: { powerZone: 3 } },
  { label: "power watts", t: { powerWatts: [200, 250] } },
  { label: "hr zone", t: { heartRateZone: 2 } },
  { label: "hr bpm", t: { heartRateBpm: [140, 155] } },
  { label: "cadence", t: { cadence: [85, 95] } },
  { label: "grade", t: { gradePercent: [2, 5] } },
  { label: "resistance", t: { resistance: [4, 7] } },
];

const ENDS: { label: string; opts: StepOptions; check: (s: Doc) => string | null }[] = [
  { label: "distance", opts: { distance: 1000 }, check: endIs("distance", 1000) },
  { label: "time", opts: { time: 300 }, check: endIs("time", 300) },
  { label: "reps", opts: { reps: 12 }, check: endIs("reps", 12) },
  { label: "lapButton", opts: { lapButton: true }, check: endIs("lap.button") },
  { label: "restSeconds", opts: { restSeconds: 45 }, check: endIs("fixed.rest", 45) },
  { label: "calories", opts: { calories: 200 }, check: endIs("calories", 200) },
  { label: "heartRateBpm", opts: { heartRateBpm: 160 }, check: endIs("heart.rate", 160) },
  { label: "powerWatts", opts: { powerWatts: 250 }, check: endIs("power", 250) },
  { label: "fixedRepetition", opts: { fixedRepetition: 4 }, check: endIs("fixed.repetition", 4) },
];

// --- case generation -------------------------------------------------------------------------
function swimCases(): Case[] {
  const cases: Case[] = [];
  const swimIs = (stroke?: StrokeKey, drill?: DrillKey, equipment?: EquipmentKey) => (s: Doc) => {
    if (stroke && key(s["strokeType"], "strokeTypeKey") !== stroke) {
      return `stroke ${JSON.stringify(key(s["strokeType"], "strokeTypeKey"))} != "${stroke}"`;
    }
    if (drill && key(s["drillType"], "drillTypeKey") !== drill) {
      return `drill ${JSON.stringify(key(s["drillType"], "drillTypeKey"))} != "${drill}"`;
    }
    if (equipment && key(s["equipmentType"], "equipmentTypeKey") !== equipment) {
      return `equipment ${JSON.stringify(key(s["equipmentType"], "equipmentTypeKey"))} != "${equipment}"`;
    }
    return null;
  };

  // Full stroke x drill cross-product.
  for (const stroke of STROKES) {
    for (const drill of DRILLS) {
      cases.push({
        label: `swim ${stroke} + ${drill}`,
        opts: { distance: 100, stroke, drill },
        verify: all(endIs("distance", 100), swimIs(stroke, drill)),
      });
    }
  }
  // Full stroke x equipment cross-product.
  for (const stroke of STROKES) {
    for (const equipment of EQUIPMENT) {
      cases.push({
        label: `swim ${stroke} + ${equipment}`,
        opts: { distance: 100, stroke, equipment },
        verify: all(endIs("distance", 100), swimIs(stroke, undefined, equipment)),
      });
    }
  }
  // Full drill x equipment cross-product, all three set at once.
  for (const drill of DRILLS) {
    for (const equipment of EQUIPMENT) {
      cases.push({
        label: `swim free + ${drill} + ${equipment}`,
        opts: { distance: 50, stroke: "free", drill, equipment },
        verify: all(endIs("distance", 50), swimIs("free", drill, equipment)),
      });
    }
  }
  // Swim-appropriate end conditions, and the CSS-offset target.
  for (const e of ENDS) {
    cases.push({
      label: `swim end=${e.label}`,
      opts: { ...e.opts, stroke: "free" },
      verify: all(e.check, swimIs("free")),
    });
  }
  for (const offset of [0, 3, 5, 10]) {
    cases.push({
      label: `swim css offset ${offset}`,
      opts: { distance: 100, stroke: "free", target: { swimCssOffsetSeconds: offset } },
      verify: all(endIs("distance", 100), targetIs({ swimCssOffsetSeconds: offset })),
    });
  }
  return cases;
}

/** Every primary target x every secondary target, plus every end condition. */
function targetMatrixCases(prefix: string): Case[] {
  const cases: Case[] = [];
  for (const primary of TARGETS) {
    for (const secondary of TARGETS) {
      // grade is REJECTED as a secondary target by the builder — Garmin stores its first value
      // multiplied by ten there. This matrix is what found that; the rejection is asserted
      // separately below rather than expected to round-trip.
      if ("gradePercent" in secondary.t) continue;
      cases.push({
        label: `${prefix} ${primary.label} + 2nd ${secondary.label}`,
        opts: { time: 300, target: primary.t, secondaryTarget: secondary.t },
        verify: all(endIs("time", 300), targetIs(primary.t), targetIs(secondary.t, true)),
      });
    }
  }
  for (const primary of TARGETS) {
    cases.push({
      label: `${prefix} ${primary.label} alone`,
      opts: { time: 300, target: primary.t },
      verify: all(endIs("time", 300), targetIs(primary.t)),
    });
  }
  for (const e of ENDS) {
    cases.push({
      label: `${prefix} end=${e.label}`,
      opts: e.opts,
      verify: e.check,
    });
  }
  return cases;
}

// --- run the batches -------------------------------------------------------------------------
const BATCH = 30;
let checked = 0;
let failures = 0;

async function runSuite(
  name: string,
  sport: "swimming" | "cycling" | "running",
  cases: Case[],
  poolLength?: number,
): Promise<void> {
  console.log(`${name}: ${cases.length} combinations in ${String(Math.ceil(cases.length / BATCH))} batches`);
  for (let i = 0; i < cases.length; i += BATCH) {
    const batch = cases.slice(i, i + BATCH);
    let workoutId: number | undefined;
    try {
      const b = buildWorkout(`[matrix] ${name} ${String(i / BATCH + 1)}`, {
        sport,
        ...(poolLength !== undefined && { poolLength }),
      });
      for (const c of batch) b.interval(c.opts);
      const created = await g.uploadWorkout(b.build());
      workoutId = created?.workoutId;
      const stored = (await g.getWorkoutById(workoutId!)) as Doc;
      const steps = (stored["workoutSegments"] as Doc[])[0]!["workoutSteps"] as Doc[];

      if (steps.length !== batch.length) {
        failures++;
        console.log(`  FAIL  batch ${String(i / BATCH + 1)}: stored ${steps.length} steps, sent ${batch.length}`);
        continue;
      }
      for (const [j, c] of batch.entries()) {
        checked++;
        const problem = c.verify(steps[j]!);
        if (problem) {
          failures++;
          console.log(`  FAIL  ${c.label.padEnd(52)} ${problem}`);
        }
      }
    } catch (e) {
      failures++;
      const msg =
        e instanceof GarminHttpError
          ? `HTTP ${e.status} ${e.body.slice(0, 150)}`
          : `${(e as Error).constructor.name}: ${(e as Error).message.slice(0, 150)}`;
      console.log(`  FAIL  batch ${String(i / BATCH + 1)} (${batch.length} cases): ${msg}`);
    } finally {
      if (workoutId !== undefined) {
        try {
          await g.deleteWorkout(workoutId);
        } catch {
          console.log(`  WARN  could not delete workout ${String(workoutId)}`);
        }
      }
    }
  }
}

/** The builder must refuse a secondary grade target rather than send a value Garmin will mangle. */
function assertGradeSecondaryRejected(): void {
  checked++;
  try {
    buildWorkout("[matrix] grade guard", { sport: "cycling" })
      .interval({ time: 60, target: { cadence: [80, 90] }, secondaryTarget: { gradePercent: [2, 5] } })
      .build();
    failures++;
    console.log("  FAIL  grade as secondaryTarget was accepted; it must throw (Garmin stores it x10)");
  } catch {
    // Expected.
  }
}
assertGradeSecondaryRejected();

await runSuite("swim", "swimming", swimCases(), 25);
await runSuite("bike", "cycling", targetMatrixCases("bike"), undefined);
await runSuite("run", "running", targetMatrixCases("run"), undefined);

console.log(`\n${checked} step combinations verified, ${failures} failed`);
if (failures > 0) process.exitCode = 1;
