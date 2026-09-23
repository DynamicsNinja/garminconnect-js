/**
 * Verifies every candidate {category, exerciseName} pair against the live API, by upload and
 * READ-BACK, and writes the confirmed set as JSON.
 *
 *   npx tsx scripts/verify-exercises.ts <candidates.json> <out.json>
 *
 * Why this exists: Garmin validates the two halves of an exercise differently. A bad `category`
 * 400s the whole upload — loud. A bad `exerciseName` is accepted and STORED AS `""` — silent. So a
 * name list assembled from any source (the web picker's DOM, the translations bundle, upstream)
 * is a list of CANDIDATES until the server has echoed each one back.
 *
 * Categories are probed one per workout, because a bad one takes the whole upload down with it.
 * Names are probed in batches inside a single workout, because a bad one only blanks its own step.
 */
import "./load-env.js";
import { readFileSync, writeFileSync } from "node:fs";
import { GarminClient, Garmin, FileTokenStore, GarminHttpError } from "../src/index.js";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: tsx scripts/verify-exercises.ts <candidates.json> <out.json>");
  process.exit(1);
}

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
if (!(await client.loadTokens())) {
  console.error("No tokens. Run `npm run login` first.");
  process.exit(1);
}
const g = new Garmin(client);

// SAFETY GATE — identical to every other write script here. Not conditional, not skippable.
const expected = process.env["GARMIN_TEST_PROFILE_ID"];
if (!expected) {
  console.error("Refusing to run: GARMIN_TEST_PROFILE_ID is not set. Nothing was written.");
  process.exit(1);
}
const profile = await g.getUserProfile();
if (String(profile.profileId) !== String(expected)) {
  console.error(
    "Refusing to run: live profile does not match the expected test account.\n" +
      `  expected ${expected}, found ${String(profile.profileId)}\nNothing was written.`,
  );
  process.exit(1);
}
console.log(`Safety gate passed: ${String(profile.profileId)}\n`);

type Doc = Record<string, unknown>;
const candidates = JSON.parse(readFileSync(inPath, "utf8")) as Record<string, Record<string, string>>;

/** One executable step carrying an exercise, at the given order. */
const step = (order: number, category: string, name: string | null): Doc => ({
  type: "ExecutableStepDTO",
  stepOrder: order,
  stepType: { stepTypeId: 3, stepTypeKey: "interval" },
  endCondition: { conditionTypeId: 3, conditionTypeKey: "reps" },
  endConditionValue: 10,
  category,
  exerciseName: name,
});

const workout = (steps: Doc[]): Doc => ({
  workoutName: `[verify] exercises ${String(Date.now())}`,
  sportType: { sportTypeId: 5, sportTypeKey: "strength_training", displayOrder: 5 },
  workoutSegments: [
    {
      segmentOrder: 1,
      sportType: { sportTypeId: 5, sportTypeKey: "strength_training", displayOrder: 5 },
      workoutSteps: steps,
    },
  ],
});

/** Uploads, reads back the stored steps, deletes. Returns stored [category, exerciseName] pairs. */
async function roundTrip(steps: Doc[]): Promise<[unknown, unknown][] | { error: string }> {
  let id: number | undefined;
  try {
    const created = await g.uploadWorkout(workout(steps));
    id = created?.workoutId;
    if (id === undefined) return { error: "upload returned no workoutId" };
    const stored = (await g.getWorkoutById(id)) as Doc;
    const segs = stored["workoutSegments"] as Doc[];
    const out = (segs[0]?.["workoutSteps"] as Doc[]).map(
      (s) => [s["category"], s["exerciseName"]] as [unknown, unknown],
    );
    return out;
  } catch (e) {
    return {
      error:
        e instanceof GarminHttpError
          ? `HTTP ${String(e.status)} ${e.body.slice(0, 120)}`
          : `${(e as Error).constructor.name}: ${(e as Error).message.slice(0, 120)}`,
    };
  } finally {
    if (id !== undefined) {
      try {
        await g.deleteWorkout(id);
      } catch {
        console.log(`  WARN could not delete workout ${String(id)}`);
      }
    }
  }
}

// --- 1. categories, one workout each (a bad category 400s the whole upload) -------------------
const categories = Object.keys(candidates).sort();
const goodCategories: string[] = [];
console.log(`Probing ${String(categories.length)} categories...`);
for (const c of categories) {
  const r = await roundTrip([step(1, c, null)]);
  if ("error" in r) {
    console.log(`  REJECT ${c.padEnd(20)} ${r.error}`);
    continue;
  }
  if (r[0]?.[0] !== c) {
    console.log(`  REJECT ${c.padEnd(20)} stored category ${JSON.stringify(r[0]?.[0])}`);
    continue;
  }
  goodCategories.push(c);
}
console.log(`  ${String(goodCategories.length)}/${String(categories.length)} categories accepted\n`);

// --- 2. names, batched (a bad name only blanks its own step) ----------------------------------
const BATCH = 50;
const verified: Record<string, string[]> = {};
const rejected: [string, string][] = [];
for (const c of goodCategories) {
  const names = Object.keys(candidates[c] ?? {}).sort();
  const ok: string[] = [];
  for (let i = 0; i < names.length; i += BATCH) {
    const slice = names.slice(i, i + BATCH);
    const r = await roundTrip(slice.map((n, k) => step(k + 1, c, n)));
    if ("error" in r) {
      console.log(`  ERROR  ${c} [${String(i)}..] ${r.error}`);
      continue;
    }
    slice.forEach((n, k) => {
      const stored = r[k]?.[1];
      if (stored === n) ok.push(n);
      else rejected.push([c, n]);
    });
  }
  verified[c] = ok;
  const n = names.length;
  console.log(`  ${c.padEnd(20)} ${String(ok.length).padStart(4)}/${String(n).padEnd(4)} accepted`);
}

const total = Object.values(verified).reduce((a, v) => a + v.length, 0);
console.log(
  `\n${String(total)} exercise names verified across ${String(goodCategories.length)} categories; ` +
    `${String(rejected.length)} candidates rejected.`,
);
writeFileSync(outPath, JSON.stringify({ verified, rejected, categories: goodCategories }, null, 2));
console.log(`Wrote ${outPath}`);
