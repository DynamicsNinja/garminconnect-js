/**
 * CRUD round-trips that were IMPOSSIBLE on an empty account and are now possible because
 * `scripts/seed-test-account.ts` populated one.
 *
 *   npx tsx scripts/crud-verify.ts
 *
 * Each probe creates its own fixture, reads the value BACK from Garmin (never trusting that the
 * write returned 2xx), and deletes what it created. A write that returns 200 proves only that the
 * request was accepted — this project has shipped a 200 that stored 93 kg as 93,000 kg, so every
 * probe here asserts the STORED value, not the response.
 *
 * Complements `scripts/smoke-writes.ts`, which covers the round-trips that already worked on an
 * empty account. This file exists separately because these probes depend on seeded state.
 */
import "./load-env.js";
import { GarminClient, Garmin, FileTokenStore, GarminHttpError } from "../src/index.js";

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
if (!(await client.loadTokens())) {
  console.error("No tokens. Run `npm run login` first.");
  process.exit(1);
}
const g = new Garmin(client);

// SAFETY GATE — same unconditional check as every other write script here. Not skippable.
const expectedProfileId = process.env["GARMIN_TEST_PROFILE_ID"];
if (!expectedProfileId) {
  console.error("Refusing to run: GARMIN_TEST_PROFILE_ID is not set. Nothing was written.");
  process.exit(1);
}
const profile = await g.getUserProfile();
const liveProfileId = String(profile.profileId);
if (liveProfileId !== String(expectedProfileId)) {
  console.error(
    "Refusing to run: live profile does not match the expected test account.\n" +
      `  expected ${expectedProfileId}, found ${liveProfileId} ` +
      `(userName: ${profile.userName.slice(0, 2)}***@***)\nNothing was written.`,
  );
  process.exit(1);
}
console.log(`Safety gate passed: ${liveProfileId}\n`);

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Garmin's activity/weight lists are eventually consistent — poll rather than read once. */
async function pollUntil(fn: () => Promise<boolean>, tries = 10, delayMs = 1500): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true;
    await sleep(delayMs);
  }
  return false;
}

/** `getGear` returns UUIDs WITHOUT hyphens while `createGear`'s response uses them — normalize. */
function normalizeUuid(value: unknown): string | undefined {
  return typeof value === "string" ? value.replace(/-/g, "") : undefined;
}

let pass = 0;
let fail = 0;
async function probe(name: string, run: () => Promise<{ ok: boolean; detail: string }>) {
  try {
    const r = await run();
    if (r.ok) {
      pass++;
      console.log(`  PASS  ${name}\n        ${r.detail}`);
    } else {
      fail++;
      console.log(`  FAIL  ${name}\n        ${r.detail}`);
    }
  } catch (e) {
    fail++;
    const msg =
      e instanceof GarminHttpError
        ? `HTTP ${e.status}: ${e.body.slice(0, 160)}`
        : `${(e as Error).constructor.name}: ${(e as Error).message.slice(0, 160)}`;
    console.log(`  FAIL  ${name}\n        ${msg}`);
  }
}

// ---------------------------------------------------------------------------
await probe("setBloodPressure -> getBloodPressure read-back -> deleteBloodPressure", async () => {
  // Distinctive values so the read-back cannot collide with a seeded reading.
  const systolic = 131;
  const diastolic = 87;
  const when = new Date();
  const day = iso(when);

  await g.setBloodPressure(systolic, diastolic, 64, when, "[crud] probe");

  type Measurement = { version?: number; systolic?: number; diastolic?: number };
  const find = async (): Promise<Measurement | undefined> => {
    const range = (await g.getBloodPressure(day, day)) as {
      measurementSummaries?: { measurements?: Measurement[] }[];
    } | null;
    return (range?.measurementSummaries ?? [])
      .flatMap((s) => s.measurements ?? [])
      .find((m) => m.systolic === systolic && m.diastolic === diastolic);
  };

  const stored = await find();
  if (!stored) {
    return { ok: false, detail: `wrote ${systolic}/${diastolic} but could not read it back on ${day}` };
  }
  if (stored.version === undefined) {
    return { ok: false, detail: `read back ${systolic}/${diastolic} but it carries no version to delete by` };
  }

  await g.deleteBloodPressure(stored.version, day);
  const gone = await pollUntil(async () => (await find()) === undefined);
  return {
    ok: gone,
    detail: gone
      ? `wrote ${systolic}/${diastolic}, read back from Garmin, deleted version ${stored.version}, confirmed gone`
      : `stored and read back correctly, but delete did not remove version ${stored.version}`,
  };
});

// ---------------------------------------------------------------------------
await probe("uploadActivity (GPX) -> poll getActivities -> deleteActivity", async () => {
  // A synthetic track at Null Island — deliberately not a real location.
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="garminconnect-js-crud-probe" xmlns="http://www.topografix.com/GPX/1/1">
 <trk><name>[crud] uploadActivity probe</name><trkseg>
  <trkpt lat="0.00100" lon="0.00100"><ele>10</ele><time>2026-09-20T06:00:00Z</time></trkpt>
  <trkpt lat="0.00200" lon="0.00200"><ele>11</ele><time>2026-09-20T06:05:00Z</time></trkpt>
  <trkpt lat="0.00300" lon="0.00300"><ele>12</ele><time>2026-09-20T06:10:00Z</time></trkpt>
 </trkseg></trk>
</gpx>`;
  const before = new Set((await g.getActivities(0, 50)).map((a) => a.activityId));
  const file = new Blob([gpx], { type: "application/gpx+xml" });

  await g.uploadActivity(file, "crud-probe.gpx");

  // Garmin processes uploads asynchronously; the activity appears seconds later.
  let newId: number | undefined;
  const appeared = await pollUntil(async () => {
    const now = await g.getActivities(0, 50);
    const fresh = now.find((a) => !before.has(a.activityId));
    if (fresh) newId = fresh.activityId;
    return fresh !== undefined;
  }, 14, 2500);

  if (!appeared || newId === undefined) {
    return { ok: false, detail: "upload accepted, but no new activity appeared after ~35s of polling" };
  }

  await g.deleteActivity(newId);
  const gone = await pollUntil(async () => {
    const now = await g.getActivities(0, 50);
    return !now.some((a) => a.activityId === newId);
  });
  return {
    ok: gone,
    detail: gone
      ? `uploaded GPX, Garmin created activity ${newId}, deleted it, confirmed gone`
      : `uploaded and found activity ${newId}, but it did not disappear after delete`,
  };
});

// ---------------------------------------------------------------------------
await probe("addGearToActivity -> getActivityGear read-back -> removeGearFromActivity", async () => {
  // LIVE PRECONDITION, discovered here: Garmin rejects the link with
  // 400 "Gear's start date must be before activity's start date". The account's pre-existing gear
  // was created recently, so it cannot be attached to the older seeded activities. Create gear
  // dated well in the past instead of picking an arbitrary existing item.
  //
  // Gear has NO delete/retire endpoint anywhere in upstream or this port, so this leaves one more
  // permanent item on the throwaway account — an accepted cost, already true of Task 7's fixtures.
  const backdated = new Date(Date.now() - 400 * 86_400_000);
  // `notes` MUST be non-empty. The library's (and upstream's) default is `""`, which Garmin
  // rejects with 400 "'createGear.arg1.notes' size must be between 1 and 2000 (provided value: )".
  // Discovered here; recorded in AGENTS.md.
  const createdGear = (await g.createGear(
    "SHOES",
    "CrudProbe",
    "Linker",
    `[crud] link probe ${Date.now()}`,
    iso(backdated),
    "DISTANCE",
    undefined,
    undefined,
    "[crud] gear-link probe fixture",
  )) as { uuid?: string } | null;
  const gearUuid = createdGear?.uuid;
  if (!gearUuid) return { ok: false, detail: "createGear returned no uuid to link with" };

  const acts = await g.getActivities(0, 5);
  const act = acts[0];
  if (!act) return { ok: false, detail: "no activity on the account to link gear to" };
  await g.addGearToActivity(gearUuid, act.activityId);

  const linked = await pollUntil(async () => {
    const list = await g.getActivityGear(act.activityId);
    return (list ?? []).some((x) => normalizeUuid(x["uuid"]) === normalizeUuid(gearUuid));
  });
  if (!linked) {
    return { ok: false, detail: `addGearToActivity returned 2xx but gear ${gearUuid} never appeared on activity ${act.activityId}` };
  }

  await g.removeGearFromActivity(gearUuid, act.activityId);
  const unlinked = await pollUntil(async () => {
    const list = await g.getActivityGear(act.activityId);
    return !(list ?? []).some((x) => normalizeUuid(x["uuid"]) === normalizeUuid(gearUuid));
  });
  return {
    ok: unlinked,
    detail: unlinked
      ? `linked gear to activity ${act.activityId}, confirmed via getActivityGear, unlinked, confirmed gone`
      : `linked and confirmed, but removeGearFromActivity did not unlink it`,
  };
});

// ---------------------------------------------------------------------------
await probe("addBodyComposition (FIT upload) -> getBodyComposition read-back", async () => {
  // The FIT encoder's only live test. A wrong CRC or header yields a file Garmin rejects; a wrong
  // scale factor yields one it accepts and MISPARSES, which only a read-back exposes.
  const weightKg = 69.42;
  const day = iso(new Date());

  await g.addBodyComposition(weightKg, { percentFat: 18.5, boneMass: 3.2, muscleMass: 55.1 });

  const found = await pollUntil(async () => {
    const range = (await g.getBodyComposition(day, day)) as {
      totalAverage?: { weight?: number };
    } | null;
    const grams = range?.totalAverage?.weight;
    return typeof grams === "number" && Math.abs(grams / 1000 - weightKg) < 0.15;
  }, 12, 2500);

  if (!found) {
    const range = (await g.getBodyComposition(day, day)) as { totalAverage?: { weight?: number } } | null;
    return {
      ok: false,
      detail: `uploaded ${weightKg}kg as FIT; getBodyComposition shows ${String(range?.totalAverage?.weight)}g (expected ~${weightKg * 1000}g)`,
    };
  }
  return {
    ok: true,
    detail: `FIT upload accepted AND parsed correctly — ${weightKg}kg read back from getBodyComposition, proving the hand-rolled encoder's CRC, header and x100 weight scaling are right`,
  };
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
