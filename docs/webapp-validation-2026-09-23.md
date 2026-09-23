# Web-client validation pass — 2026-09-23

Second survey of `connect.garmin.com`, this time driving the UI in a signed-in browser while
recording network traffic, and diffing what Garmin's own client calls against what this port
implements.

Supersedes nothing in [`webapp-endpoint-gap-analysis.md`](webapp-endpoint-gap-analysis.md) — that
was a passive survey of an EMPTY account. This one is against a **seeded** account (9 activities,
9 weigh-in days, workouts, blood pressure, hydration), so far more of the UI actually renders and
far more endpoints fire. It also *acts*: wizards were completed and items deleted, which is how all three
headline findings surfaced.

## Headline findings

### 1. Gear CAN be deleted. Upstream just never wrapped it.

For the entire build this project documented gear fixtures as permanent, and accepted accumulating
residue on the test account on that basis. It was wrong.

Garmin's gear detail page has ⋮ → **Retire** and ⋮ → **Delete**. Delete issues:

```
DELETE /gear-service/gear/v2/{hyphenated-uuid}   -> 204
```

Verified through this client, then used to remove all five accumulated fixtures. The account now
holds **zero** gear.

**The hyphen trap:** `getGear` returns `uuid` WITHOUT hyphens; that form returns **404**. The
hyphenated form returns 204. Both directions confirmed live. `deleteGear` re-inserts the hyphens, so
only hand-rolled URLs hit this.

Now shipped as `deleteGear`, one of the two deliberately non-parity methods in this library.

### 2. Women's health was never a URL problem. It was a missing settings block.

Four of the five womensHealth writes had been failing with 400/500. Driving the first-run wizard at
`/app/menstrual-cycle-tracking` showed it POSTs:

```
POST /periodichealth-service/menstrualcycle/initCycleSetup
```

— **the exact path `initMenstrualCycleSetup` already used.** The URL was never wrong. The difference
is the BODY: the wizard also sends cycle type and contraception, which causes Garmin to create

```json
"userMenstrualCycleSettings": {
  "contraception": "NONE", "menstrualCycleType": "REGULAR",
  "avgCycleLength": 28, "avgPeriodLength": 5,
  "periodPrediction": true, "ovulationPrediction": true, "flowTracking": true
}
```

Upstream's three-field body returns 200 without creating it. Once the block exists, **all five
writes and all six reads succeed through this library unchanged** — no code change was needed.

Failure modes on an unconfigured account, for recognition:

| Call | Result |
|---|---|
| `updateMenstrualDailyLog` | 400 `MCT settings were not found` |
| `confirmMenstrualPeriodStart` | 400 `Can't add a new MCT cycle in any mode other than REGULAR, IRREGULAR, SEMI_REGULAR, or SEMI_IRREGULAR` |
| `updateMenstrualCalendar` | 500 `NullPointerException` |
| `getMenstrualCalendarData` | 500 `NullPointerException` — a READ that fails server-side |
| `updateMenstrualSettings` | 2xx, **silent no-op** |

Profile `gender` must be set (it was `null`) but is NOT sufficient on its own.

### 3. `setGearDefault` is dead upstream — the replacement is a v2 full-record PUT

Captured by injecting a `fetch`/XHR interceptor into the gear edit page and completing the Save.
There is **no dedicated default-gear endpoint any more**. Selecting "Activities for This Gear" and
saving issues:

```
PUT /gear-service/gear/v2/{uuid}
```

with the whole gear record, whose `associatedActivityTypes` field carries the defaults:

```json
"associatedActivityTypes": [
  {"activityTypeKey": "running", "defaultGear": true, "preferredGear": false}
]
```

That is the **same array shape `createGear` already posts** — and the keys are **lowercase**, while
`setGearDefault` upper-cases via `validateSportKey`. That asymmetry is upstream's own and is a
plausible reason its path never matched anything.

Proven side by side on one gear item:

| Call | Result |
|---|---|
| `setGearDefault("cycling", uuid, true)` (upstream's path) | error |
| `PUT /gear-service/gear/v2/{uuid}` with `associatedActivityTypes` | OK |

and `getGearDefaults` then returned both entries (`activityTypePk` 1 and 2).

Now shipped as `setGearActivityDefaults` — the second deliberately non-parity method here.
`setGearDefault` is kept as a faithful port of a dead endpoint.

### 4. `goal-service` is 1-indexed — `start=0` silently returns an empty array

Found by creating a goal through Garmin's UI (captured as `POST /goal-service/goal/goal` — note the
SINGULAR path; POSTing to the plural read path returns 405) and then noticing our `getGoals()` still
reported zero.

| `start` | result, on an account with exactly one active goal |
|---|---|
| `0` — upstream's default, and ours until now | `[]` |
| `1` | `[goal]` |

No error, no 404 — just an empty list, indistinguishable from "you have no goals". Upstream's
`get_goals()` therefore reports nothing on an account that has goals.

**Fixed:** `start` now defaults to `1`, a deliberate divergence, with a regression test. `start=0`
is still accepted — it just returns nothing, exactly as Garmin behaves.

The quirk is **specific to goal-service.** The same probe confirmed activity search and
`workout-service/workouts` return identical results at `start=0` and `start=1`, so their 0-based
defaults are correct and were left alone. Compare the badge-challenge endpoints, which reject
`start=0` with a loud 400 — same 1-indexing, far kinder symptom.

### 5. `createGear`'s duration conversion, verifiable at last

Open since Task 7 as "could NOT be read-back-verified" — no field on `getGear`, `getGearStats` or
`createGear`'s own response ever carried a duration. `/gear-service/gear/v2/{uuid}` does:
**90 min stored as `maxUsageDurationSeconds: 5400`.** Correct.

The same probe pinned the enum: `usageType` is one of `NONE` / `DISTANCE` / `DURATION` / `DATE`,
read from `/gear-service/gear/v2/usagetypes`. Previously documented as "unverified guesses".
`"TIME"` is rejected with `400 Invalid value 'TIME' for usageType`.

### 6. Training plans: enrolling via the UI unlocked one of the two by-id methods

Enrolled the test account in a Garmin Coach 5K plan (Training & Planning -> Garmin Coach Plans ->
Schedule). With a real plan present:

| Method | Result |
|---|---|
| `getAdaptiveTrainingPlanById` | **32-key object — verified** |
| `getTrainingPlanById` | `400 "Not a phased plan."` |

So the two are not interchangeable. `/phased/{id}` needs `trainingPlanCategory === "PHASED"`, and a
Garmin Coach plan is `STATIC`. The 400 is a precise server answer, not a wrong URL — the success
path stays unconfirmed because no route to a phased plan was found in the web UI.

**The id field is `trainingPlanId`**, not `planId` or `id`. The smoke harness had been guessing the
latter two, so those probes would have skipped forever even with a plan enrolled — the third
"skip that can never become a pass" in this project, and the first caught by having real data
rather than by review. Fixed, and the phased probe now checks the category and skips with that
reason rather than failing permanently.

### 7. Workout designer: multi-sport already works, and the constants are confirmed

Built a two-leg multisport workout (Run + Bike, transitions on) in Garmin's designer and captured
`POST /workout-service/workout` — the same path `uploadWorkout` uses. The structure:

```json
{ "sportType": {"sportTypeId": 10, "sportTypeKey": "multi_sport", "displayOrder": 5},
  "isSessionTransitionEnabled": true,
  "workoutSegments": [
    {"segmentOrder": 1, "sportType": {"sportTypeKey": "running", ...}, "workoutSteps": [...]},
    {"segmentOrder": 2, "sportType": {"sportTypeKey": "cycling", ...}, "workoutSteps": [...]}]}
```

That is the array this library already models, so **multi-sport needed no new code** — round-tripped
through `uploadWorkout`: created, read back with both segments and the transition flag intact,
deleted.

**`stepOrder` is GLOBAL across segments.** Numbering each leg's steps from 1 is rejected with
`400 "The workout steps need to have unique step orders, or all be unset and rely on submission
structure order."` Found the obvious way — by doing it wrong first.

**Every id in `WORKOUT_SPORT_TYPE_ID` etc. is now confirmed against real Garmin output**, where
before they were transcribed from upstream's `workout.py` alone: `multi_sport: 10`,
step `interval: 3`, condition `distance: 3` / `time: 2`, target `no.target: 1`.

The designer also offers **Cardio, HIIT, Yoga, Pilates, Mobility, Rucking and Custom** — eight types
(with Multisport) that the six `upload<Sport>Workout` helpers do not cover. All reachable via
`uploadWorkout` with an explicit `sportType`.

### 8. Complex workout steps: repeats, targets and exercises, built in the UI then rebuilt via API

Built a Run workout (warmup + interval + 2x repeat containing an interval with a pace target and a
recovery + cooldown) and a Strength workout (warmup + 3-set repeat of Barbell Back Squat + rest) in
the designer, captured both payloads, then rebuilt each through `uploadWorkout` and read it back.

**Both round-tripped intact.** `RepeatWorkoutGroup` and `ExecutableWorkoutStep` needed no changes —
their shapes, previously transcribed from upstream's `workout.py`, match real Garmin output.

Three things the capture settled that source reading could not:

1. **`stepOrder` continues through a repeat's children.** warmup=1, interval=2, repeat=3,
   children=4 and 5, cooldown=6. One global sequence; nested steps do not restart at 1.
   (Getting this wrong earns `400 "The workout steps need to have unique step orders"`.)
2. **`pace.zone` targets are SPEEDS in m/s, and `targetValueOne` is the FASTER, larger bound.**
   8:30-9:30 min/mile became `3.1556` / `2.8234`. Minutes-per-km would be silently wrong.
3. **Strength steps carry `category` + `exerciseName`** (`"SQUAT"` / `"BARBELL_BACK_SQUAT"`) with
   `endCondition: reps` and the count in `endConditionValue`. 548 exercises offered.

Also settled: **`displayOrder` is cosmetic.** A strength workout was accepted identically at
`displayOrder: 4` (Garmin's own value) and `5` (this library's) — so the mismatch between them is
not a bug.

## Path differences worth knowing

Every row below was called through `client.connectapi` and returned 200 — so these are live,
reachable alternatives, not speculation.

| Ours | Web client's | Note |
|---|---|---|
| `/menstrualcycle/pregnancysnapshot` → `null` | `/menstrualcycle/pregnancysnapshot/all` → `array[0]` | Different endpoints. Ours matches upstream, so parity holds; `/all` is the one the UI uses. |
| `/device-service/deviceregistration/devices` | `.../devices/all/{displayName}` | The `all` variant includes retired devices. |
| `/weight/dayview/{date}?includeAll=true` | `/weight/dayview/{date}` (no param) | Both work. |
| `/goal-service/goal/goals` `sortOrder=asc`, `start=0` | same path, `sortOrder=desc`, `start=1` | Ours mirrors upstream. `start=0` works here (unlike the badge-challenge endpoints, which reject it). |
| `/activitylist-service/activities/{uuid}/gear?start=0` | same, `start=1`, uuid **un-hyphenated** | Note the inverse of the delete trap: this one takes the bare form. |

## Section-by-section sweep

Clicked through every left-nav section with network capture on, and diffed each service against our
implementation. Result: **every path this port implements matches what Garmin's own client calls**,
with two cosmetic differences that were tested both ways and are genuinely interchangeable.

| Service | Web client calls | Ours | Verdict |
|---|---|---|---|
| nutrition | `/settings/{date}` (204), `/meals/{date}`, `/food/logs/{date}` | identical | exact match, 3/3 |
| wellness | `/dailySleepData/{displayName}?date=`, `/dailyStress/{date}` | identical | exact match |
| wellness | `/dailyHeartRate?date=` (no displayName) | `/dailyHeartRate/{displayName}?date=` | **both return the same 12-key object** — the segment is optional |
| wellness | `/dailyEvents/{displayName}?calendarDate=` | `/dailyEvents?calendarDate=` | **both work** — same, inverted |
| usersummary | `/usersummary/daily/{displayName}?calendarDate=` | identical | exact match |
| goal | `/goal/goals?status=active` (no paging for active/future) | always sends `start`/`limit`/`sortOrder` | ours mirrors upstream; both work |
| badge | `/badge/earned` | identical | exact match |
| weight | `/weight/dayview/{date}` | adds `?includeAll=true` | both work |
| gear | `/gear/v2/*` | `filterGear` (v1) for reads | v1 confirmed still live (see Task 7) |

The `displayName` segment being optional on `dailyHeartRate` and `dailyEvents` is worth knowing: it
means neither of those methods needs the profile fetch that resolving `displayName()` triggers. Not
changed here — our form is upstream's, and changing it would trade a verified path for an
unverified one to save one cached call.

## Reachable endpoints this port does not wrap

All verified 200 via `connectapi`. Candidates for a future plan; reachable today through the escape
hatch.

- `gear-service/gear/v2/list`, `/user-gear-types`, `/usagetypes`, `/default-gear-choices?gearTypes=`
- `weight-service/weight/latest?date=&ignorePriority=true` — 15-key object
- `badge-service/badge/earned/latest/{uuid}`, `/badge/attributes`, `/badge/leaderboard`
- `workout-service/benchmarks` — 17 entries
- `calendar-service/preferences`, `calendar-service/event/primary` (404 with no events)
- `nutrition-service/user/nutritionCurrentStatus`
- `goal-service/goal/goal` (POST, singular) — goal creation
- `gear-service/gear/v2/usagetypes` — the live `usageType` enum
- `wellness-service/wellness/syncTimestamp` — last device sync time
- `device-service/sensors`
- `jetlag-service/jetlag/trip/all`
- `web-gateway/snapshot/usageIndicators`, `web-gateway/inbox/unreadBubble`

## Still unresolved

Of the 13 methods not fully verified at the start of this pass, 4 were closed
(`requestReload`, `createGear`, `getGoals`, plus the five women's-health writes earlier). The
remaining ones need hardware or data that cannot be manufactured on this account: a paired device
(`getDeviceSettings`, `getDeviceSolarData`, `getDeviceAlarms` fan-out, `pushWorkoutToDevice`,
`downloadHealthSnapshot`), a Garmin Golf scorecard (`getGolfScorecard`, `getGolfShotData`), or a
PHASED training plan (`getTrainingPlanById` — the adaptive sibling is now verified).

## Method

Signed-in Edge InPrivate window, Claude browser extension, network log read per service after
navigating: activities, calendar, reports, personal records, weight, blood pressure, workouts,
badges, gear (list + detail + edit), menstrual cycle (full setup wizard).

Writes performed: the MCT setup wizard (permanent, authorized), one gear delete via UI and four via
API, and one gear default-activity save via UI (against a throwaway probe fixture). A `fetch`/XHR
interceptor was injected into the page to read request bodies, which the network-log tool does not
expose. No other account state was modified from the browser.
