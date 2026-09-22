# garminconnect-js Endpoint Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the remaining 154 public methods of `python-garminconnect` onto the endpoint template proven in the foundation plan, reaching full parity.

**Architecture:** Each Garmin service becomes one file under `src/services/` exporting free functions that take a structural host (`{ readonly client: GarminClient; displayName(): Promise<string> }`), with matching response types under `src/types/`. `Garmin` gains a thin one-line delegation per method. No change to the auth, transport or client layers — this plan adds breadth on an unchanged foundation.

**Tech Stack:** TypeScript 5 (strict), Vitest, MSW, tsup, ESLint, npm.

**Spec:** `docs/superpowers/specs/2026-09-22-garminconnect-js-design.md`

**Authoritative endpoint reference:** `docs/upstream-method-inventory.md` — 154 methods with resolved paths, params, bodies, per-method null behaviour and gotchas, extracted from upstream source and spot-verified. **Every task transcribes from that document, not from memory and not from this plan.** Where the inventory and this plan disagree, the inventory wins; where the inventory is marked `UNCERTAIN`, see "Handling UNCERTAIN rows" below.

## Global Constraints

- Node >= 18. `engines.node` stays `">=18"`.
- **Zero runtime dependencies.** `dependencies` stays `{}` permanently.
- TypeScript `strict: true`. No `any` anywhere in `src/` — `npm run lint` enforces `@typescript-eslint/no-explicit-any` as an error.
- Server-only: no React, no `document`/`window`.
- Method names are camelCase (`getSleepData` ports `get_sleep_data`), taken from the inventory's `ts_name` column.
- Every date-taking method routes its input through `formatDate` from `src/util/date.ts` BEFORE building a path or query, so an invalid date throws before any HTTP request.
- Null-vs-throw behaviour is **per method**, copied from the inventory's `null_behaviour` column. There is no blanket policy. Upstream `get_heart_rates` raises on no data; `get_sleep_data` passes through. Match each one.
- Unit conversions are **per method**, copied from the inventory's `notes` column. `add_weigh_in` sends the caller's raw value; `create_gear` and `create_manual_activity` DO convert (km→metres, minutes→seconds). Getting this backwards in either direction is a shipped data-corruption bug — it has already happened once in this project.
- Conventional Commits.
- No real credentials, tokens, personal names, emails or GPS coordinates in any committed file.
- `AGENTS.md` must be updated in the same commit as the methods it describes. `tests/agents-md.test.ts` fails the build otherwise — that guard is deliberate and must not be weakened or skipped.

## Write-method verification policy

**AMENDED after the plan was written.** A dedicated, empty Garmin test account is now configured in
`.env`, and the user has authorised full CRUD testing against it. This replaces the original policy,
which shipped all 40 write methods unverified because the only account available held real personal
data.

- **Reads** are verified by a live smoke check per service (`npm run smoke -- <service>`).
- **Writes** are verified by a live CRUD round-trip per service (`npm run smoke:write -- <service>`),
  against the test account only.
- **A write round-trip means: create → read back → assert the stored value matches what was sent →
  delete → assert it is gone.** Reading the value back is the point. `addWeighIn` shipped green with
  189 passing tests while storing 93 kg as 93,000 kg; only reading the stored value caught it. A test
  that asserts the request shape proves nothing about what Garmin actually recorded.
- **Hard safety gate.** `scripts/smoke-writes.ts` MUST verify it is talking to the test account before
  issuing any write, by comparing the live `profileId` against `GARMIN_TEST_PROFILE_ID` from `.env`.
  If the variable is absent or the profile does not match, it refuses to run and exits non-zero. This
  is not optional and must not be bypassed: the same `tokens/` directory previously held a real
  account's credentials, and a re-login can swap it back at any time.
- **Where a write has no inverse** (`request_reload`, `push_workout_to_device`, the menstrual-cycle
  writes), verify what can be verified — that the call succeeds and any read-back endpoint reflects it
  — and record in the report that no delete was possible.
- **Destructive-but-verifiable writes are in scope on the test account**, including `delete_activity`
  and `delete_workout`, because the account is empty and the data is synthetic. Create the thing
  first, then delete it. Never run a bare delete against pre-existing data.

## Handling UNCERTAIN rows

The inventory marks some rows `UNCERTAIN`, mostly write methods whose null behaviour depends on `client.py` internals that were not reviewed, plus `add_body_composition` (depends on `fit.py`) and the GraphQL endpoint's missing leading slash.

For any `UNCERTAIN` row: implement the straightforward reading, add a code comment naming the uncertainty and what would resolve it, and list it in your task report. Do NOT invent behaviour to fill the gap, and do NOT silently pick an interpretation without recording it.

## File structure

```
src/services/
  wellness.ts          (exists — extend)     activities.ts     (exists — extend)
  weight.ts            (exists — extend)     bodyComposition.ts
  metrics.ts           devices.ts            gear.ts           workouts.ts
  badges.ts            goals.ts              womensHealth.ts   userProfile.ts
  golf.ts              nutrition.ts          trainingPlans.ts  misc.ts
src/types/             one file per service, same names
tests/services/        one test file per service
scripts/smoke-reads.ts new — live read verification, opt-in
```

`src/garmin.ts` gains one delegation per method and will grow to ~170 one-line methods. That is acceptable and matches the established pattern; do not restructure it.

---

### Task 1: Live read-smoke harness

Build the verification tool first, so every later task can prove its reads work against real Garmin rather than only against mocks.

**Files:**
- Create: `scripts/smoke-reads.ts`
- Modify: `package.json` (add `"smoke": "tsx scripts/smoke-reads.ts"`)

**Interfaces:**
- Consumes: `GarminClient`, `Garmin`, `FileTokenStore` from `src/index.js`; `loadEnv` from `scripts/load-env.js`.
- Produces: `npm run smoke -- <service>` — calls every READ method of a named service against the live API and prints a pass/fail table.

- [ ] **Step 1: Write the script**

```ts
import "./load-env.js";
import { GarminClient, Garmin, FileTokenStore, GarminError } from "../src/index.js";

type Probe = { name: string; run: () => Promise<unknown> };

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
if (!(await client.loadTokens())) {
  console.error("No tokens. Run `npm run login` first.");
  process.exit(1);
}
const g = new Garmin(client);
const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

// Each task appends its service's READ probes here.
const services: Record<string, Probe[]> = {
  wellness: [
    { name: "getUserSummary", run: () => g.getUserSummary(day) },
    { name: "getStepsData", run: () => g.getStepsData(day) },
  ],
};

const which = process.argv[2];
const probes = which ? services[which] : Object.values(services).flat();
if (!probes) {
  console.error(`Unknown service "${which}". Known: ${Object.keys(services).join(", ")}`);
  process.exit(1);
}

let pass = 0, fail = 0;
for (const p of probes) {
  try {
    const r = await p.run();
    const shape = r === null ? "null" : Array.isArray(r) ? `array[${r.length}]`
      : typeof r === "object" ? `object(${Object.keys(r as object).length} keys)` : typeof r;
    console.log(`  PASS  ${p.name.padEnd(34)} ${shape}`);
    pass++;
  } catch (e) {
    const err = e as Error;
    console.log(`  FAIL  ${p.name.padEnd(34)} ${err.constructor.name}: ${err.message.slice(0, 80)}`);
    fail++;
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
```

Note: it prints only response SHAPE, never values, so its output is safe to paste into a report.

- [ ] **Step 2: Add the npm script**

```bash
npm pkg set scripts.smoke="tsx scripts/smoke-reads.ts"
```

- [ ] **Step 3: Verify it runs**

Run: `npm run smoke -- wellness`
Expected: two PASS lines, or a clear message to run `npm run login`. Quote the real output in your report.

- [ ] **Step 4: Verify the suite still passes**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green. `scripts/` is excluded from the `files` array, so nothing ships.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-reads.ts package.json
git commit -m "feat: add live read-smoke harness for endpoint verification"
```

---

### Task 1b: Live write-smoke harness

**Added after the plan was written**, when a dedicated empty test account made live write verification
possible. The write policy above requires `npm run smoke:write -- <service>`; this task builds it. It must
land before Task 3, so every service from then on can verify its writes as it completes.

**Files:**
- Create: `scripts/smoke-writes.ts`
- Modify: `package.json` (add `"smoke:write": "tsx scripts/smoke-writes.ts"`)

**Interfaces:**
- Consumes: `GarminClient`, `Garmin`, `FileTokenStore`, error classes from `src/index.js`; `./load-env.js`.
- Produces: `npm run smoke:write -- <service>` — runs each service's write round-trips and prints pass/fail.

**The safety gate is the point of this task and is not optional.** Before issuing ANY write, the script
MUST fetch the live profile and compare `profileId` against `GARMIN_TEST_PROFILE_ID` from `.env`. On a
mismatch, or if the variable is absent, it prints what it found versus what it expected and exits non-zero
WITHOUT writing. The same `tokens/` directory held a real user's account earlier in this project and a
re-login can swap it back at any time; this gate is the only thing standing between a test run and someone's
real health record.

**Shape:** mirror `scripts/smoke-reads.ts` — a `Record<string, WriteProbe[]>` keyed by service so each of
the following tasks appends its own entry with a minimal, conflict-free edit.

```ts
type WriteProbe = {
  name: string;
  /** create → read back → assert stored value → delete → assert gone. Returns a pass/fail line. */
  run: () => Promise<{ ok: boolean; detail: string }>;
};
```

**Every probe follows the same five beats**, and the read-back is the part that matters: asserting the
request shape proves nothing about what Garmin actually stored. `addWeighIn` once passed 189 tests while
storing 93 kg as 93,000 kg, and only reading the value back caught it.

1. create
2. read it back
3. assert the stored value equals what was sent (converting units where the API does)
4. delete
5. assert it is gone — **poll with a short retry**, because Garmin's activity list is eventually
   consistent after a delete: an immediate read can still show the deleted item. Observed live in this
   project; an assert-immediately test fails intermittently.

**Cleanup is mandatory and must run in a `finally`,** so a failed assertion still removes whatever the
probe created. Every probe leaves the account as it found it.

Seed it with the one service that has verified writes today:

```ts
const services: Record<string, WriteProbe[]> = {
  weight: [
    { name: "addWeighIn/deleteWeighIn round-trip", run: async () => { /* … */ } },
  ],
};
```

Where a write has no inverse (`add_hydration_data`, `request_reload`, `push_workout_to_device`, the
menstrual writes), verify what can be verified — that the call succeeds and any read endpoint reflects it —
and have the probe report `no delete available` in its detail string rather than silently passing.

- [ ] **Step 1: Write `scripts/smoke-writes.ts`** with the safety gate, the `services` map, and the weight round-trip probe.
- [ ] **Step 2: Add the npm script.** `npm pkg set scripts."smoke:write"="tsx scripts/smoke-writes.ts"`
- [ ] **Step 3: Verify the gate fires.** Temporarily set `GARMIN_TEST_PROFILE_ID` to a wrong value in the environment for one run and confirm the script refuses and exits non-zero WITHOUT writing. Quote the output. Restore it afterwards.
- [ ] **Step 4: Verify a real round-trip.** `npm run smoke:write -- weight` against the test account; quote the output; confirm the account is left with zero weigh-ins.
- [ ] **Step 5: Full verification.** `npm test`, `npm run typecheck`, `npm run lint` — all green.
- [ ] **Step 6: Commit.**

```bash
git add scripts/smoke-writes.ts package.json
git commit -m "feat: add live write-smoke harness with test-account safety gate"
```

---

## Tasks 2–15: service ports

Tasks 2 through 15 each port one service. **They share an identical procedure**, given once here in full; each task below states only what differs (its service, its method list, and its specific gotchas). An implementer working a single task reads this procedure plus their own task section — both are required.

### The procedure every service task follows

**Step A — Read your rows in the inventory.** Open `docs/upstream-method-inventory.md`, find your service's section, and read every row. The `path`, `params`, `body`, `null_behaviour` and `notes` columns are authoritative. If a row says `UNCERTAIN`, follow "Handling UNCERTAIN rows" above.

**Step B — Write the failing tests first.** Create `tests/services/<service>.test.ts` with one test per method asserting the exact composed URL and query string, plus a test for each method whose `null_behaviour` is non-trivial. Use this shape:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import type { Tokens } from "../../src/auth/tokens.js";

const API = "https://connectapi.garmin.com";
const seen: { url: string; method: string; body?: unknown }[] = [];

const server = setupServer(
  http.get(`${API}/userprofile-service/socialProfile`, () =>
    HttpResponse.json({ displayName: "abc-display", userName: "testuser", fullName: "Test User", profileId: 1 }),
  ),
  // one handler per method under test, each pushing to `seen`
);

const tokens: Tokens = {
  oauth1: { oauth_token: "o1", oauth_token_secret: "s1", domain: "garmin.com" },
  oauth2: {
    scope: "CONNECT_READ", jti: "j", token_type: "Bearer",
    access_token: "at", refresh_token: "rt",
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token_expires_in: 7200, refresh_token_expires_at: Math.floor(Date.now() / 1000) + 7200,
  },
};

function makeGarmin(): Garmin {
  const client = new GarminClient();
  client.setTokens(tokens);
  return new Garmin(client);
}

beforeEach(() => { seen.length = 0; server.listen({ onUnhandledRequest: "error" }); });
afterEach(() => { server.resetHandlers(); server.close(); });
```

`onUnhandledRequest: "error"` and `resetHandlers()` are both required — the first catches a wrong URL, the second stops per-test overrides leaking.

**Assert the composed URL literally**, e.g. `expect(seen[0]!.url).toBe(`${API}/hrv-service/hrv/2026-09-22`)`. Do not rely on the handler's route pattern matching: a handler written from the same wrong assumption as the implementation proves nothing. This is how a total login failure survived 168 green tests in the foundation plan.

**Step C — Run the tests and watch them fail.** `npm test -- tests/services/<service>.test.ts`. Expected: module-not-found, then assertion failures. A test that passes before the implementation exists is not testing anything.

**Step D — Write the types.** `src/types/<service>.ts`, one interface per distinct response. Be honest: index signatures and `unknown` where Garmin's payload is undocumented. Never invent a field you have not seen.

**Step E — Write the service module.** `src/services/<service>.ts`, free functions over a structural host. The template, shown with a real method:

```ts
import { GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import type { HrvData } from "../types/wellness.js";

/** Implemented against a host exposing `client` and `displayName()`. */
export interface WellnessHost {
  readonly client: GarminClient;
  displayName(): Promise<string>;
}

export async function getHrvData(
  host: WellnessHost,
  cdate: string | Date,
): Promise<HrvData | null> {
  return host.client.connectapi<HrvData>(`/hrv-service/hrv/${formatDate(cdate)}`);
}
```

A method whose inventory row says it raises on empty:

```ts
export async function getHeartRates(
  host: WellnessHost,
  cdate: string | Date,
): Promise<HeartRateData> {
  const date = formatDate(cdate);
  const data = await host.client.connectapi<HeartRateData>(
    `/wellness-service/wellness/dailyHeartRate/${await host.displayName()}`,
    { params: { date } },
  );
  if (!data) throw new GarminError("No heart rate data received from Garmin");
  return data;
}
```

A method returning an array must coalesce, because `connectapi` returns `null` on 204:

```ts
export async function getStepsData(host: WellnessHost, cdate: string | Date): Promise<StepsEntry[]> {
  const date = formatDate(cdate);
  const steps = await host.client.connectapi<StepsEntry[]>(
    `/wellness-service/wellness/dailySummaryChart/${await host.displayName()}`,
    { params: { date } },
  );
  return steps ?? [];
}
```

A write method — note `value` carries the caller's raw number, and the POST is not retried by default:

```ts
export async function addWeighIn(
  host: WeightHost,
  weight: number,
  unitKey: "kg" | "lbs" = "kg",
  when: Date = new Date(),
): Promise<unknown> {
  return host.client.connectapi("/weight-service/user-weight", {
    method: "POST",
    json: {
      dateTimestamp: formatLocalTimestamp(when),
      gmtTimestamp: formatGmtTimestamp(when),
      unitKey,
      sourceType: "MANUAL",
      value: weight,
    },
  });
}
```

**Step F — Wire into `Garmin`.** Import the module namespace and add one mechanical delegation per method to `src/garmin.ts`:

```ts
import * as metrics from "./services/metrics.js";

// inside class Garmin:
  getTrainingStatus(cdate: string | Date) {
    return metrics.getTrainingStatus(this, cdate);
  }
```

**Step G — Export the types.** Add `export type * from "./types/<service>.js";` to `src/index.ts`. Do NOT export the `*Host` interfaces — they are internal.

**Step H — Update `AGENTS.md`.** Add your methods to the inventory section with exact signatures, and remove them from the "these do NOT exist" list. `tests/agents-md.test.ts` fails otherwise. Mark reads you verified live; mark writes "not live-verified".

**Step I — Add read probes to the smoke harness.** Append your service's READ methods to the `services` map in `scripts/smoke-reads.ts`. Use a date ~1 day back and ranges ~7 days back so data is likely to exist.

**Step J — Run everything.**

```bash
npm test
npm run typecheck
npm run lint
npm run smoke -- <service>          # reads, live
npm run smoke:write -- <service>    # writes, live, test account only (skip if the service has none)
```

The first three must be green. For the smoke run, report the real output verbatim. A `FAIL` line is expected and useful for endpoints the account has no data for (e.g. golf for a non-golfer) — report it, do not hide it, and distinguish "no data" from "wrong URL": a wrong URL surfaces as `GarminHttpError: … 404`, while no data surfaces as `null`, `[]` or a 204.

**Step K — Commit.**

```bash
git add src/services/<service>.ts src/types/<service>.ts src/garmin.ts src/index.ts \
        tests/services/<service>.test.ts AGENTS.md scripts/smoke-reads.ts
git commit -m "feat: port <service> endpoints"
```

---

### Task 2: wellness (30 methods)

**Files:** Modify `src/services/wellness.ts`, `src/types/wellness.ts`, `tests/services/endpoints.test.ts` (existing wellness tests live there — add a new `tests/services/wellness.test.ts` for the new methods rather than growing the old file past readability).

Inventory section: `wellness`. Six methods already exist (`getUserSummary`, `getStats`, `getStepsData`, `getHeartRates`, `getSleepData`, `getHrvData`, `getBodyBattery`) — do not duplicate or alter them; their behaviour is live-verified.

**Specific gotchas:** several methods take `(start, end)` ranges rather than a single date — validate BOTH through `formatDate`. `get_sleep_daily` has a 28-day range limit upstream documents; note it in a JSDoc comment. Respiration, SpO2, intensity minutes and floors are all single-date daily endpoints with differing null behaviour — read each row.

**Safely round-trippable writes:** `add_hydration_data` has no delete; treat as not round-trippable.

### Task 3: activities — core (14 methods)

**Files:** Modify `src/services/activities.ts`, `src/types/activities.ts`; create `tests/services/activities.test.ts`.

Inventory section: `activities`, the listing/CRUD half — `count_activities`, `get_activities`, `get_activities_fordate`, `get_activities_by_date`, `get_last_activity`, `get_activity`, `get_activity_types`, `delete_activity`, `set_activity_name`, `set_activity_type`, `set_activity_description`, `create_manual_activity`, `create_manual_activity_from_json`, `import_activity`.

**Specific gotchas:** `create_manual_activity` CONVERTS units (km→metres, minutes→seconds) — replicate exactly; this is the opposite of the weigh-in rule and getting it backwards corrupts data. `get_activities_by_date` paginates internally upstream — replicate the loop. `delete_activity` is irreversible: never live-test it.

### Task 4: activities — detail (14 methods)

**Files:** Modify `src/services/activities.ts`, `src/types/activities.ts`, `tests/services/activities.test.ts`.

Inventory section: `activities`, the per-activity detail half — splits, typed splits, split summaries, weather, HR-in-timezones, power-in-timezones, exercise sets (get and set), activity gear, gear-for-activity, progress summary, `download_activity`, `download_health_snapshot`, `get_activity_details`.

**Specific gotchas:** `download_activity` has five format branches — the CSV branch resolves to `/download-service/export/csv/activity/{id}`, which the foundation plan got wrong once. Transcribe all five from the inventory and pin each with a test. `download_*` return `Buffer` via `client.download()`, not `connectapi`.

### Task 5: metrics (16 methods)

**Files:** Create `src/services/metrics.ts`, `src/types/metrics.ts`, `tests/services/metrics.test.ts`.

Inventory section: `metrics`. Training status, training readiness, morning readiness, endurance score, hill score, running tolerance, race predictions, VO2max (`get_max_metrics`, `get_max_metrics_range`), FTP range, lactate threshold, fitness age.

**Specific gotchas:** `get_lactate_threshold` and `get_race_predictions` each build DIFFERENT URLs on different branches — the inventory records every branch and its condition; implement and test each branch. `get_endurance_score` and `get_hill_score` switch between daily and range endpoints depending on whether an end date is supplied.

### Task 6: workouts (18 methods)

**Files:** Create `src/services/workouts.ts`, `src/types/workouts.ts`, `tests/services/workouts.test.ts`.

Inventory section: `workouts`. Includes the six per-sport upload helpers (`upload_running_workout` and siblings), scheduling, and `push_workout_to_device`.

**Specific gotchas:** the per-sport helpers build large structured payloads. Transcribe the body field names exactly from the inventory; a wrong field name produces a 400 or, worse, a silently malformed workout. All are writes — none is live-tested. `delete_workout` and `unschedule_workout` are irreversible.

### Task 7: gear (9 methods)

**Files:** Create `src/services/gear.ts`, `src/types/gear.ts`, `tests/services/gear.test.ts`.

Inventory section: `gear`.

**Specific gotchas:** `create_gear` CONVERTS `maxUsageDistance` km→metres (`× 1000`) and `maxUsageDuration` minutes→seconds (`× 60`), rounding, with a floor of 1 — verified in upstream source. Replicate exactly, including the floor. This is the opposite direction from the weigh-in rule; do not generalise either one.

**Live-verification requirement specific to this task.** Garmin's own web client calls
`/gear-service/gear/v2/list` and `/gear-service/gear/v2/user-gear-types`, while upstream uses
`/gear-service/gear/filterGear` with no `v2` (see `docs/webapp-endpoint-gap-analysis.md`). Upstream may
be on a deprecated path. Implement upstream's paths as the inventory specifies — parity is the goal —
but smoke-test every gear read live. If `filterGear` returns a 404 or an error, STOP and report it: that
is a genuine upstream breakage, and the v2 paths are the replacement. Do not silently substitute v2.

### Task 8: womensHealth (11 methods)

**Files:** Create `src/services/womensHealth.ts`, `src/types/womensHealth.ts`, `tests/services/womensHealth.test.ts`.

Inventory section: `womensHealth`. Menstrual calendar, daily log, summary, reports, settings, cycle setup, period confirmation, pregnancy snapshot.

**Specific gotchas:** this handles sensitive health data. All writes are irreversible and MUST NOT be live-tested under any circumstances. Add a file-level comment saying so. Several rows are `UNCERTAIN` on null behaviour — follow the UNCERTAIN procedure and list them in your report.

### Task 9: badges and challenges (8 methods)

**Files:** Create `src/services/badges.ts`, `src/types/badges.ts`, `tests/services/badges.test.ts`.

Inventory section: `badges`. Earned, available and in-progress badges; adhoc challenges; completed, available, non-completed badge challenges; in-progress virtual challenges.

**Specific gotchas:** all reads, all list-returning — every one must coalesce `null` to `[]`.

### Task 10: weight and body composition (8 methods)

**Files:** Modify `src/services/weight.ts`, `src/types/weight.ts`; create `src/services/bodyComposition.ts`, `src/types/bodyComposition.ts`, `tests/services/bodyComposition.test.ts`.

Inventory sections: `weight` (remaining methods — `get_daily_weigh_ins`, `delete_weigh_ins`, `add_weigh_in_with_timestamps`) and `bodyComposition`.

**Specific gotchas:** `add_weigh_in_with_timestamps` sends the raw value like `add_weigh_in` — no grams conversion. `add_body_composition` is `UNCERTAIN` (depends on upstream `fit.py`, not reviewed): implement the straightforward reading, comment the uncertainty, and report it. `delete_weigh_ins` is irreversible.

**Safely round-trippable:** `add_weigh_in_with_timestamps` pairs with `delete_weigh_in`, so a live verification is cheap IF the user authorises one.

### Task 11: devices (6 methods)

**Files:** Create `src/services/devices.ts`, `src/types/devices.ts`, `tests/services/devices.test.ts`.

Inventory section: `devices`. Devices, device settings, primary training device, solar data, alarms, last-used.

**Specific gotchas:** `get_device_settings` takes a device id obtained from `get_devices` — document the two-call sequence in JSDoc. Solar data takes a device id and a date.

### Task 12: user profile, goals (5 methods)

**Files:** Create `src/services/userProfile.ts`, `src/types/userProfile.ts`, `src/services/goals.ts`, `src/types/goals.ts`, and their test files.

Inventory sections: `userProfile`, `goals`.

**Specific gotchas:** `get_unit_system` and `get_full_name` read cached state rather than calling an endpoint — the TS equivalents already exist on `Garmin` (`unitSystem()`, `fullName()`) and are live-verified. Do not duplicate them; note the mapping in `AGENTS.md`. `get_goals` paginates.

### Task 13: golf (5 methods)

**Files:** Create `src/services/golf.ts`, `src/types/golf.ts`, `tests/services/golf.test.ts`.

Inventory section: `golf`.

**Specific gotchas:** the smoke run will likely return empty or 404 for an account with no golf data. That is not a failure of the port — distinguish "no data" from "wrong URL" as Step J describes, and say which you observed.

### Task 14: nutrition, training plans (6 methods)

**Files:** Create `src/services/nutrition.ts`, `src/types/nutrition.ts`, `src/services/trainingPlans.ts`, `src/types/trainingPlans.ts`, and their test files.

Inventory sections: `nutrition`, `trainingPlans`.

### Task 15: misc, and final reconciliation (4 methods + reconciliation)

**Additional documentation requirement.** Garmin returns
`412 PreconditionFailedException: "The user is from EU location, but upload consent is not yet granted or
revoked"` for EVERY write on an EU account that has not granted upload consent. This was hit live during
this plan. The web client reads that flag from `GET /gc-api/gdprconsent-service/feature/UPLOAD`, which
upstream does not wrap. Document the 412 in both `AGENTS.md` and the README — what it means, that it is
an account-state precondition rather than a library bug, that it is fixed by granting consent in Garmin
Connect, and that the consent flag is readable via `client.connectapi("/gdprconsent-service/feature/UPLOAD")`.
An EU consumer will otherwise hit an opaque 412 on their first write.

**Files:** Create `src/services/misc.ts`, `src/types/misc.ts`, `tests/services/misc.test.ts`; modify `README.md`, `AGENTS.md`.

Inventory section: `misc` — `query_garmin_graphql`, `request_reload`, `get_lifestyle_logging_data`, `logout`.

**Specific gotchas:** the GraphQL endpoint constant upstream is `"graphql-gateway/graphql"` with NO leading slash, unlike every other constant — verify how the base URL joins and add a test pinning the composed URL. `logout` makes no HTTP call upstream; implement it as a local token clear via the `TokenStore` and say so in JSDoc.

**Reconciliation, the real deliverable of this task:**

- [ ] **Step 1: Assert full parity mechanically**

Write `tests/parity.test.ts` that reads `docs/upstream-method-inventory.md`, extracts every `ts_name`, and asserts each one exists as a method on `Garmin.prototype` — excluding a small, explicitly-listed set of deliberate omissions with a stated reason for each. Failure message must name the missing methods.

- [ ] **Step 2: Run it**

Run: `npm test -- tests/parity.test.ts`
Expected: PASS, or a precise list of what is still missing. If methods are missing, they belong to an earlier task that is not finished — do not weaken this test to make it pass.

- [ ] **Step 3: Update the README coverage table**

Replace the "14 implemented / ~145 roadmap" figures with the real ones, marking which are live-verified and which are writes shipped unverified.

- [ ] **Step 4: Full verification**

```bash
npm test && npm run typecheck && npm run lint && npm run build
npm run smoke          # every service's reads
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: port misc endpoints and assert full upstream parity"
```

---

## Definition of done

- `tests/parity.test.ts` passes: every `ts_name` in the inventory exists on `Garmin`, or is listed as a deliberate omission with a reason.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all green.
- `npm run smoke` runs every read against a live account; failures are explained and classified as no-data vs wrong-URL.
- `AGENTS.md` lists every method with correct signatures; its drift guard passes.
- README coverage figures are real.
- `dependencies` is still `{}`.
- No write method has been executed against a live account without the user's explicit per-method authorisation.
