# Garmin Connect web app — endpoint gap analysis

Captured 2026-09-22 by observing 188 network requests from `connect.garmin.com` while navigating
Home → Activities → Daily Summary → Gear → Badges, signed in as an empty test account.

**Purpose:** the parity plan ports `python-garminconnect`, so its ceiling is whatever upstream wrapped.
This checks what Garmin's own web client calls, to find endpoints upstream never covered.

**Method:** 64 unique endpoint paths observed (after stripping cache-busting params and ids), diffed
against `docs/upstream-method-inventory.md`. 19 matched an inventoried method; 45 did not.

Caveat: the test account is empty and has no device, so feature areas that need data — workouts,
training status, race predictions, golf, courses, segments — were never exercised. The real figure for
uncovered endpoints is higher than 45.

---

## Worth acting on

### 1. `gear-service/gear/v2/*` — upstream may be on a legacy endpoint

The web app calls:
```
GET /gear-service/gear/v2/list?start=0&limit=20&gearStatuses=ACTIVE&sortOrder=firstUseDate_desc
GET /gear-service/gear/v2/user-gear-types
```
Upstream `get_gear` uses `/gear-service/gear/filterGear?userProfilePk=…`, with no `v2`. Either the
v1 path still works and upstream is simply older, or v1 is deprecated and upstream's gear methods are
living on borrowed time.

**Action for Task 7 (gear):** implement upstream's paths as the inventory specifies — parity is the
goal — but smoke-test them live against the test account. If `filterGear` returns 404 or an error, that
is a real upstream breakage to record, and the v2 paths above are the replacement.

### 2. `gdprconsent-service/feature/UPLOAD` — would have diagnosed our 412 instantly

```
GET /gc-api/gdprconsent-service/feature/UPLOAD
GET /gc-api/gdprconsent-service/feature/INSIGHTS
```
This is the consent flag that blocked every write on the EU test account with
`412 PreconditionFailedException: "The user is from EU location, but upload consent is not yet granted"`.
Upstream has no equivalent. A consumer hitting that 412 has no way to check the precondition first.

**Suggested addition (not upstream parity, a genuine improvement):** a `getConsentStatus(feature)`
method, or at minimum documentation in `AGENTS.md` and the README explaining the 412 and naming this
endpoint as the diagnostic. Low cost, removes a confusing failure mode for EU users.

### 3. Aggregate and alternate-shape read endpoints upstream lacks

| Endpoint | What it gives | Upstream equivalent |
|---|---|---|
| `usersummary-service/stats/averages/{start}/{end}` | period averages in one call | none — callers must fetch daily and average themselves |
| `usersummary-service/usersummary/dailySummariesCount` | count of days with data | none |
| `wellness-service/wellness/dailyMovement?calendarDate=` | intraday movement series | none |
| `wellnessactivity-service/activity/summary/{date}` | different service entirely | none |
| `activitylist-service/activities/list/{id}?startTimestampLocal=&endTimestampLocal=` | activities by local time range | `get_activities_by_date` uses `search/activities` instead |
| `activitylist-service/activities/fordailysummary/{id}?calendarDate=` | activities for one day | `get_activities_fordate` — inventory has it, different shape |
| `weight-service/weight/daterangesnapshot?startDate=&endDate=` | weight snapshot over a range | `/weight/range/{s}/{e}` — similar, different endpoint |
| `bloodpressure-service/bloodpressure/daily/last/{s}/{e}` | most recent reading in range | range endpoint only |
| `usersummary-service/usersummary/hydration/allData/{date}` | full hydration detail | `hydration/daily/{date}` |
| `calendar-service/events?startDate=&endDate=` | calendar events | none at all |
| `device-service/sensors` | paired sensors | none |
| `device-service/deviceregistration/devices/all/{id}` | all devices incl. retired | `devices` only |
| `badge-service/badge/leaderboard`, `badge/leaderboard/all/`, `badge/attributes`, `badge/earned/latest/{id}` | badge leaderboards and metadata | earned/available only |
| `wellness-service/wellness/wellness-goals/consolidated/steps/{date}` | step goal for a date | none |
| `wellness-service/wellness/syncTimestamp` | last device sync time | none |

**Action:** none of these belong in the parity plan, whose scope is explicitly upstream parity. Record
them here as a candidate Plan 3. The `connectapi()` escape hatch already reaches all of them today, and
`AGENTS.md` documents that path.

---

## Deliberately ignored as noise

- **`userpreference-service/*`** (9 endpoints) — web UI state: nav collapsed, column config, tooltip
  dismissal, landing page. Not library surface.
- **`myfitnesspal-service/*`, `partner-service/partner/consumer/MY_FITNESS_PAL`** — third-party
  integration status.
- **`connection-service/*`** — social connections/friends.
- **`info-service`, `system-service/timezoneUnits`, `privacysettings-service`** — app bootstrap.
- **`userprofile-service/socialProfile/v2/public/multiple/id`, `capableEnable/pulseOxCapable`,
  `location`, `personal-information/{id}`** — profile fragments the web UI needs; the inventory's
  `socialProfile` and `user-settings` already cover what a library consumer wants.

---

## Conclusion

The parity plan's scope is unchanged: it ports upstream faithfully, and upstream is what it is. Two items
are worth carrying into the plan — the **gear v2 question** (a live-verification step in Task 7) and the
**GDPR consent endpoint** (documentation, since it explains a real 412 that EU users will hit). The rest
is a candidate Plan 3, reachable today via `client.connectapi(path)`.
