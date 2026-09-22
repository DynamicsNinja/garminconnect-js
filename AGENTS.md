# AGENTS.md — garminconnect-js

Briefing for coding agents. Not a tutorial; see `README.md` for that. This file states facts an
agent needs to avoid confidently wrong code, especially an agent whose training data includes
Python's `garminconnect`/`garth` and will assume this port has the same surface. It does not.

## 1. What this is, and the hard constraints

`garminconnect-js` is a zero-dependency TypeScript port of Python's `garminconnect` (and its auth
dependency `garth`) for **Node and Next.js server runtimes**. It talks to undocumented Garmin
Connect endpoints over HTTPS.

- **Node runtime only.** Uses `node:crypto` and `Buffer`. Never works on the Edge runtime. In a
  Next.js route handler you MUST add `export const runtime = "nodejs";`.
- **Server-only.** Credentials and tokens must never reach the browser. There is no client-side
  export, no `"use client"` entry point, and no safe way to call this from a Client Component.
- **Zero runtime dependencies.**
- **Node >= 18** (`engines.node` in `package.json`).

## 2. Minimal working example

```ts
import { GarminClient, Garmin, FileTokenStore } from "garminconnect-js";

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
await client.login(process.env.GARMIN_EMAIL!, process.env.GARMIN_PASSWORD!);

const garmin = new Garmin(client);
console.log(await garmin.getUserProfile());
console.log(await garmin.getSleepData("2026-09-20"));
```

For a process that already has tokens on disk, skip `login()` and call `client.loadTokens()`
instead (returns `false`, not throw, if nothing is stored):

```ts
const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
if (!(await client.loadTokens())) throw new Error("not connected to Garmin");
const garmin = new Garmin(client);
```

Every identifier above (`GarminClient`, `Garmin`, `FileTokenStore`) is exported from
`src/index.ts` and therefore from the package root `garminconnect-js`.

## 3. Complete method inventory

### `Garmin` (src/garmin.ts) — construct with `new Garmin(client: GarminClient)`

| Method | Signature | Live-verified |
|---|---|---|
| `getUserProfile` | `(): Promise<SocialProfile>` | yes |
| `getUserSettings` | `(): Promise<UserSettings>` | no (used internally by `unitSystem`) |
| `displayName` | `(): Promise<string>` | via `getUserProfile` |
| `fullName` | `(): Promise<string>` | via `getUserProfile` |
| `userName` | `(): Promise<string>` | via `getUserProfile` |
| `unitSystem` | `(): Promise<string \| undefined>` | yes |
| `getUserSummary` | `(cdate: string \| Date): Promise<UserSummary>` | yes |
| `getStats` | `(cdate: string \| Date): Promise<UserSummary>` — alias of `getUserSummary`, kept for parity with upstream's `get_stats` | yes |
| `getStepsData` | `(cdate: string \| Date): Promise<StepsEntry[]>` | yes |
| `getHeartRates` | `(cdate: string \| Date): Promise<HeartRateData>` | yes |
| `getSleepData` | `(cdate: string \| Date): Promise<SleepData \| null>` | yes |
| `getHrvData` | `(cdate: string \| Date): Promise<HrvData \| null>` | yes |
| `getBodyBattery` | `(startdate: string \| Date, enddate?: string \| Date): Promise<BodyBatteryEntry[]>` | yes |
| `getBodyBatteryEvents` | `(cdate: string \| Date): Promise<BodyBatteryEvent[] \| null>` | yes |
| `getFloors` | `(cdate: string \| Date): Promise<FloorsData>` — throws `GarminError` if Garmin returns nothing | yes |
| `getDailySteps` | `(start: string \| Date, end: string \| Date): Promise<DailyStepsEntry[] \| null>` — auto-chunks ranges over Garmin's 28-day-per-request limit into ≤28-day windows and concatenates; a single request within the limit passes its (possibly `null`) result through unchecked | yes |
| `getWeeklySteps` | `(end: string \| Date, weeks?: number): Promise<WeeklyStepsEntry[] \| null>` — `weeks` defaults to 52, must be a positive integer | yes |
| `getWeeklyStress` | `(end: string \| Date, weeks?: number): Promise<WeeklyStressEntry[] \| null>` — same `weeks` default/validation as `getWeeklySteps` | yes |
| `getWeeklyIntensityMinutes` | `(start: string \| Date, end: string \| Date): Promise<WeeklyIntensityMinutesEntry[] \| null>` | yes |
| `getStatsAndBody` | `(cdate: string \| Date): Promise<StatsAndBody>` — merges `getUserSummary` with the body-composition `totalAverage` block; inlines the `GET /weight-service/weight/dateRange` call the not-yet-ported `bodyComposition` service would make (see gotchas) | yes |
| `setBloodPressure` | `(systolic: number, diastolic: number, pulse?: number, when?: Date, notes?: string): Promise<BloodPressureSetResult \| null>` — validates systolic 70-260, diastolic 40-150, pulse (if given) 20-250, all integers; `when` defaults to `new Date()` | **no** — implemented, not live-verified |
| `getBloodPressure` | `(startdate: string \| Date, enddate?: string \| Date): Promise<BloodPressureRange \| null>` — `enddate` defaults to `startdate` | yes |
| `deleteBloodPressure` | `(version: number \| string, cdate: string \| Date): Promise<unknown>` — no proven inverse write to round-trip against in this task | **no** — implemented, not live-verified |
| `addHydrationData` | `(valueInMl: number, when?: Date, cdate?: string \| Date): Promise<HydrationLogResult \| null>` — raw milliliters, magnitude capped at 10000, negative values allowed; no delete endpoint exists, so **not safely round-trippable** | **no** — implemented, not live-verified |
| `getHydrationData` | `(cdate: string \| Date): Promise<HydrationLogResult \| null>` | yes |
| `getRespirationData` | `(cdate: string \| Date): Promise<RespirationData \| null>` | yes |
| `getSpo2Data` | `(cdate: string \| Date): Promise<Spo2Data \| null>` — coerces a string `lastSevenDaysAvgSpO2` to a number | yes |
| `getIntensityMinutesData` | `(cdate: string \| Date): Promise<IntensityMinutesData \| null>` | yes |
| `getAllDayStress` | `(cdate: string \| Date): Promise<DailyStressData \| null>` | yes |
| `getStressData` | `(cdate: string \| Date): Promise<DailyStressData \| null>` — identical URL to `getAllDayStress`, kept as a separate method for upstream API parity | yes |
| `getAllDayEvents` | `(cdate: string \| Date): Promise<DailyEventsData \| null>` | yes |
| `getSleepDaily` | `(start: string \| Date, end: string \| Date): Promise<SleepDailyEntry[]>` — Garmin's endpoint has a documented **28-day-per-request limit**; ranges beyond that are auto-chunked, de-duplicated by `calendarDate`, and sorted | yes |
| `getRhrDay` | `(cdate: string \| Date): Promise<RhrDayData \| null>` | yes |
| `getRhrDaily` | `(start: string \| Date, end: string \| Date): Promise<RhrDailyEntry[]>` — reshapes `allMetrics.metricsMap` into `[{calendarDate, value}]`, dropping null values | yes |
| `getCaloriesDaily` | `(start: string \| Date, end: string \| Date): Promise<CaloriesDailyEntry[]>` — merges active (metricId 22) and resting/BMR (metricId 23) series into `[{calendarDate, active, resting, total}]` | yes |
| `getHrvDataRange` | `(start: string \| Date, end: string \| Date): Promise<HrvDataRange \| null>` | yes |
| `countActivities` | `(): Promise<number>` — returns the envelope's `totalCount`, not the whole response; throws `GarminError` if Garmin returns nothing or a non-numeric `totalCount` | yes |
| `getActivities` | `(start?: number, limit?: number): Promise<Activity[]>` — defaults `start=0, limit=20` | yes |
| `getActivitiesForDate` | `(fordate: string \| Date): Promise<ActivitiesForDateResponse \| null>` — passes through unchecked; upstream's constant name is `garmin_connect_activity_fordate` but the resolved path is `/mobile-gateway/heartRate/...`, not an activities-service path | yes |
| `getActivitiesByDate` | `(startdate: string \| Date, enddate?: string \| Date, activitytype?: string, sortorder?: string): Promise<Activity[]>` — replicates upstream's internal pagination: fetches fixed pages of 20, incrementing `start` by 20, until an empty page (normal end) or 2000 pages without one (throws `GarminError`) | yes |
| `getLastActivity` | `(): Promise<Activity \| null>` — delegates to `getActivities(0, 1)`, returns the last element or `null` | yes |
| `getActivity` | `(activityId: number \| string): Promise<Activity>` | yes |
| `getActivityTypes` | `(): Promise<ActivityTypesResponse \| null>` — passes through unchecked; `ActivityTypesResponse` is `ActivityType[]` (154 entries observed live: `{typeId, typeKey, parentTypeId, isHidden, restricted, trimmable}`) — **the upstream inventory's `returns` column says "dict", but the live response is an array; this type reflects the observed reality, not that label** | yes |
| `deleteActivity` | `(activityId: number \| string): Promise<unknown>` — UNCERTAIN upstream null handling (see gotchas); resolves to `null` on success (204). Live-verified on synthetic fixtures created by the probe itself (never against pre-existing data) — create → delete → poll-confirm gone via `getActivities` | yes (fixture-only) |
| `setActivityName` | `(activityId: number \| string, activityName: string): Promise<unknown>` — UNCERTAIN upstream null handling; resolves to `null` on success. Live-verified: value read back via `getActivity` after the call, not just that the request was accepted | yes |
| `setActivityType` | `(activityId: number \| string, typeId: number, typeKey: string, parentTypeId: number): Promise<unknown>` — UNCERTAIN upstream null handling; resolves to `null` on success. Live-verified: `activityTypeDTO` read back via `getActivity` after the call | yes |
| `setActivityDescription` | `(activityId: number \| string, description: string): Promise<unknown>` — UNCERTAIN upstream null handling; resolves to `null` on success. Live-verified: `description` read back via `getActivity` after the call | yes |
| `createManualActivityFromJson` | `(payload: Record<string, unknown>): Promise<unknown>` — sends `payload` to Garmin verbatim, no shape validation; UNCERTAIN upstream null handling | yes (exercised via `createManualActivity`, which delegates to it with no other code path) |
| `createManualActivity` | `(startDatetime: string, timeZone: string, typeKey: string, distanceKm: number, durationMin: number, activityName: string): Promise<unknown>` — **converts units**: `distanceKm * 1000` → meters, `durationMin * 60` → seconds, before building the request body; `startDatetime` is NOT routed through `formatDate` (it's a full local timestamp, not a bare calendar date) — **must include milliseconds**, e.g. `"2026-09-22T10:00:00.000"` (upstream's documented pattern); omitting them produced a live HTTP 500 `ValueInstantiationException` from Garmin during verification. Live-verified: the converted `summaryDTO.distance`/`summaryDTO.duration` were read back via `getActivity` and matched the expected meters/seconds exactly (5.5km/30min → 5500m/1800s) | yes |
| `importActivity` | `(file: Blob, filename: string): Promise<ImportActivityResult>` — multipart upload to `/upload-service/upload/{ext}` (extension from `filename`, must be `fit`/`gpx`/`tcx`) with the load-bearing `NK`/`origin`/custom `User-Agent` headers that make Garmin treat it as an import rather than a device sync; a 409 is re-raised as `GarminConnectionError` ("Activity already exists (duplicate): ...") | yes — a synthetic GPX (fake, Null-Island-adjacent coordinates) was uploaded, Garmin processed it asynchronously (~3-6s), the resulting activity was found by polling `getActivities`, then deleted |
| `downloadActivity` | `(activityId: number \| string, format?: ActivityDownloadFormat): Promise<Buffer>` — `ActivityDownloadFormat` is `"ORIGINAL" \| "TCX" \| "GPX" \| "KML" \| "CSV"`, default `"ORIGINAL"` | yes — all 5 formats downloaded against a synthetic fixture and confirmed non-empty (364-1505 bytes each) |
| `getActivitySplits` | `(activityId: number \| string): Promise<ActivitySplits \| null>` — passes through unchecked | yes |
| `getActivityTypedSplits` | `(activityId: number \| string): Promise<ActivityTypedSplits \| null>` — passes through unchecked; richer detail than `getActivitySplits` for some activity types (e.g. Bouldering) | yes |
| `getActivitySplitSummaries` | `(activityId: number \| string): Promise<ActivitySplitSummaries \| null>` — passes through unchecked | yes |
| `getActivityWeather` | `(activityId: number \| string): Promise<ActivityWeather \| null>` — passes through unchecked | yes |
| `getActivityHrInTimezones` | `(activityId: number \| string): Promise<ActivityHrInTimezones \| null>` — passes through unchecked | yes (returned `[]` live — a synthetic manual/GPX fixture carries no HR data) |
| `getActivityPowerInTimezones` | `(activityId: number \| string): Promise<ActivityPowerInTimezones \| null>` — passes through unchecked | yes (returned `[]` live — same reason) |
| `getActivityDetails` | `(activityId: number \| string, maxchart?: number, maxpoly?: number): Promise<ActivityDetails \| null>` — defaults `maxchart=2000, maxpoly=4000`, sent as `maxChartSize`/`maxPolylineSize`; passes through unchecked | yes |
| `getActivityExerciseSets` | `(activityId: number \| string): Promise<ActivityExerciseSets \| null>` — passes through unchecked | yes |
| `setActivityExerciseSets` | `(activityId: number \| string, payload: ActivityExerciseSets): Promise<unknown>` — **replace-all semantics**, `payload` sent verbatim; UNCERTAIN upstream null handling. See gotchas for the payload shape Garmin actually requires (undocumented upstream) | yes — value read back via `getActivityExerciseSets` after the call and matched exactly (`duration`, `repetitionCount`, `exercises[0].category`) |
| `getActivityGear` | `(activityId: number \| string): Promise<ActivityGear \| null>` — passes through unchecked; inventory places this row under the "gear" section, not "activities" (see gotchas) | yes |
| `getGearActivities` | `(gearUUID: string, limit?: number): Promise<GearActivity[]>` — `limit` clamped to 1000; returns `[]` on a 404 instead of throwing; inventory places this row under "gear" | yes — exercised against a syntactically valid but non-existent gearUUID (no real gear exists on the test account; see gotchas), confirmed `[]` on the resulting 404 |
| `addGearToActivity` | `(gearUUID: string, activityId: number \| string): Promise<GearLinkResult \| null>` — on 404 re-raises as `GarminConnectionError` ("gear not found (likely retired/removed)"); inventory places this row under "gear" | yes — the 404 path and error message were exercised live against a real fixture activity + a non-existent gearUUID (see gotchas for why real gear was not created) |
| `removeGearFromActivity` | `(gearUUID: string, activityId: number \| string): Promise<GearLinkResult \| null>` — **PUT**, not DELETE; same 404-handling pattern as `addGearToActivity`; inventory places this row under "gear" | yes — same caveat as `addGearToActivity` |
| `getProgressSummaryBetweenDates` | `(startdate: string \| Date, enddate: string \| Date, metric?: string, groupbyactivities?: boolean): Promise<ProgressSummary \| null>` — defaults `metric="distance", groupbyactivities=true`; both dates routed through `formatDate`; passes through unchecked | yes |
| `downloadHealthSnapshot` | `(requestedDate: string \| Date): Promise<Buffer>` — routed through `formatDate`; UNCERTAIN upstream null handling, routed through `client.download` | attempted — 404 `NotFoundException` on the test account (no health snapshot exists for any date on an account that has never recorded one); the URL was transcribed verbatim from the inventory and matches the pattern exactly, so this 404 is PROBABLY "no data for this account" rather than a wrong-URL bug. **UNCONFIRMED:** unlike every other 404 in this library, no positive/success response has ever been observed for this path, so the classification rests on reasoning rather than evidence. A Health Snapshot is an opt-in, user-triggered recording; generate one on a test account and re-run to close this out |
| `getGear` | `(userProfileNumber: number \| string): Promise<Gear \| null>` — hits `/gear-service/gear/filterGear?userProfilePk=...`; passes through unchecked. This is the dedicated gear-CRUD service (`src/services/gear.ts`), distinct from `getActivityGear` (activities service, reuses the same base URL with `activityId` instead) | yes — live account returned the gear list (an array of gear objects) with no 404, confirming `filterGear` (the un-versioned path upstream uses) is NOT deprecated/broken, contrary to the concern that Garmin's own web client uses `/gear-service/gear/v2/list` instead |
| `createGear` | `(gearType: string, brand: string, model: string, name: string, firstUseDate: string \| Date, usageType?: string, maxUsageDistanceKm?: number, maxUsageDurationMin?: number, notes?: string, activityTypeKeys?: string[]): Promise<unknown>` — POSTs `/gear-service/gear/v2`; defaults `usageType="DISTANCE", notes=""`; `firstUseDate` routed through `formatDate`; `gearType`/`usageType` upper-cased via `validateSportKey`; **converts** `maxUsageDistanceKm` -> `maxUsageDistanceMeters` (`round(km*1000)`, floor 1) and `maxUsageDurationMin` -> `maxUsageDurationSeconds` (`round(min*60)`, floor 1) — the opposite direction from `addWeighIn`'s "send raw" rule; UNCERTAIN upstream null handling (implemented as a raw pass-through) | partially — live round-trip confirmed the DISTANCE conversion direction (`maxUsageDistanceKm=5` read back as `getGear`'s `maximumMeters: 5000`); the DURATION conversion (`maxUsageDurationMin` -> `maxUsageDurationSeconds`) could NOT be read-back-verified — no field on `getGear`, `getGearStats`, or the raw `createGear` response ever surfaced a duration value on the live account, so only the request-shape/rounding code (unit-tested) and upstream source review back that direction, not a live read-back. See gotchas |
| `getGearStats` | `(gearUUID: string): Promise<GearStats>` — GETs `/gear-service/gear/stats/{gearUUID}`; `gearUUID` validated via `validateUuid` (hex, hyphens optional); returns `{}` on a 404 instead of throwing; other errors re-raised | yes — both a real gear UUID (returned real stats) and a bogus hex UUID (returned `{}` on the 404) were exercised live |
| `getGearDefaults` | `(userProfileNumber: number \| string): Promise<GearDefaults \| null>` — GETs `/gear-service/gear/user/{userProfileNumber}/activityTypes`; passes through unchecked | yes |
| `setGearDefault` | `(activityType: string, gearUUID: string, defaultGear?: boolean): Promise<unknown>` — defaults `defaultGear=true`; verb is chosen dynamically: `true` PUTs `.../activityType/{activityType}/default/true`, `false` DELETEs `.../activityType/{activityType}`; `activityType` upper-cased via `validateSportKey` (opposite case convention from `createGear`'s lower-case `activityTypeKeys`, matching upstream's own asymmetry); on 404 re-raised as `GarminConnectionError` ("gear not found (likely retired/removed)") | partially — the 404-to-`GarminConnectionError` error-mapping path is confirmed live (same caveat as `addGearToActivity`/`removeGearFromActivity`); the SUCCESS path could not be exercised: every activityType format tried against real gear (lower-case key, upper-case key, mixed case, and the numeric `activityTypePk` `getGearDefaults` itself returns) 404s, including gear created with that activity type pre-associated via `activityTypeKeys`. See gotchas |
| `getWeighIns` | `(startdate: string \| Date, enddate: string \| Date): Promise<WeighInRange>` | yes |
| `addWeighIn` | `(weightValue: number, unitKey?: "kg" \| "lbs", when?: Date): Promise<unknown>` — defaults `unitKey="kg"`, `when=new Date()` | yes |
| `deleteWeighIn` | `(cdate: string \| Date, weightPk: number): Promise<null>` | yes |
| `getMaxMetrics` | `(cdate: string \| Date): Promise<MaxMetricsResult \| null>` — the date is repeated twice in the path (start=end=cdate); passes through unchecked | yes |
| `getMaxMetricsRange` | `(start: string \| Date, end: string \| Date): Promise<MaxMetricsResult \| null>` — throws `GarminError` if `start > end`; passes through unchecked | yes |
| `getFunctionalThresholdPowerRange` | `(start: string \| Date, end: string \| Date, sport?: string, aggregation?: string): Promise<FtpRangeResult \| null>` — defaults `sport="RUNNING"`, `aggregation="daily"`; `sport` upper-cased and validated (`^[A-Z_]+$`); `aggregation` restricted to `{daily,weekly,monthly,yearly}`; passes through unchecked | yes |
| `getLactateThreshold` | `(latest?: boolean, startDate?: string \| Date, endDate?: string \| Date, aggregation?: string): Promise<LactateThresholdLatest \| LactateThresholdRange>` — defaults `latest=true`, `aggregation="daily"`. TWO DIFFERENT branches, see gotchas: `latest=true` returns `{speed_and_heart_rate, power}` from two GETs; `latest=false` (requires `startDate`, throws otherwise) returns `{speed, heart_rate, power}` from three GETs | yes — both branches |
| `getTrainingReadiness` | `(cdate: string \| Date): Promise<TrainingReadinessEntry[] \| null>` — passes through unchecked | yes |
| `getMorningTrainingReadiness` | `(cdate: string \| Date): Promise<TrainingReadinessEntry \| null>` — delegates to `getTrainingReadiness`, no HTTP call of its own; filters for `inputContext === "AFTER_WAKEUP_RESET"`, falls back to the first entry; `null` for a falsy or empty result | yes |
| `getEnduranceScore` | `(startdate: string \| Date, enddate?: string \| Date): Promise<EnduranceScoreResult \| null>` — TWO branches by presence of `enddate`, see gotchas: no `enddate` hits the single-day endpoint; with `enddate` hits `.../stats` with hard-coded `aggregation="weekly"` | yes — both branches |
| `getRunningTolerance` | `(startdate: string \| Date, enddate: string \| Date, aggregation?: string): Promise<RunningToleranceEntry[] \| null>` — defaults `aggregation="weekly"`; restricted to `{daily,weekly}` (narrower than the FTP/lactate methods); passes through unchecked | yes |
| `getRacePredictions` | `(startdate?: string \| Date, enddate?: string \| Date, type?: "daily" \| "monthly"): Promise<RacePredictionsResult \| null>` — TWO branches, all-or-nothing params (throws on a partial combination), see gotchas: no params hits `.../latest/{displayName}`; all three hit `.../{type}/{displayName}`, capped at a 366-day span | yes — both branches |
| `getTrainingStatus` | `(cdate: string \| Date): Promise<TrainingStatusResult \| null>` — passes through unchecked | yes |
| `getFitnessAgeData` | `(cdate: string \| Date): Promise<FitnessAgeResult \| null>` — passes through unchecked | yes |
| `getHillScore` | `(startdate: string \| Date, enddate?: string \| Date): Promise<HillScoreResult \| null>` — TWO branches by presence of `enddate`, same shape as `getEnduranceScore` but the range branch hard-codes `aggregation="daily"` (NOT `"weekly"` — do not conflate the two), see gotchas | yes — both branches |
| `getCyclingFtp` | `(): Promise<CyclingFtpResult \| null>` — latest value only; use `getFunctionalThresholdPowerRange` for history | yes |
| `getHeartRateZones` | `(): Promise<HeartRateZoneEntry[] \| null>` — passes through unchecked | yes |
| `getPowerZones` | `(): Promise<PowerZoneEntry[] \| null>` — passes through unchecked | yes |
| `getPowerZonesForSport` | `(sport: string): Promise<PowerZonesForSportResult \| null>` — `sport` upper-cased and validated the same way as `getFunctionalThresholdPowerRange` | yes |
| `getWorkouts` | `(start?: number, limit?: number): Promise<WorkoutRecord[] \| null>` — defaults `start=0, limit=100`; passes through unchecked, stays nullable (does NOT coalesce to `[]`) | yes |
| `getWorkoutById` | `(workoutId: number \| string): Promise<WorkoutRecord \| null>` — passes through unchecked | yes |
| `deleteWorkout` | `(workoutId: number \| string): Promise<unknown>` — UNCERTAIN upstream null handling; deletes the template from the workout library, irreversible | yes (fixture-only: create via `uploadRunningWorkout`, delete, poll-confirm gone) |
| `downloadWorkout` | `(workoutId: number \| string): Promise<Buffer>` — UNCERTAIN upstream null handling; FIT-file bytes | yes |
| `uploadWorkout` | `(workoutJson: Record<string, unknown> \| unknown[] \| string): Promise<WorkoutRecord \| null>` — a string is JSON-parsed (throws `GarminError` on invalid JSON or a non-object/array result); UNCERTAIN upstream null handling | yes |
| `updateWorkout` | `(workoutId: number \| string, workoutJson: Record<string, unknown> \| string): Promise<WorkoutRecord \| null>` — full-replace PUT; forces `workoutId` into the body to match the path id; unlike `uploadWorkout`, a string must resolve to an object, not an array; UNCERTAIN upstream null handling | yes |
| `uploadRunningWorkout` | `(workout: WorkoutInput): Promise<WorkoutRecord \| null>` — fills the default `running` `sportType` (`{sportTypeId:1, sportTypeKey:"running", displayOrder:1}`) if the caller didn't supply one, then delegates to `uploadWorkout`; see gotchas for where the body shape came from | yes |
| `uploadCyclingWorkout` | `(workout: WorkoutInput): Promise<WorkoutRecord \| null>` — same pattern, default `sportType` `{sportTypeId:2, sportTypeKey:"cycling", displayOrder:2}` | yes |
| `uploadSwimmingWorkout` | `(workout: WorkoutInput): Promise<WorkoutRecord \| null>` — same pattern, default `sportType` `{sportTypeId:4, sportTypeKey:"swimming", displayOrder:3}` | yes |
| `uploadWalkingWorkout` | `(workout: WorkoutInput): Promise<WorkoutRecord \| null>` — same pattern, default `sportType` `{sportTypeId:17, sportTypeKey:"walking", displayOrder:17}` (17 is NOT in upstream's core `SportType` enum — see gotchas) | yes |
| `uploadHikingWorkout` | `(workout: WorkoutInput): Promise<WorkoutRecord \| null>` — same pattern, default `sportType` `{sportTypeId:18, sportTypeKey:"hiking", displayOrder:18}` (18 also not in the core enum) | yes |
| `uploadStrengthWorkout` | `(workout: WorkoutInput): Promise<WorkoutRecord \| null>` — same pattern, default `sportType` `{sportTypeId:5, sportTypeKey:"strength_training", displayOrder:5}` | yes |
| `pushWorkoutToDevice` | `(workoutId?: number \| string, deviceId?: number \| string): Promise<WorkoutRecord \| null>` — multi-call: resolves a missing `deviceId` via `/device-service/deviceservice/mylastused`'s `userDeviceId`, a missing `workoutId` via `getWorkouts(0,1)`'s first result (throws if none), then reads `getWorkoutById(workoutId).workoutName` for the push message; UNCERTAIN upstream null handling on the final POST | attempted live — see gotchas, no paired device on the test account |
| `getScheduledWorkouts` | `(year: number \| string, month: number \| string): Promise<CalendarMonth \| null>` — `month` is 1-12 on the way in, converted to 0-indexed on the wire; validates `year>=2000`, `month` 1-12; passes through unchecked | yes |
| `getScheduledWorkoutById` | `(scheduledWorkoutId: number \| string): Promise<WorkoutRecord \| null>` — uses a DIFFERENT base (`/workout-service/schedule`) than `getScheduledWorkouts` (`/calendar-service`); passes through unchecked | yes |
| `getNextScheduledWorkout` | `(): Promise<CalendarItem \| {}>` — computed from two `getScheduledWorkouts` calls (this month + next, handling Dec->Jan rollover); returns `{}` if nothing matches, never throws | yes |
| `scheduleWorkout` | `(workoutId: number \| string, dateStr: string \| Date): Promise<WorkoutRecord \| null>` — `dateStr` routed through `formatDate`; UNCERTAIN upstream null handling | yes |
| `unscheduleWorkout` | `(scheduledWorkoutId: number \| string): Promise<unknown>` — removes the calendar entry without deleting the workout template; irreversible; UNCERTAIN upstream null handling | yes |

`Garmin` exposes the underlying client as `readonly client: GarminClient`.

### `GarminClient` (src/client.ts) — construct with `new GarminClient(options?: GarminClientOptions)`

```ts
interface GarminClientOptions {
  tokenStore?: TokenStore;   // default: new MemoryTokenStore()
  isCn?: boolean;            // default false; true routes to garmin.cn
  timeoutMs?: number;        // default 10s for ordinary calls
  retries?: number;
  backoffMs?: number;
  fetchImpl?: typeof fetch;  // injection point for tests
}
```

| Method | Signature | Notes |
|---|---|---|
| `login` | `(email: string, password: string): Promise<LoginResult>` | `LoginResult` is `{state:"success", oauth1, oauth2} \| {state:"mfa_required", mfaState}`. Does NOT throw on MFA — check `result.state`. |
| `resumeLogin` | `(mfaState: MfaState, code: string): Promise<void>` | Completes an MFA login started elsewhere. |
| `loadTokens` | `(): Promise<boolean>` | Returns `false`, does not throw, when the store is empty. |
| `setTokens` | `(tokens: Tokens): void` | Synchronous, in-memory only; does not call `tokenStore.save`. |
| `getTokens` | `(): Tokens \| null` | |
| `connectapi<T>` | `(path: string, options?: ApiOptions): Promise<T \| null>` | The escape hatch — see section 4. Returns `null` on a 204 or empty body. |
| `download` | `(path: string, options?: ApiOptions): Promise<Buffer>` | Default timeout 60s, not 10s. **Not live-verified.** |
| `upload` | `(file: Blob, filename: string, path?: string, options?: Pick<ApiOptions,"timeoutMs" \| "headers">): Promise<unknown>` | `path` defaults to `/upload-service/upload`. Multipart, field name `file`; `Content-Type` is left unset so `fetch` sets the boundary. Default timeout 60s. `options.headers` (added for `importActivity`) is merged in AFTER the default `User-Agent` but BEFORE the transport's own `authorization` header — a caller can override `User-Agent` but never the injected bearer token. Live-verified via `importActivity` (a synthetic GPX upload). |

`ApiOptions`: `{ method?, params?: Record<string,string|number|undefined>, json?: unknown, headers?: Record<string,string>, timeoutMs?: number }`. There is no public `retry` field on `ApiOptions` — see section 6 for what that means for POST.

`readonly domain: string` (`"garmin.com"` or `"garmin.cn"`) and `readonly tokenStore: TokenStore` are also public on `GarminClient`.

## 4. These methods do NOT exist

This is a **partial port**: ~58 of upstream python-garminconnect's 154 public methods. An agent that has
seen `garminconnect` in training will write calls like `client.get_devices()` — that does not exist
here. Do not invent methods on `Garmin` or `GarminClient` by analogy with upstream names. (Gear IS now
fully ported — `getGear`, `createGear`, `getGearStats`, `getGearDefaults`, `setGearDefault` in
`src/services/gear.ts`, plus the activity-association methods in `src/services/activities.ts` — so
`client.get_gear()`-style calls DO have a TypeScript equivalent now, just camelCased and possibly
signature-shifted; check section 3 rather than assuming it is still absent.)

Notably absent (implement via `connectapi` instead — see below):

- Training plans (workouts themselves are implemented — see section 3 — but the separate
  `trainingPlans` service is not)
- Devices and device settings (except the one-off `mylastused` lookup `pushWorkoutToDevice`
  makes internally — there is no public `getDeviceLastUsed`)
- Badges and challenges (including virtual challenges)
- Goals
- Personal records
- Connect IQ
- Women's health, menstrual cycle tracking
- Body composition read/upload (`getStatsAndBody` inlines one body-composition GET call directly; the
  dedicated `bodyComposition` service — `getBodyComposition`, `addBodyComposition` — is a separate,
  not-yet-ported task)
- Golf
- Nutrition
- Segments
- Social/connections
- The GraphQL passthrough endpoint

**What to do instead:** call `client.connectapi<T>(path, options)` directly with the same
upstream Garmin Connect path. `connectapi` is the general HTTP-with-auth primitive every `Garmin`
method above is built on — it is not private, and using it for gaps is the intended pattern, not
a workaround. Find the right path by reading upstream's `garminconnect/__init__.py`
(https://github.com/cyberjunky/python-garminconnect) — every method there names the endpoint path
it calls; translate that path into a `connectapi` call here. Define your own response type; this
library has no type for endpoints it doesn't implement.

```ts
// Example: upstream get_devices() hits /device-service/deviceregistration/devices
const devices = await client.connectapi<unknown[]>("/device-service/deviceregistration/devices");
```

## 5. Auth model

`TokenStore` (src/auth/token-store.ts) is a three-method interface:

```ts
interface TokenStore {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}
```

`MemoryTokenStore` (default, process-lifetime only) and `FileTokenStore(dir)` (garth-compatible
on-disk JSON, atomic writes) ship in the package. For a real server, implement `TokenStore`
against your own database or cache — that is the normal production choice, not an edge case.

Refresh is driven by the **OAuth1 token**, not an OAuth2 refresh token — Garmin's flow has none.
Observed lifetimes: OAuth2 access token ~27h, OAuth1 token usable for ~30 days. A session rolls
forward indefinitely as long as some call happens at least once every 30 days; past that,
`GarminAuthError` is thrown and the user must log in again. Refresh happens automatically inside
`GarminClient` before every `connectapi`/`download`/`upload` call, and the refreshed tokens are
persisted via `tokenStore.save()` — callers never call refresh themselves.

`GarminAuthError` means re-login is required. The library never prompts for credentials on its
own; that's the caller's job.

MFA: `login()` returns `{ state: "mfa_required", mfaState }` instead of throwing or blocking for
input. `mfaState: MfaState` is plain JSON, contains no password, and is safe to put in a session
store and carry across an HTTP boundary — e.g. one Next.js route handler returns it, a later
request to a different route handler calls `client.resumeLogin(mfaState, code)` to finish the
login. This is the intended pattern for serverless MFA, not a workaround.

## 6. Gotchas

- **`setActivityExerciseSets`'s payload shape is undocumented upstream and stricter than it looks.**
  The upstream inventory says only "caller-supplied `payload` ... sent as-is." Live testing against
  the test account found Garmin rejects several plausible shapes before accepting one: it needs
  `activityId` repeated at the top level, inside each `exerciseSets[]` entry, AND inside each
  `exercises[]` entry (a bare `{category, name}` exercise object fails with "Activity ID should not
  be Null in the Exercises Object"); each set needs `setType` (fails with "Set Type in a Set message
  can not be Null" otherwise); and each set needs a `startTime` (an ISO-ish timestamp; its absence
  produced a bare 500 `NullPointerException` with no more specific message). The confirmed-working
  shape is:
  ```ts
  {
    activityId,
    exerciseSets: [{
      activityId,
      duration, repetitionCount, setType: "ACTIVE", startTime,
      exercises: [{ activityId, category: "SQUAT", subCategory: null }],
    }],
  }
  ```
  This library does not validate or reshape the caller's payload — it is sent verbatim, matching
  upstream — this note exists so a caller doesn't have to rediscover the same three 400/500s.
- **`getActivityGear`, `getGearActivities`, `addGearToActivity`, `removeGearFromActivity` were
  ported alongside `activities`, not `gear`**, even though the upstream inventory files all four
  under its "gear" section — the task that ported them targeted the activities service and folded
  these four in because they take an `activity_id` and are the activity/gear-association surface,
  not gear CRUD itself. They live in `src/services/activities.ts`. Gear CRUD (`getGear`,
  `createGear`, `getGearStats`, `getGearDefaults`, `setGearDefault`) was ported later, in
  `src/services/gear.ts` — see below.
- **`addGearToActivity`/`removeGearFromActivity` are STILL live-verified only on their 404 path,
  not a full add→read-back→remove round-trip**, even though real gear now exists on the test
  account (see the next point) — re-verifying the success path against real gear was out of scope
  for the task that added `gear.ts` and was not attempted.
- **Gear has no delete/retire endpoint anywhere in upstream `python-garminconnect` or this port.**
  The original "account ends with zero gear" rule made `createGear` unverifiable by any live
  round-trip; Task 7 explicitly overrode that rule for gear specifically (the test account is a
  disposable throwaway, and shipping a unit-converting write unverified was judged the worse risk —
  the exact bug class that previously turned 93kg into 93,000kg). **As a result the test account now
  permanently holds 3 gear items** created during that task's live verification (two from
  interactive investigation into why `setGearDefault` 404s, one from the final `npm run
  smoke:write -- gear` run) — see the task-7 report for their UUIDs. Any future write-probe or
  smoke run against this account will add more; there is no way to clean them up.
- **`createGear`'s distance conversion (km -> metres) was live-verified by round-trip; the duration
  conversion (min -> seconds) could NOT be.** `getGear`'s list entries expose a distance limit
  under the field `maximumMeters` (NOT `maxUsageDistanceMeters` — that name is the correct
  WRITE-side POST body field per the inventory, but no discovered read response echoes it under
  that name), which read back exactly as expected (5km sent -> `maximumMeters: 5000`). No field on
  `getGear`, `getGearStats`, or the raw `createGear` response was ever observed to carry a duration
  value at all, on any of the 3 gear items created — so the `min * 60` direction rests on upstream
  source review and the unit tests in `tests/services/gear.test.ts`, not a live read-back. Also
  note `getGear`'s list entries store `uuid` WITHOUT hyphens, while `createGear`'s own response
  uses hyphens — strip hyphens before comparing.
- **`setGearDefault`'s success path could not be made to work live, against either fresh gear or
  gear created with that activity type pre-associated via `activityTypeKeys`.** Every activityType
  format tried against real gear UUIDs 404s: the lower-case key (`running`), upper-case
  (`RUNNING`, what this library sends per `validateSportKey`), mixed case, and the numeric
  `activityTypePk` (`1`) that `getGearDefaults` itself returns for that same gear/activity-type pair
  — the numeric form 400s instead of 404ing, ruling out "just use the numeric ID" as a fix. This
  may mean upstream's own `set_gear_default` endpoint is broken/deprecated (parallel to the
  `filterGear`-vs-`v2` question this task also had to resolve — see the task-7 report), or there is
  a precondition this investigation did not find. Only the 404-to-`GarminConnectionError`
  error-mapping path is live-verified (same caveat already accepted for
  `addGearToActivity`/`removeGearFromActivity` above); the success path is UNCONFIRMED.
- **`filterGear` (the path `getGear`/`getActivityGear` use) is confirmed live, NOT deprecated.**
  Garmin's own web client calls `/gear-service/gear/v2/list` instead, which raised a concern that
  upstream's un-versioned `filterGear` might 404. Live testing found the opposite: `filterGear`
  returns 200 with the gear list (empty before any gear existed, 3 items after Task 7's live
  writes) — a genuine positive response, settling the question in upstream's favor for this path.
- **`getDailySteps` and `getSleepDaily` auto-chunk ranges over 28 days.** Garmin's underlying
  endpoints have a documented 28-day-per-request limit; both methods split a longer `(start, end)`
  range into ≤28-day windows internally and concatenate/de-duplicate the results — callers pass an
  arbitrary range and don't need to chunk themselves. Both throw `GarminError` if `start > end`.
- **`getStatsAndBody` depends on a body-composition endpoint the dedicated `bodyComposition`
  service doesn't wrap yet** (a separate, not-yet-ported task). It inlines a direct
  `GET /weight-service/weight/dateRange` call rather than delegating to a `getBodyComposition`
  method that doesn't exist in this version — if/when that service ships, revisit this delegation.
- **`addHydrationData` has no delete endpoint** — unlike `addWeighIn`/`deleteWeighIn`, a hydration
  log entry cannot be safely round-tripped away. It is not live-verified for this reason (write-only
  probes on an empty test account are the only verification performed).
- **`addWeighIn` vs `getWeighIns` unit asymmetry is real and deliberate.** `addWeighIn(weight,
  unitKey, when?)` sends `weight` RAW, in whatever unit `unitKey` names (`"kg"` or `"lbs"`) — do
  NOT pre-convert to grams; Garmin converts server-side. But `getWeighIns` returns Garmin's stored
  values in GRAMS regardless of recording unit — divide by 1000 to get kg on read. Applying the
  same conversion to both directions is the single most common bug here (a prior version of this
  library shipped exactly that bug and silently multiplied a stored weight by 1000).
- **`getSleepData` returns `SleepData | null`** — `null` is Garmin's ordinary "no data for that
  date" response, not an error; do not wrap it in a try/catch expecting a throw. `getHrvData` is
  the same. Other methods differ per endpoint (e.g. `getUserSummary`, `getHeartRates`,
  `getActivity` throw `GarminError` on a missing/empty response instead of returning `null`) —
  check the table in section 3, don't assume one policy applies to all methods.
- **Dates are UTC calendar dates.** `formatDate` accepts `"YYYY-MM-DD"` or a `Date`; a `Date` is
  formatted with `toISOString().slice(0,10)` (UTC), and a malformed or impossible string
  (`"2026-02-30"`, non-ISO shapes) throws `GarminError`. A caller in a negative UTC offset who
  passes `new Date()` late in their local day will get the following day's data, because it's
  already tomorrow in UTC.
- **POST is not retried automatically.** The HTTP layer retries GET/HEAD/PUT/DELETE/OPTIONS on
  a retryable status or network error; POST is skipped by default to avoid duplicating a write
  (e.g. double-submitting `addWeighIn`). There is an internal `retry: true` opt-in on the
  transport's `RequestOptions`, but it is not currently exposed on the public `ApiOptions` type
  that `connectapi`/`download`/`upload` accept — as of this version you cannot opt a public POST
  call into retries.
- **`Garmin` caches the user profile (and user settings) per instance**, not globally. Every
  date-scoped method resolves `displayName()` first, which triggers a `socialProfile` fetch on
  first use and reuses it afterward. Constructing a new `Garmin` per call costs an extra profile
  fetch every time; build one `Garmin` per authenticated user and reuse it across calls/requests.
- **`download()` and `upload()` default to a 60s timeout**, not the 10s default that ordinary
  `connectapi` calls use, because they move binary payloads. Both accept `timeoutMs` per call to
  override it.
- **Error taxonomy** (src/errors.ts): `GarminError` (base, also thrown directly for malformed
  responses) → `GarminAuthError` (401/403, failed SSO, expired tokens) / `GarminRateLimitError`
  (429, carries `retryAfter?: number` in seconds from `Retry-After` when present) /
  `GarminConnectionError` (network failure or timeout after retries) / `GarminHttpError` (any
  other non-2xx, carries `status: number`, `url: string`, `body: string`). Error messages have
  query strings redacted — a Garmin service ticket rides in the query string, so don't expect the
  full URL in a caught error's message.
- **`getLactateThreshold` has two branches with genuinely different response shapes** — the
  `latest` boolean picks between them, not a variant of the same call. `latest=true` (default)
  fires two GETs (`.../latestLactateThreshold` and `.../powerToWeight/latest/{today}`) and returns
  `{speed_and_heart_rate, power}`; `latest=false` fires three GETs (speed range, heart-rate range,
  and a delegated `getFunctionalThresholdPowerRange` call) and returns `{speed, heart_rate,
  power}` — and it throws unless `startDate` is supplied. The two branches also use DIFFERENT sport
  literals: the latest-branch power call sends the literal `sport=Running` (mixed case, not run
  through sport-key normalization — this is upstream's literal value), while the range branch sends
  fully-uppercase `sport=RUNNING`. Do not "clean up" the mixed-case one to match the other.
- **`getEnduranceScore` and `getHillScore` both branch on whether `enddate` is supplied**, and both
  hard-code an `aggregation` value on their range branch that is NOT the same value: endurance
  score's range branch hard-codes `"weekly"`; hill score's hard-codes `"daily"`. Conflating the two
  silently sends the wrong aggregation to Garmin.
- **`getRacePredictions` is all-or-nothing on `startdate`/`enddate`/`type`** — supplying one or two
  of the three throws; supplying none hits the `.../latest/{displayName}` endpoint; supplying all
  three hits `.../{type}/{displayName}` and additionally caps the span at 366 days. `type` must be
  `"daily"` or `"monthly"`.
- **The six per-sport workout upload helpers' body shape came from upstream's actual source, not
  from the inventory table alone.** `docs/upstream-method-inventory.md`'s `workouts` section
  documents these six rows only as `workout.to_dict()` from a `<Sport>Workout` pydantic model — it
  does not give the model's field-level shape. This port has zero runtime dependencies, so there is
  no pydantic model to port. Rather than invent a schema, the shape was read directly from
  `garminconnect/workout.py` in upstream `cyberjunky/python-garminconnect` on GitHub (fetched live
  during Task 6, not from training-data memory) — the actual implementation the inventory row
  summarizes. `src/types/workouts.ts` and `src/services/workouts.ts` carry the full citation. The
  six sports share IDENTICAL structure (`workoutName`, `estimatedDurationInSecs`,
  `workoutSegments`, `author`, `description`) except each one's default `sportType`
  `{sportTypeId, sportTypeKey, displayOrder}` triple, which is why one `buildSportWorkout` helper
  backs all six thin wrappers rather than six near-copies. Upstream additionally raises `TypeError`
  if `workout` isn't an instance of the matching pydantic class; this port instead does minimal
  required-field validation (`workoutName`/`estimatedDurationInSecs`/`workoutSegments` present) on
  a plain object, since there is no pydantic class to `instanceof`-check.
- **`pushWorkoutToDevice` was attempted live and failed — the test account has no paired device.**
  See the smoke-writes report for the exact error. This is a genuine account-state limitation, not
  a wrong URL: the multi-step resolution chain (`mylastused` -> `getWorkouts` ->
  `getWorkoutById`) was exercised successfully up to the final POST.
- **`getFunctionalThresholdPowerRange` and `getPowerZonesForSport` both normalize `sport`** by
  upper-casing it and validating it matches `^[A-Z_]+$` (`"cycling"` becomes `"CYCLING"`; `"run1"`
  throws) — this is the one sport-key validation shared across methods; the literal
  `sport=Running` in `getLactateThreshold`'s latest branch (above) deliberately bypasses it.

## 7. Anti-patterns

- Never import this package in a Client Component or an Edge route (`export const runtime =
  "edge"` or no runtime export in an environment that defaults to Edge). It will fail at runtime
  on `node:crypto`/`Buffer` usage, and even if it didn't, credentials/tokens must not reach the
  browser.
- Never put credentials, or a raw OAuth2 access token (~2 KB), in client-side code, local
  storage, or a cookie readable by the browser.
- Never write to a real Garmin account from an automated test. There is no sandbox environment;
  `addWeighIn` in a test run writes an entry into someone's real health record on
  connect.garmin.com. Live-hitting tests belong behind `npm run test:live`, gated on the
  developer explicitly having real tokens, never in the default `npm test` suite.
- Do not construct a new `GarminClient` (or a new `Garmin`) inside a loop or per-request when one
  instance can be reused — each `login`/`loadTokens` and each fresh `Garmin`'s first profile
  fetch is a real network round trip.

## 8. Testing against this library

Mock at the `fetch` layer, not by stubbing internals: `GarminClientOptions.fetchImpl` accepts
`typeof fetch`, so inject a mock/msw handler there and let the real `GarminClient`/`Garmin` code
run against it. This exercises the actual request construction, auth headers, retry logic, and
response parsing instead of a hand-rolled stand-in for them.

**A mock written from an assumption proves nothing.** Three real bugs in this library shipped
with green tests because the implementation, the mock, and the assertion all encoded the same
wrong assumption: a wrong SSO URL prefix, a wrong field name for the user profile, and the
weigh-in unit conversion described in section 6 that stored a 93 kg weigh-in as 93,000 kg. A
passing test suite built entirely on assumed request/response shapes does not confirm the shapes
are correct. For write endpoints (`addWeighIn`, `deleteWeighIn`, `login`, `upload`) a live
round-trip against a real (non-production-critical) account is what actually verifies behavior —
a request-shape assertion against a mock only verifies internal consistency.
