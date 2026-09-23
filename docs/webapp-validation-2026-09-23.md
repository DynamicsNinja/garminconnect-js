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

## Reachable endpoints this port does not wrap

All verified 200 via `connectapi`. Candidates for a future plan; reachable today through the escape
hatch.

- `gear-service/gear/v2/list`, `/user-gear-types`, `/usagetypes`, `/default-gear-choices?gearTypes=`
- `weight-service/weight/latest?date=&ignorePriority=true` — 15-key object
- `badge-service/badge/earned/latest/{uuid}`, `/badge/attributes`, `/badge/leaderboard`
- `workout-service/benchmarks` — 17 entries
- `calendar-service/preferences`, `calendar-service/event/primary` (404 with no events)
- `nutrition-service/user/nutritionCurrentStatus`
- `device-service/sensors`
- `jetlag-service/jetlag/trip/all`
- `web-gateway/snapshot/usageIndicators`, `web-gateway/inbox/unreadBubble`

## Still unresolved

Nothing from this pass. The three questions it opened — gear deletion, women's health, and gear
defaults — all closed.

## Method

Signed-in Edge InPrivate window, Claude browser extension, network log read per service after
navigating: activities, calendar, reports, personal records, weight, blood pressure, workouts,
badges, gear (list + detail + edit), menstrual cycle (full setup wizard).

Writes performed: the MCT setup wizard (permanent, authorized), one gear delete via UI and four via
API, and one gear default-activity save via UI (against a throwaway probe fixture). A `fetch`/XHR
interceptor was injected into the page to read request bodies, which the network-log tool does not
expose. No other account state was modified from the browser.
