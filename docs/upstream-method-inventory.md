# Upstream `python-garminconnect` Method Inventory

Source: `garminconnect/__init__.py` from `cyberjunky/python-garminconnect` (master,
snapshot used for this inventory — 4437 lines). This document is the authoritative
reference for porting the `Garmin` class's public API to TypeScript. It records, per
method: the resolved HTTP endpoint, parameters/body, exact null/empty-response
behaviour, and any unit-conversion or validation gotchas a naive transcription would
get wrong.

## Summary

- **Total public methods inventoried: 154**
- **Reads (GET): 113**
- **Writes (POST/PUT/DELETE): 40**
- **Local-only (no HTTP call): 1** (`logout`)

Per-service counts:

| service | count |
|---|---|
| wellness | 30 |
| activities | 28 |
| weight | 6 |
| bodyComposition | 2 |
| metrics | 16 |
| devices | 6 |
| gear | 9 |
| workouts | 18 |
| badges | 8 |
| goals | 1 |
| womensHealth | 11 |
| userProfile | 4 |
| golf | 5 |
| nutrition | 3 |
| trainingPlans | 3 |
| misc | 4 |
| **Total** | **154** |

### Verification performed

`grep -cE "^    def [a-z]" gc.py` → **161**.

This count includes one false positive: `decorator` (line 406), a nested function
defined *inside* the module-level `_handle_api_errors` factory — it is not a method
of the `Garmin` class, so it must be subtracted. `161 − 1 = 160` real
lowercase-starting `Garmin` methods.

Subtracting the 6 excluded plumbing wrappers (`typed`, `connectapi`,
`connectwebproxy`, `download`, `login`, `resume_login`): `160 − 6 = 154`.

Independent confirmation via exclusion grep:

```
grep -nE "^    def " gc.py | grep -vE "def (decorator|__init__|_load_social_profile|_load_profile_and_settings|_require_display_name|typed|connectapi|connectwebproxy|download|login|resume_login)\(" | wc -l
→ 154
```

Both routes agree: **154**. The table below contains exactly 154 rows, and the
per-service counts above sum to 154.

### Spot-checked resolved paths (constant assignment vs. usage, quoted verbatim)

1. **`add_weigh_in`** (the exact endpoint implicated in the historical "93,000 kg" bug)
   - Constant (line 570): `self.garmin_connect_weight_url = "/weight-service"`
   - Usage (line 1424): `url = f"{self.garmin_connect_weight_url}/user-weight"`
   - Resolved: `/weight-service/user-weight`

2. **`download_activity`, CSV branch** (the exact endpoint implicated in the historical wrong-CSV-path bug)
   - Constant (line 726): `self.garmin_connect_csv_download = "/download-service/export/csv/activity"`
   - Usage (line 3177): `Garmin.ActivityDownloadFormat.CSV: f"{self.garmin_connect_csv_download}/{activity_id}"`
   - Resolved: `/download-service/export/csv/activity/{activity_id}`

3. **`get_hrv_data`**
   - Constant (line 679): `self.garmin_connect_hrv_url = "/hrv-service/hrv"`
   - Usage (line 2237): `url = f"{self.garmin_connect_hrv_url}/{cdate}"`
   - Resolved: `/hrv-service/hrv/{cdate}`

4. **`get_user_summary`**
   - Constant (line 571): `self.garmin_connect_daily_summary_url = "/usersummary-service/usersummary/daily"`
   - Usage (line 1132): `url = f"{self.garmin_connect_daily_summary_url}/{self._require_display_name()}"`
   - Resolved: `/usersummary-service/usersummary/daily/{displayName}`

5. **`get_workouts`**
   - Constant (line 735): `self.garmin_workouts = "/workout-service"`
   - Usage (line 3441 region): `url = f"{self.garmin_workouts}/workouts"`
   - Resolved: `/workout-service/workouts`

### Global behavioural notes that apply to many rows

- `connectapi(path, **kwargs)` is a thin, `_handle_api_errors`-decorated wrapper
  around `self.client.connectapi(path, **kwargs)`. It performs **no null-checking
  itself** — an empty/`None` response from the transport layer is returned to the
  caller unchanged unless the calling method explicitly checks it. Per-method
  `null_behaviour` below states whether that method adds a check.
- `_validate_date_format(s, name)` requires an exact `YYYY-MM-DD` string (regex
  `^\d{4}-\d{2}-\d{2}$`) and that it parses as a real calendar date; raises
  `ValueError` otherwise. `_validate_date_range(start, end)` additionally requires
  `start <= end`.
- Timestamps for writes use `_fmt_ts(dt)` → local time formatted
  `"%Y-%m-%dT%H:%M:%S.%f"[:-3]` (millisecond precision, naive/no offset in the
  string) and `_fmt_ts_utc()` for the menstrual-health endpoints (UTC, same format).
- `self.client.post/put/request(...)` calls are **not** wrapped by
  `_handle_api_errors`/retry logic the way `connectapi`/`download` are (that
  decorator is only applied to `connectapi`, `connectwebproxy`, and `download`).
  Write methods therefore surface whatever `self.client` raises directly (typically
  `GarminConnectConnectionError`/`GarminConnectAuthenticationError` from the client
  module, not from the methods themselves) — I could not fully resolve `client.py`'s
  internals in this pass, so exact write-path exception types are marked
  `UNCERTAIN` where relevant.
- Methods that need the account's display name call
  `self._require_display_name()`, which URL-encodes it (`quote(name, safe="")`) and
  raises `GarminConnectConnectionError` if it cannot be loaded even after one retry
  via `_load_social_profile()`.

---

## wellness

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| get_stats | getStats | GET | (delegates) | — | — | `cdate: str` | dict | delegates entirely to `get_user_summary`, so inherits its behaviour | Validates `cdate` then calls `self.get_user_summary(cdate)`; "compat for garminconnect" alias. |
| get_user_summary | getUserSummary | GET | `/usersummary-service/usersummary/daily/{displayName}` | `calendarDate` | — | `cdate: str` | dict | raises `GarminConnectConnectionError("No data received from server")` if response falsy; raises `GarminConnectAuthenticationError("Authentication error")` if `response.get("privacyProtected") is True` | `cdate` validated via `_validate_date_format`. |
| get_steps_data | getStepsData | GET | `/wellness-service/wellness/dailySummaryChart/{displayName}` | `date` | — | `cdate: str` | list | returns `[]` and logs a warning if `response is None` | Endpoint constant is `garmin_connect_user_summary_chart`. |
| get_floors | getFloors | GET | `/wellness-service/wellness/floorsChartData/daily/{cdate}` | — | — | `cdate: str` | dict | raises `GarminConnectConnectionError("No floors data received")` if `response is None` | |
| get_daily_steps | getDailySteps | GET | `/usersummary-service/stats/steps/daily/{start}/{end}` (chunked) | — | — | `start: str, end: str` | list | single-request path returns whatever `connectapi` returns unchecked; chunked path only appends `chunk_results` when truthy | Garmin's endpoint has a 28-day limit; for ranges >28 days this method auto-splits into ≤28-day chunks (`timedelta(days=27)` windows) and concatenates. `start_date > end_date` raises `ValueError`. |
| get_weekly_steps | getWeeklySteps | GET | `/usersummary-service/stats/steps/weekly/{end}/{weeks}` | — | — | `end: str, weeks: int = 52` | list | passes through `connectapi` result unchecked | `weeks` validated as positive integer via `_validate_positive_integer`. |
| get_weekly_stress | getWeeklyStress | GET | `/usersummary-service/stats/stress/weekly/{end}/{weeks}` | — | — | `end: str, weeks: int = 52` | list | passes through unchecked | Same weeks validation as above. |
| get_weekly_intensity_minutes | getWeeklyIntensityMinutes | GET | `/usersummary-service/stats/im/weekly/{start}/{end}` | — | — | `start: str, end: str` | list | passes through unchecked | |
| get_heart_rates | getHeartRates | GET | `/wellness-service/wellness/dailyHeartRate/{displayName}` | `date` | — | `cdate: str` | dict | raises `GarminConnectConnectionError("No heart rate data received")` if `response is None` | |
| get_stats_and_body | getStatsAndBody | GET | (delegates: `get_stats` + `get_body_composition`) | — | — | `cdate: str` | dict | merges `stats` dict with `body.get("totalAverage")` (defaulting to `{}` if missing/non-dict); no explicit null-guard beyond that | "compat for garminconnect". Two HTTP calls sequenced: `get_stats(cdate)` then `get_body_composition(cdate)`. |
| get_body_battery | getBodyBattery | GET | `/wellness-service/wellness/bodyBattery/reports/daily` | `startDate`, `endDate` | — | `startdate: str, enddate: str \| None = None` | list | passes through unchecked | `enddate` defaults to `startdate` if omitted. |
| get_body_battery_events | getBodyBatteryEvents | GET | `/wellness-service/wellness/bodyBattery/events/{cdate}` | — | — | `cdate: str` | list | passes through unchecked | Returns event dicts (sleep, recorded/auto-detected activities, naps). |
| set_blood_pressure | setBloodPressure | POST | `/bloodpressure-service/bloodpressure` | — | `measurementTimestampLocal, measurementTimestampGMT, systolic, diastolic, sourceType="MANUAL", notes, pulse?` | `systolic: int, diastolic: int, pulse: int \| None = None, timestamp: str = "", notes: str = ""` | dict (`.json()`) | UNCERTAIN — no explicit check; returns `self.client.post(...).json()` directly | `pulse` is **optional** (Garmin's own UI allows blood pressure without HR). Validated ranges: systolic 70–260, diastolic 40–150, pulse (if given) 20–250 — all must be `int`; out-of-range/non-int raises `ValueError`. Timestamp defaults to `datetime.now()`, converted to UTC via `.astimezone(UTC)` for the GMT field. |
| get_blood_pressure | getBloodPressure | GET | `/bloodpressure-service/bloodpressure/range/{startdate}/{enddate}` | `includeAll=True` | — | `startdate: str, enddate: str \| None = None` | dict | passes through unchecked | `enddate` defaults to `startdate`. |
| delete_blood_pressure | deleteBloodPressure | DELETE | `/bloodpressure-service/bloodpressure/{cdate}/{version}` | — | — | `version: str, cdate: str` | dict (`.json()`) | UNCERTAIN — no explicit null check, calls `.json()` on the delete response directly | `version` must parse as a positive integer (validated then re-stringified). |
| add_hydration_data | addHydrationData | PUT | `/usersummary-service/usersummary/hydration/log` | — | `calendarDate, timestampLocal, valueInML` | `value_in_ml: float, timestamp: str \| None = None, cdate: str \| None = None` | dict (`.json()`) | UNCERTAIN — no explicit null check | **`value_in_ml` is sent RAW, in milliliters, unconverted** (field name `valueInML`); negative values are allowed (subtraction), magnitude capped at `MAX_HYDRATION_ML = 10000`. Complex date/timestamp reconciliation logic: if both omitted, uses now(); if only `cdate` given, uses local midnight of that date; if only `timestamp` given, derives `cdate` from it; if both given, validates the timestamp's date matches `cdate` and raises `ValueError` on mismatch. |
| get_hydration_data | getHydrationData | GET | `/usersummary-service/usersummary/hydration/daily/{cdate}` | — | — | `cdate: str` | dict | passes through unchecked | |
| get_respiration_data | getRespirationData | GET | `/wellness-service/wellness/daily/respiration/{cdate}` | — | — | `cdate: str` | dict | passes through unchecked | |
| get_spo2_data | getSpo2Data | GET | `/wellness-service/wellness/daily/spo2/{cdate}` | — | — | `cdate: str` | dict | passes through unchecked (only mutates if `data` is a dict) | If `data["lastSevenDaysAvgSpO2"]` comes back as a `str`, it is coerced to `float` in place before returning — replicate this normalization in TS. |
| get_intensity_minutes_data | getIntensityMinutesData | GET | `/wellness-service/wellness/daily/im/{cdate}` | — | — | `cdate: str` | dict | passes through unchecked | |
| get_all_day_stress | getAllDayStress | GET | `/wellness-service/wellness/dailyStress/{cdate}` | — | — | `cdate: str` | dict | passes through unchecked | Same base URL as `get_stress_data` (`garmin_connect_daily_stress_url`). |
| get_all_day_events | getAllDayEvents | GET | `/wellness-service/wellness/dailyEvents` | `calendarDate` | — | `cdate: str` | dict | passes through unchecked | Includes autodetected activities even if not saved on the watch. Constant is `garmin_daily_events_url` (note: no `connect` in the attribute name). |
| get_sleep_data | getSleepData | GET | `/wellness-service/wellness/dailySleepData/{displayName}` | `date`, `nonSleepBufferMinutes=60` | — | `cdate: str` | dict | passes through unchecked | Docstring warns China/UTC+8 accounts may see `sleepStartTimestampLocal`/`sleepEndTimestampLocal` double-offset; prefer the `*GMT` fields and convert locally if porting logic that consumes this. |
| get_sleep_daily | getSleepDaily | GET | `/sleep-service/stats/sleep/daily/{chunkStart}/{chunkEnd}` (chunked, string-literal path — no `self.*_url` constant used) | — | — | `start: str, end: str` | list | per-chunk: `for row in (data or {}).get("individualStats") or []` — tolerates `None`/missing key gracefully, no raise | 28-day-per-request limit; auto-chunks like `get_daily_steps`. De-duplicates by `calendarDate` across chunks and sorts the merged result by `calendarDate`. **Note:** this is the one wellness endpoint whose path is a literal string, not built from a `self.garmin_connect_*` constant assigned in `__init__`. |
| get_stress_data | getStressData | GET | `/wellness-service/wellness/dailyStress/{cdate}` | — | — | `cdate: str` | dict | passes through unchecked | Identical URL construction to `get_all_day_stress` — same endpoint, kept as two Python methods for API compat. |
| get_rhr_day | getRhrDay | GET | `/userstats-service/wellness/daily/{displayName}` | `fromDate=cdate`, `untilDate=cdate`, `metricId=60` | — | `cdate: str` | dict | passes through unchecked | metricId 60 = resting heart rate. |
| get_rhr_daily | getRhrDaily | GET | `/userstats-service/wellness/daily/{displayName}` | `fromDate=start`, `untilDate=end`, `metricId=60` | — | `start: str, end: str` | list | defensively navigates `(data or {}).get("allMetrics") or {}` then `.get("metricsMap", {})`; filters out rows where `value is None` | Reshapes response into `[{calendarDate, value}, ...]`. |
| get_calories_daily | getCaloriesDaily | GET | `/userstats-service/wellness/daily/{displayName}` | `fromDate=start`, `untilDate=end`, `metricId=[22, 23]` | — | `start: str, end: str` | list | same defensive `(data or {})` navigation as `get_rhr_daily` | metricId 22 = active calories, 23 = BMR/resting calories. Merges both series by date into `{calendarDate, active, resting, total}`; `total = (a or 0) + (r or 0)`; rows where both are `None` are skipped. |
| get_hrv_data | getHrvData | GET | `/hrv-service/hrv/{cdate}` | — | — | `cdate: str` | dict \| None | passes through unchecked (return type explicitly allows `None`) | |
| get_hrv_data_range | getHrvDataRange | GET | `/hrv-service/hrv/daily/{start}/{end}` | — | — | `start: str, end: str` | dict \| None | passes through unchecked | |

## bodyComposition

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| get_body_composition | getBodyComposition | GET | `/weight-service/weight/dateRange` | `startDate`, `endDate` | — | `startdate: str, enddate: str \| None = None` | dict | passes through unchecked | `enddate` defaults to `startdate`; raises `ValueError` if `startdate > enddate`. |
| add_body_composition | addBodyComposition | POST (multipart upload) | `/upload-service/upload` | — | uploads a generated `.fit` file (`FitEncoderWeight`), not JSON | `timestamp: str \| None, weight: float, percent_fat, percent_hydration, visceral_fat_mass, bone_mass, muscle_mass, basal_met, active_met, physique_rating, metabolic_age, visceral_fat_rating, bmi` (all optional except `weight`) | dict/Response from `client.post` | UNCERTAIN — no null check in this method; returns `self.client.post(...)` directly | **`weight` is validated positive/finite but NOT unit-converted in `gc.py`** — it is passed as-is into `FitEncoderWeight.write_weight_scale(weight=weight, ...)`. Whether `fit.py`'s encoder performs its own unit conversion for the FIT binary format is `UNCERTAIN: fit.py was not in scope for this inventory (only garminconnect/__init__.py was reviewed) — check FitEncoderWeight before assuming raw kg is correct on the wire.` This is a multi-step call: build FIT binary in-memory (`write_file_info`, `write_file_creator`, `write_device_info`, `write_weight_scale`, `finish`) then POST it as `files={"file": ("body_composition.fit", fitEncoder.getvalue())}`. |

## weight

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| add_weigh_in | addWeighIn | POST | `/weight-service/user-weight` | — | `dateTimestamp, gmtTimestamp, unitKey, sourceType="MANUAL", value` | `weight: int \| float, unitKey: str = "kg", timestamp: str = ""` | dict \| None | returns `_validate_json_exists(response)`: if HTTP status is 204, returns `None`; otherwise returns `response.json()` | **`weight` is sent RAW as `value`, in whatever unit `unitKey` names — no conversion to grams or any other unit happens in Python.** This is exactly the bug class called out in the task: a naive port that multiplies by 1000 "to get grams" would corrupt every write. `unitKey` must be one of `{"kg", "lbs"}` (`VALID_WEIGHT_UNITS`) or raises `ValueError`. `timestamp` defaults to `datetime.now()` if empty; GMT field derived via `.astimezone(UTC)`. |
| add_weigh_in_with_timestamps | addWeighInWithTimestamps | POST | `/weight-service/user-weight` | — | `dateTimestamp, gmtTimestamp, unitKey, sourceType="MANUAL", value` | `weight: int \| float, unitKey: str = "kg", dateTimestamp: str = "", gmtTimestamp: str = ""` | dict \| None | same as `add_weigh_in`: `_validate_json_exists` — `None` on 204, else `.json()` | Same **raw-value, no-conversion** rule as `add_weigh_in`. If `gmtTimestamp` provided and naive (no tzinfo), it's *assumed to already be UTC* (`tzinfo=UTC` applied directly, not converted); if provided with tzinfo, it's converted via `.astimezone(UTC)`. If omitted, GMT is derived from the local `dt`. |
| get_weigh_ins | getWeighIns | GET | `/weight-service/weight/range/{startdate}/{enddate}` | `includeAll=True` | — | `startdate: str, enddate: str` | dict | passes through unchecked | |
| get_daily_weigh_ins | getDailyWeighIns | GET | `/weight-service/weight/dayview/{cdate}` | `includeAll=True` | — | `cdate: str` | dict | passes through unchecked | |
| delete_weigh_in | deleteWeighIn | DELETE | `/weight-service/weight/{cdate}/byversion/{weight_pk}` | — | — | `weight_pk: str, cdate: str` | Any (raw client response) | UNCERTAIN — returns raw `self.client.request("DELETE", ...)` result unchecked | `weight_pk` is coerced to `int`, validated positive, then re-stringified into the path. |
| delete_weigh_ins | deleteWeighIns | (delegates to `delete_weigh_in`, no direct HTTP path of its own) | — | — | — | `cdate: str, delete_all: bool = False` | `int \| None` | returns `None` and logs a warning if `get_daily_weigh_ins(cdate)["dateWeightList"]` is empty; if multiple weigh-ins exist and `delete_all=False`, also returns `None` (logs warning, does not delete) | Multi-step: calls `get_daily_weigh_ins`, then loops calling `delete_weigh_in(w["samplePk"], cdate)` for each entry. Returns the count of weigh-ins deleted on success. |

## metrics

Covers training status/readiness, VO2max/max metrics, endurance, hill score, race predictions, FTP, lactate threshold, fitness age, HR/power zones.

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| get_max_metrics | getMaxMetrics | GET | `/metrics-service/metrics/maxmet/daily/{cdate}/{cdate}` | — | — | `cdate: str` | dict | passes through unchecked | Note the date is repeated twice in the path (start=end=cdate). |
| get_max_metrics_range | getMaxMetricsRange | GET | `/metrics-service/metrics/maxmet/daily/{start}/{end}` | — | — | `start: str, end: str` | dict | passes through unchecked | Uses `_validate_date_range` (also enforces `start <= end`). |
| get_functional_threshold_power_range | getFunctionalThresholdPowerRange | GET | `/biometric-service/stats/functionalThresholdPower/range/{start}/{end}` | `sport` (normalized uppercase), `aggregation`, `aggregationStrategy="LATEST"` | — | `start: str, end: str, *, sport: str = "RUNNING", aggregation: str = "daily"` | dict \| list | passes through unchecked | `aggregation` must be one of `{daily, weekly, monthly, yearly}` or raises `ValueError`. `sport` normalized via `_validate_sport_key` (upper-cased, must match `^[A-Z_]+$`). Undocumented endpoint used because `get_cycling_ftp` only returns latest. |
| get_lactate_threshold | getLactateThreshold | GET (multi-call, two branches) | Branch `latest=True`: `/biometric-service/biometric/latestLactateThreshold` **and** `/biometric-service/biometric/powerToWeight/latest/{today}`. Branch `latest=False`: (calls `get_functional_threshold_power_range`) **plus** `/biometric-service/stats/lactateThresholdSpeed/range/{start_date}/{end_date}` **and** `/biometric-service/stats/lactateThresholdHeartRate/range/{start_date}/{end_date}` | latest branch power call: `sport="Running"`; range branch: `sport="RUNNING"`, `aggregation`, `aggregationStrategy="LATEST"` on speed/HR calls | — | `*, latest: bool = True, start_date: str \| date \| None = None, end_date: str \| date \| None = None, aggregation: str = "daily"` | dict | latest branch: if `power` response is a non-empty list, uses `power[0]`; if dict, uses it as-is; else `{}` (never raises). Iterates `speed_and_heart_rate` (assumed iterable — will raise `TypeError` if the endpoint returns `None`) merging into a defaults dict; falls back `entry.get("heartRate") or entry.get("hearRate")` (Garmin's own historical typo) | **Two distinct call shapes per branch — record both.** `latest=True`: returns `{"speed_and_heart_rate": {...merged...}, "power": power_dict}`. `latest=False`: requires `start_date` (raises `ValueError` if omitted while `latest=False`); `end_date` defaults to today; both normalized from `date` objects or validated strings; returns `{"speed": ..., "heart_rate": ..., "power": <result of get_functional_threshold_power_range>}`. `aggregation` validated against `{daily, weekly, monthly, yearly}`. |
| get_training_readiness | getTrainingReadiness | GET | `/metrics-service/metrics/trainingreadiness/{cdate}` | — | — | `cdate: str` | list | passes through unchecked | |
| get_morning_training_readiness | getMorningTrainingReadiness | GET (delegates to `get_training_readiness`, no direct HTTP path) | — | — | — | `cdate: str` | dict \| None | returns `None` if `get_training_readiness(cdate)` result is falsy; if the underlying result is a `dict` (defensive — real endpoint returns a list), returns it directly | Filters the list for `entry.get("inputContext") == "AFTER_WAKEUP_RESET"`; falls back to `data[0]` (logged at debug level) if no such entry exists — not all firmware populates `inputContext`. |
| get_endurance_score | getEnduranceScore | GET (two branches by presence of `enddate`) | Single day: `/metrics-service/metrics/endurancescore`. Range: `/metrics-service/metrics/endurancescore/stats` | Single day: `calendarDate=startdate`. Range: `startDate, endDate, aggregation="weekly"` | — | `startdate: str, enddate: str \| None = None` | dict | passes through unchecked | Single-day call returns precise daily values; range call returns aggregated **weekly** values (hard-coded `aggregation="weekly"`, not configurable). |
| get_running_tolerance | getRunningTolerance | GET | `/metrics-service/metrics/runningtolerance/stats` | `startDate, endDate, aggregation` | — | `startdate: str, enddate: str, aggregation: str = "weekly"` | list | passes through unchecked | `aggregation` restricted to `{"daily", "weekly"}` (note: narrower set than the FTP/lactate methods, which also allow monthly/yearly) — raises `ValueError` otherwise. |
| get_race_predictions | getRacePredictions | GET (two branches, all-or-nothing params) | No-params branch: `/metrics-service/metrics/racepredictions/latest/{displayName}`. Range branch: `/metrics-service/metrics/racepredictions/{_type}/{displayName}` | Range branch: `fromCalendarDate=startdate`, `toCalendarDate=enddate` | — | `startdate: str \| None = None, enddate: str \| None = None, _type: str \| None = None` | dict | passes through unchecked | `_type` must be `"daily"`, `"monthly"`, or `None`, else `ValueError`. Must supply **all three** args or **none** — any partial combination raises `ValueError("you must either provide all parameters or no parameters")`. Range branch also enforces `(enddate - startdate).days <= 366`. |
| get_training_status | getTrainingStatus | GET | `/metrics-service/metrics/trainingstatus/aggregated/{cdate}` | — | — | `cdate: str` | dict | passes through unchecked | |
| get_fitnessage_data | getFitnessAgeData | GET | `/fitnessage-service/fitnessage/{cdate}` | — | — | `cdate: str` | dict | passes through unchecked | |
| get_hill_score | getHillScore | GET (two branches by presence of `enddate`) | Single day: `/metrics-service/metrics/hillscore`. Range: `/metrics-service/metrics/hillscore/stats` | Single day: `calendarDate=startdate`. Range: `startDate, endDate, aggregation="daily"` | — | `startdate: str, enddate: str \| None = None` | dict | passes through unchecked | Range branch's `aggregation` is hard-coded `"daily"` (contrast with `get_endurance_score`, which hard-codes `"weekly"` for its range branch — do not conflate the two). |
| get_cycling_ftp | getCyclingFtp | GET | `/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING` | — | — | (none) | dict \| list | passes through unchecked | Returns only the latest value; use `get_functional_threshold_power_range` for history. |
| get_heart_rate_zones | getHeartRateZones | GET | `/biometric-service/heartRateZones` | — | — | (none) | list | passes through unchecked | Configured HR zones for all sport profiles. |
| get_power_zones | getPowerZones | GET | `/biometric-service/powerZones/sports/all` | — | — | (none) | list | passes through unchecked | |
| get_power_zones_for_sport | getPowerZonesForSport | GET | `/biometric-service/powerZones/sport/{sport}` | — | — | `sport: str` | dict | passes through unchecked | `sport` normalized via `_validate_sport_key`. |

## devices

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| get_devices | getDevices | GET | `/device-service/deviceregistration/devices` | — | — | (none) | list | passes through unchecked | |
| get_device_settings | getDeviceSettings | GET | `/device-service/deviceservice/device-info/settings/{device_id}` | — | — | `device_id: str` | dict | passes through unchecked | `device_id` coerced to `int`, validated positive, re-stringified. |
| get_primary_training_device | getPrimaryTrainingDevice | GET | `/web-gateway/device-info/primary-training-device` | — | — | (none) | dict | passes through unchecked | |
| get_device_solar_data | getDeviceSolarData | GET | `/web-gateway/solar/{device_id}/{startdate}/{enddate}` | `singleDayView` (bool: `True` if `enddate` omitted) | — | `device_id: str, startdate: str, enddate: str \| None = None` | list | raises `GarminConnectConnectionError("No device solar input data received")` if `resp` falsy or missing key `"deviceSolarInput"` | Returns `resp["deviceSolarInput"]`, not the whole response envelope. `enddate` defaults to `startdate` (and `singleDayView=True` in that case). |
| get_device_alarms | getDeviceAlarms | GET (multi-call: fans out over every device) | (delegates to `get_devices` + `get_device_settings` per device) | — | — | (none) | list | never raises for missing per-device alarms — `if device_alarms is not None: alarms += device_alarms` | Calls `get_devices()` once, then `get_device_settings(device["deviceId"])` **once per device**; concatenates each device's `alarms` list. N+1 call pattern — port faithfully (parallelizing would be a behavioral change from upstream, worth flagging if done). |
| get_device_last_used | getDeviceLastUsed | GET | `/device-service/deviceservice/mylastused` | — | — | (none) | dict | passes through unchecked | |

## activities

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| count_activities | countActivities | GET | `/activitylist-service/activities/count` | — | — | (none) | int | raises `GarminConnectConnectionError("No activities count data received")` if response falsy or missing `"totalCount"` | Returns `activities_count["totalCount"]`, not the envelope. |
| get_activities | getActivities | GET | `/activitylist-service/activities/search/activities` | `start, limit, activityType?, activitySubType?` (subtype only sent if `activitytype` truthy) | — | `start: int = 0, limit: int = 20, activitytype: str \| None = None, activitysubtype: str \| None = None` | dict \| list | returns `[]` and logs a warning if `activities is None` | `limit` capped at `MAX_ACTIVITY_LIMIT = 1000`, raises `ValueError` above that. |
| get_activities_fordate | getActivitiesForDate | GET | `/mobile-gateway/heartRate/forDate/{fordate}` | — | — | `fordate: str` | dict | passes through unchecked | Constant is `garmin_connect_activity_fordate`. |
| set_activity_name | setActivityName | PUT | `/activity-service/activity/{activity_id}` | — | `activityId, activityName=title` | `activity_id: str, title: str` | Any (raw client response) | UNCERTAIN — no explicit null handling, returns raw response | |
| set_activity_type | setActivityType | PUT | `/activity-service/activity/{activity_id}` | — | `activityId, activityTypeDTO: {typeId, typeKey, parentTypeId}` | `activity_id: str, type_id: int, type_key: str, parent_type_id: int` | Any (raw client response) | UNCERTAIN — no explicit null handling | |
| set_activity_description | setActivityDescription | PUT | `/activity-service/activity/{activity_id}` | — | `activityId, description` | `activity_id: str, description: str` | Any (raw client response) | UNCERTAIN — no explicit null handling | |
| create_manual_activity_from_json | createManualActivityFromJson | POST | `/activity-service/activity` | — | caller-supplied full `payload` dict, passed through verbatim | `payload: dict[str, Any]` | Any (raw client response) | UNCERTAIN — no explicit null handling | Low-level entry point used by `create_manual_activity`. |
| create_manual_activity | createManualActivity | POST (delegates to `create_manual_activity_from_json`) | `/activity-service/activity` | — | `activityTypeDTO: {typeKey}`, `accessControlRuleDTO: {typeId: 2, typeKey: "private"}`, `timeZoneUnitDTO: {unitKey: time_zone}`, `activityName`, `metadataDTO: {autoCalcCalories: true}`, `summaryDTO: {startTimeLocal, distance, duration}` | `start_datetime: str, time_zone: str, type_key: str, distance_km: float, duration_min: int, activity_name: str` | Any (raw client response) | inherits `create_manual_activity_from_json`'s behaviour | **Unit conversions happen here and must be replicated exactly**: `distance = distance_km * 1000` (→ meters) and `duration = duration_min * 60` (→ seconds) are computed in Python before being placed in the body — the input args are km/minutes, the wire body is meters/seconds. `type_key` is the Garmin activity type key **without** the `activity_type_` prefix (e.g. `"resort_skiing"`). |
| get_last_activity | getLastActivity | GET (delegates to `get_activities(0, 1)`) | — | — | — | (none) | dict \| None | returns `None` if no activities found in either the list or `activityList`-keyed-dict response shapes | Handles two possible response shapes from `get_activities`: a bare list (`activities[-1]`) or a dict with `"activityList"` key. |
| upload_activity | uploadActivity | POST (multipart) | `/upload-service/upload` | — | multipart file upload (`files={"file": (name, handle)}`) | `activity_path: str` | Any (raw client response) | UNCERTAIN — no explicit null handling | Validates file exists/is a file/has an extension matching `ActivityUploadFormat` (`FIT`, `GPX`, `TCX` — case-insensitive against the extension) before uploading; raises `FileNotFoundError`/`ValueError`/`GarminConnectInvalidFileFormatError` on bad input, `GarminConnectConnectionError` wrapping any `OSError` while reading the file. |
| import_activity | importActivity | POST (multipart, distinct endpoint + headers from `upload_activity`) | `/upload-service/upload/{file_extension}` (extension lower-cased) | — | multipart file upload with `content-type: application/octet-stream` | `activity_path: str` | dict | if the client response has no `.json` attribute, returns `{"status": "uploaded", "fileName": file_base_name}` instead of raising | Same file validation as `upload_activity`, plus **custom headers** required to make Garmin treat this as an import rather than a device sync: `{"NK": "NT", "origin": "https://sso.garmin.com", "User-Agent": "GCM-iOS-5.7.2.1"}` — these are load-bearing and must be reproduced exactly. On HTTP 409, re-raises as `GarminConnectConnectionError("Activity already exists (duplicate): {file_base_name}")`. Other `HTTPError`/`GarminConnectConnectionError` wrapped as `GarminConnectConnectionError(f"Import error: {e}")`; `OSError` while reading wrapped similarly. |
| delete_activity | deleteActivity | DELETE | `/activity-service/activity/{activity_id}` | — | — | `activity_id: str` | Any (raw client response) | UNCERTAIN — no explicit null handling | Constant used is `garmin_connect_delete_activity_url`, which happens to equal `garmin_connect_activity` (`/activity-service/activity`) — same literal value, two attribute names. |
| get_activities_by_date | getActivitiesByDate | GET (paginated, multi-call) | `/activitylist-service/activities/search/activities` | `startDate, start, limit=20, endDate?, activityType?, sortOrder?` | — | `startdate: str, enddate: str \| None = None, activitytype: str \| None = None, sortorder: str \| None = None` | list | loop breaks (stops paginating) on the first falsy/empty page; raises `GarminConnectConnectionError(f"Pagination exceeded {MAX_PAGINATED_REQUESTS} requests; aborting")` if `MAX_PAGINATED_REQUESTS = 2000` pages are exhausted without an empty page | **Pagination**: fetches in fixed pages of `limit=20`, incrementing `start` by 20 each call, until an empty page or the 2000-page safety cap. `sortorder` unvalidated pass-through (Garmin default is descending by `startLocal`; pass `"asc"` for ascending). |
| get_progress_summary_between_dates | getProgressSummaryBetweenDates | GET | `/fitnessstats-service/activity` | `startDate, endDate, aggregation="lifetime", groupByParentActivityType=str(groupbyactivities), metric` | — | `startdate: str, enddate: str, metric: str = "distance", groupbyactivities: bool = True` | dict | passes through unchecked | `metric` accepts `"elevationGain"`, `"duration"`, `"distance"`, `"movingDuration"` (not validated in code — caller's responsibility). Constant is `garmin_connect_fitnessstats`. |
| get_activity_types | getActivityTypes | GET | `/activity-service/activity/activityTypes` | — | — | (none) | dict | passes through unchecked | |
| download_activity | downloadActivity | GET (binary download; 5 URL branches by `dl_fmt`) | `ORIGINAL`: `/download-service/files/activity/{activity_id}`; `TCX`: `/download-service/export/tcx/activity/{activity_id}`; `GPX`: `/download-service/export/gpx/activity/{activity_id}`; `KML`: `/download-service/export/kml/activity/{activity_id}`; `CSV`: `/download-service/export/csv/activity/{activity_id}` | — | — | `activity_id: str, dl_fmt: ActivityDownloadFormat = ActivityDownloadFormat.TCX` | bytes | UNCERTAIN — routed through `self.download(url)` → `client.download`; no null-handling visible in this method | **Record all 5 branches** — a partial port (e.g. only TCX/GPX) silently breaks CSV/KML/ORIGINAL. `ORIGINAL` returns raw zip bytes (caller must extract); `CSV` returns the splits CSV. Invalid `dl_fmt` raises `ValueError`. |
| download_health_snapshot | downloadHealthSnapshot | GET (binary download) | `/download-service/files/wellness/{requested_date}` | — | — | `requested_date: str` | bytes | UNCERTAIN — same as above, routed through `self.download` | Returns a ZIP file. |
| get_activity_splits | getActivitySplits | GET | `/activity-service/activity/{activity_id}/splits` | — | — | `activity_id: str` | dict | passes through unchecked | |
| get_activity_typed_splits | getActivityTypedSplits | GET | `/activity-service/activity/{activity_id}/typedsplits` | — | — | `activity_id: str` | dict | passes through unchecked | Contains more detail than `get_activity_splits` for certain activity types (e.g. Bouldering). |
| get_activity_split_summaries | getActivitySplitSummaries | GET | `/activity-service/activity/{activity_id}/split_summaries` | — | — | `activity_id: str` | dict | passes through unchecked | |
| get_activity_weather | getActivityWeather | GET | `/activity-service/activity/{activity_id}/weather` | — | — | `activity_id: str` | dict | passes through unchecked | |
| get_activity_hr_in_timezones | getActivityHrInTimezones | GET | `/activity-service/activity/{activity_id}/hrTimeInZones` | — | — | `activity_id: str` | dict | passes through unchecked | |
| get_activity_power_in_timezones | getActivityPowerInTimezones | GET | `/activity-service/activity/{activity_id}/powerTimeInZones` | — | — | `activity_id: str` | dict | passes through unchecked | |
| get_activity | getActivity | GET | `/activity-service/activity/{activity_id}` | — | — | `activity_id: str` | dict | passes through unchecked | Activity summary including basic splits. |
| get_activity_details | getActivityDetails | GET | `/activity-service/activity/{activity_id}/details` | `maxChartSize=str(maxchart)`, `maxPolylineSize=str(maxpoly)` | — | `activity_id: str, maxchart: int = 2000, maxpoly: int = 4000` | dict | passes through unchecked | `maxchart` validated positive; `maxpoly` validated non-negative (allows 0). |
| get_activity_exercise_sets | getActivityExerciseSets | GET | `/activity-service/activity/{activity_id}/exerciseSets` | — | — | `activity_id: int \| str` | dict | passes through unchecked | |
| set_activity_exercise_sets | setActivityExerciseSets | PUT | `/activity-service/activity/{activity_id}/exerciseSets` | — | caller-supplied `payload` (same shape as `get_activity_exercise_sets`'s response), sent as-is | `activity_id: int \| str, payload: dict[str, Any]` | Any (raw client response) | UNCERTAIN — no explicit null handling | **Replace-all semantics** — the existing `exerciseSets` array is fully overwritten, not merged. Garmin validates `exercises[].category`/`exercises[].name` against its FIT enum server-side (400 "Invalid Sub-Category Passed" on unknown values); `name=None` is always accepted under a known `category`. |
| get_personal_record | getPersonalRecord | GET | `/personalrecord-service/personalrecord/prs/{displayName}` | — | — | (none) | dict | passes through unchecked | For `activityType == "running"`, `typeId` maps: 1=1km, 2=1mile, 3=5km, 4=10km, 5=half marathon, 6=marathon, 7=longest run (distance in meters; duration requires a separate `activity-service/activity/{activityId}` call, i.e. `get_activity`). |

## gear

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| get_gear | getGear | GET | `/gear-service/gear/filterGear` | `userProfilePk` | — | `userProfileNumber: str` | dict | passes through unchecked | |
| create_gear | createGear | POST | `/gear-service/gear/v2` | — | `uuid: null, gearType, brand, model, name, firstUseDate, maxUsageDate: null, maxUsageDistanceMeters, maxUsageDurationSeconds, usageType, notes, associatedActivityTypes: [{activityTypeKey, defaultGear: true, preferredGear: false}, ...]` | `gear_type: str, brand: str, model: str, name: str, first_use_date: str, usage_type: str = "DISTANCE", max_usage_distance_km: float \| None = None, max_usage_duration_min: float \| None = None, notes: str = "", activity_type_keys: list[str] \| None = None` | Any (raw client response) | UNCERTAIN — no explicit null handling | **Conversions happen here and must be replicated exactly (opposite direction from the weigh-in bug — these conversions ARE expected):** `max_usage_distance_km` → `maxUsageDistanceMeters = round(km * 1000)`, must be ≥1 or raises `ValueError`; `max_usage_duration_min` → `maxUsageDurationSeconds = round(min * 60)`, must be ≥1 or raises `ValueError`. `gear_type`/`usage_type` normalized via `_validate_sport_key` (upper-cased). Only `gear_type="SHOES"`/`usage_type="DISTANCE"` are confirmed against a real account per the docstring — other values are unverified guesses at Garmin's SCREAMING_SNAKE_CASE convention. `activity_type_keys` entries are lowercase (matching `get_activities`' `activitytype`), **not** the uppercase convention `set_gear_default`'s `activityType` uses — a subtle asymmetry worth flagging to the TS implementer. |
| get_gear_stats | getGearStats | GET | `/gear-service/gear/stats/{gearUUID}` | — | — | `gearUUID: str` | dict | catches `GarminConnectConnectionError`; if the underlying status is 404, returns `{}` (does not raise); other errors re-raised | `gearUUID` validated via `_validate_uuid` (hex, hyphens optional). |
| get_gear_defaults | getGearDefaults | GET | `/gear-service/gear/user/{userProfileNumber}/activityTypes` | — | — | `userProfileNumber: str` | dict | passes through unchecked | |
| set_gear_default | setGearDefault | PUT or DELETE (method chosen dynamically) | `defaultGear=True`: `/gear-service/gear/{gearUUID}/activityType/{activityType}/default/true` (PUT). `defaultGear=False`: `/gear-service/gear/{gearUUID}/activityType/{activityType}` (DELETE) | — | — | `activityType: str, gearUUID: str, defaultGear: bool = True` | Any (raw client response) | catches `GarminConnectConnectionError`; on 404 re-raises as `GarminConnectConnectionError(f"Cannot set gear default for UUID {gearUUID}: gear not found (likely retired/removed)")`; other errors re-raised as-is | `activityType` normalized upper via `_validate_sport_key` — uppercase convention, contrast with `create_gear`'s lowercase `activity_type_keys`. HTTP verb itself is conditional on `defaultGear`, not fixed. |
| get_activity_gear | getActivityGear | GET | `/gear-service/gear/filterGear` | `activityId` | — | `activity_id: int \| str` | dict | passes through unchecked | Reuses the same base URL as `get_gear` (`garmin_connect_gear`) but with an `activityId` param instead of `userProfilePk`. |
| get_gear_activities | getGearActivities | GET | `/activitylist-service/activities/{gearUUID}/gear` | `start=0, limit` | — | `gearUUID: str, limit: int = 1000` | list | catches `GarminConnectConnectionError`; on 404 logs a warning and returns `[]`; other errors re-raised | `limit` clamped to `min(limit, MAX_ACTIVITY_LIMIT=1000)` after validating positive. Base is `garmin_connect_activities_baseurl` = `/activitylist-service/activities/` (note trailing slash baked into the constant) + `{gearUUID}/gear`. |
| add_gear_to_activity | addGearToActivity | PUT | `/gear-service/gear/link/{gearUUID}/activity/{activity_id}` | — | — | `gearUUID: str, activity_id: int \| str` | dict (`.json()`) | catches `GarminConnectConnectionError`; on 404 re-raises as `GarminConnectConnectionError(f"Cannot add gear {gearUUID} to activity {activity_id}: gear not found (likely retired/removed)")`; other errors re-raised | |
| remove_gear_from_activity | removeGearFromActivity | PUT | `/gear-service/gear/unlink/{gearUUID}/activity/{activity_id}` | — | — | `gearUUID: str, activity_id: int \| str` | dict (`.json()`) | same 404-handling pattern as `add_gear_to_activity` (message says "Cannot remove gear ... from activity") | Note: unlinking is also a **PUT**, not a DELETE. |

## workouts

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| get_workouts | getWorkouts | GET | `/workout-service/workouts` | `start, limit` (ints, not stringified — contrast with most other paginated methods which stringify) | — | `start: int = 0, limit: int = 100` | list | passes through unchecked | |
| get_workout_by_id | getWorkoutById | GET | `/workout-service/workout/{workout_id}` | — | — | `workout_id: int \| str` | dict | passes through unchecked | |
| delete_workout | deleteWorkout | DELETE | `/workout-service/workout/{workout_id}` | — | — | `workout_id: int \| str` | Any (raw client response) | UNCERTAIN — no explicit null handling | Deletes the template from the workout library. |
| download_workout | downloadWorkout | GET (binary download) | `/workout-service/workout/FIT/{workout_id}` | — | — | `workout_id: int \| str` | bytes | UNCERTAIN — routed through `self.download(url)` | |
| upload_workout | uploadWorkout | POST | `/workout-service/workout` | — | caller-supplied JSON (`dict`, `list`, or JSON string parsed via `json.loads`) | `workout_json: dict[str, Any] \| list[Any] \| str` | dict | UNCERTAIN — no explicit null handling beyond input validation | `workout_json` string input is JSON-parsed (`ValueError` on invalid JSON); result must be `dict` or `list`, else `ValueError`. |
| update_workout | updateWorkout | PUT | `/workout-service/workout/{workout_id}` | — | caller-supplied JSON merged with `{"workoutId": workout_id}` (forced to match the path id) | `workout_id: int \| str, workout_json: dict[str, Any] \| str` | dict | UNCERTAIN — no explicit null handling | Full-replace semantics (Garmin's endpoint replaces the whole workout via PUT) — `workout_json` must be the complete structure. `workout_json` as a string is JSON-parsed; must resolve to a `dict` (not `list`, unlike `upload_workout`) or raises `ValueError`. |
| upload_running_workout | uploadRunningWorkout | POST (delegates to `upload_workout`) | `/workout-service/workout` | — | `workout.to_dict()` from a `RunningWorkout` pydantic model | `workout: Any` (expected `RunningWorkout`) | dict | inherits `upload_workout`'s behaviour | Requires optional `pydantic` extra (`garminconnect[workout]`); raises `ImportError` with an install hint if missing, `TypeError` if `workout` isn't a `RunningWorkout` instance. Lazy-imports `from .workout import RunningWorkout` inside the method. |
| upload_cycling_workout | uploadCyclingWorkout | POST (delegates to `upload_workout`) | `/workout-service/workout` | — | `workout.to_dict()` from `CyclingWorkout` | `workout: Any` | dict | same as above | Same pydantic-optional / `ImportError`/`TypeError` pattern. |
| upload_swimming_workout | uploadSwimmingWorkout | POST (delegates to `upload_workout`) | `/workout-service/workout` | — | `workout.to_dict()` from `SwimmingWorkout` | `workout: Any` | dict | same as above | Same pattern. |
| upload_walking_workout | uploadWalkingWorkout | POST (delegates to `upload_workout`) | `/workout-service/workout` | — | `workout.to_dict()` from `WalkingWorkout` | `workout: Any` | dict | same as above | Same pattern. |
| upload_hiking_workout | uploadHikingWorkout | POST (delegates to `upload_workout`) | `/workout-service/workout` | — | `workout.to_dict()` from `HikingWorkout` | `workout: Any` | dict | same as above | Same pattern. |
| upload_strength_workout | uploadStrengthWorkout | POST (delegates to `upload_workout`) | `/workout-service/workout` | — | `workout.to_dict()` from `StrengthWorkout` | `workout: Any` | dict | same as above | Same pattern. |
| push_workout_to_device | pushWorkoutToDevice | POST (multi-call) | `/device-service/devicemessage/messages` | — | JSON **array** with one element: `{deviceId, messageUrl: "workout-service/workout/FIT/{workout_id}", messageType: "workouts", groupName: null, messageName, priority: 1, fileType: "FIT", metaDataId: workout_id}` | `workout_id: int \| str \| None = None, device_id: int \| str \| None = None` | dict | UNCERTAIN — no explicit null handling on the final POST | Multi-step: if `device_id` omitted, calls `get_device_last_used()["userDeviceId"]`; if `workout_id` omitted, calls `get_workouts(start=0, limit=1)` and uses the first result's `workoutId` (raises `ValueError("No workouts found to push.")` if none); then calls `get_workout_by_id(workout_id)["workoutName"]` for the message name. Note `messageUrl` embeds a **relative** path `workout-service/workout/FIT/{id}` (no leading slash) as a literal string, not built from `self.garmin_workouts`. |
| get_scheduled_workouts | getScheduledWorkouts | GET | `/calendar-service/year/{year}/month/{month - 1}` | — | — | `year: int \| str, month: int \| str` | dict | passes through unchecked | **Month is 0-indexed on the wire**: Python takes a normal 1-12 `month` and subtracts 1 before building the URL. `year` must be ≥2000; `month` must be 1-12; both validated as positive integers first. Constant `garmin_scheduled_workouts_url` = `garmin_calendar` = `/calendar-service`. |
| get_scheduled_workout_by_id | getScheduledWorkoutById | GET | `/workout-service/schedule/{scheduled_workout_id}` | — | — | `scheduled_workout_id: int \| str` | dict | passes through unchecked | Uses `garmin_workouts_schedule_url` = `f"{garmin_workouts}/schedule"` = `/workout-service/schedule` — a **different** base than `get_scheduled_workouts` (which uses `/calendar-service`), despite both being about "scheduled workouts". |
| get_next_scheduled_workout | getNextScheduledWorkout | GET (multi-call, computed) | (delegates to `get_scheduled_workouts` twice: current month and next month) | — | — | (none) | dict | returns `{}` if no matching item found (never raises) | Calls `get_scheduled_workouts` for `today`'s month and the following month (handles year rollover at December→January), treating a `None`/falsy result from either as `{}`. Merges `calendarItems` from both, filters to `itemType == "workout"` with `date >= today`, sorts by date, returns the first (or `{}`). Docstring notes: Garmin's calendar-service only shows workouts already committed to the visible calendar — Coach/adaptive-plan upcoming sessions are not visible via this endpoint. |
| schedule_workout | scheduleWorkout | POST | `/workout-service/schedule/{workout_id}` | — | `date: date_str` | `workout_id: int \| str, date_str: str` | dict | UNCERTAIN — no explicit null handling | `date_str` validated via `_validate_date_format`. |
| unschedule_workout | unscheduleWorkout | DELETE | `/workout-service/schedule/{scheduled_workout_id}` | — | — | `scheduled_workout_id: int \| str` | Any (raw client response) | UNCERTAIN — no explicit null handling | Removes the calendar entry without deleting the underlying workout template. |

## badges

Covers badges, challenges, and adhoc challenges.

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| get_earned_badges | getEarnedBadges | GET | `/badge-service/badge/earned` | — | — | (none) | list | passes through unchecked | |
| get_available_badges | getAvailableBadges | GET | `/badge-service/badge/available` | `showExclusiveBadge="true"` | — | (none) | list | passes through unchecked | |
| get_in_progress_badges | getInProgressBadges | GET (delegates: 2 calls, computed client-side, no direct HTTP path of its own) | — | — | — | (none) | list | never raises; filters based on truthy `badgeProgressValue` fields, tolerant of missing keys via `.get()` | Calls `get_earned_badges()` and `get_available_badges()`, applies an `is_badge_in_progress` predicate to each (progress must be non-zero; if `progress == target`, only "in progress" when `badgeLimitCount` is set and `badgeEarnedNumber < badgeLimitCount`), then merges both filtered lists keyed by `badgeId` (available overwrites earned on key collision) and returns the combined values. |
| get_adhoc_challenges | getAdhocChallenges | GET | `/adhocchallenge-service/adHocChallenge/historical` | `start, limit` (stringified) | — | `start: int, limit: int` | dict | passes through unchecked | `start` validated non-negative, `limit` positive. |
| get_badge_challenges | getBadgeChallenges | GET | `/badgechallenge-service/badgeChallenge/completed` | `start, limit` (stringified) | — | `start: int, limit: int` | dict | passes through unchecked | |
| get_available_badge_challenges | getAvailableBadgeChallenges | GET | `/badgechallenge-service/badgeChallenge/available` | `start, limit` (stringified) | — | `start: int, limit: int` | dict | passes through unchecked | |
| get_non_completed_badge_challenges | getNonCompletedBadgeChallenges | GET | `/badgechallenge-service/badgeChallenge/non-completed` | `start, limit` (stringified) | — | `start: int, limit: int` | dict | passes through unchecked | |
| get_inprogress_virtual_challenges | getInprogressVirtualChallenges | GET | `/badgechallenge-service/virtualChallenge/inProgress` | `start, limit` (stringified) | — | `start: int, limit: int` | dict | passes through unchecked | **Note asymmetry**: unlike the other 4 challenge-listing methods above (which validate `start` as non-negative), this one validates `start` as **positive** (`_validate_positive_integer`, rejecting `start=0`) — an easy detail to miss when porting a "generic pagination" helper. |

## goals

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| get_goals | getGoals | GET (paginated, multi-call) | `/goal-service/goal/goals` | `status, start, limit, sortOrder="asc"` (stringified where noted) | — | `status: str = "active", start: int = 0, limit: int = 30` | list | loop breaks on the first falsy/empty page; raises `GarminConnectConnectionError(f"Pagination exceeded {MAX_PAGINATED_REQUESTS} requests; aborting")` if the 2000-page cap is hit | `status` must be one of `{"active", "future", "past"}` or raises `ValueError`. **Sends a required custom header** `{"Sec-Fetch-Site": "same-origin"}` on every request — without it, `goal-service` silently returns `[]` for newer custom accumulation-goal types (upstream references issue #431); this header is load-bearing and easy to drop in a port. Same fixed-page-size pagination pattern as `get_activities_by_date`. |

## womensHealth

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| get_menstrual_data_for_date | getMenstrualDataForDate | GET | `/periodichealth-service/menstrualcycle/dayview/{fordate}` | — | — | `fordate: str` | dict | passes through unchecked | |
| get_menstrual_calendar_data | getMenstrualCalendarData | GET | `/periodichealth-service/menstrualcycle/calendar/{startdate}/{enddate}` | — | — | `startdate: str, enddate: str` | dict | passes through unchecked | Docstring: Garmin rejects windows of 92+ inclusive days; keep the range ≤90 days. Not enforced in code — caller's responsibility. |
| get_menstrual_last_confirmed | getMenstrualLastConfirmed | GET | `/periodichealth-service/menstrualcycle/lastconfirmed/{fordate}` | — | — | `fordate: str` | dict | passes through unchecked | |
| get_menstrual_cycle_summary | getMenstrualCycleSummary | GET | `/periodichealth-service/menstrualcycle/summary/{fordate}` | — | — | `fordate: str` | dict | passes through unchecked | |
| get_menstrual_reports | getMenstrualReports | GET | `/periodichealth-service/reports/menstrualcycle/{number_of_cycles}/{fordate}` | `next` (lowercased bool string), `reportType` (stripped), `todayCalendarDate` | — | `fordate: str, number_of_cycles: int = 6, *, next_report: bool = False, report_type: str = "CYCLE", today_calendar_date: str \| None = None` | dict | passes through unchecked | `number_of_cycles` restricted to `{1, 6, 12}` (`VALID_MENSTRUAL_REPORT_CYCLES`) — any other int raises `ValueError`. `today_calendar_date` defaults to today, validated as a date. |
| get_pregnancy_summary | getPregnancySummary | GET | `/periodichealth-service/menstrualcycle/pregnancysnapshot` | — | — | (none) | dict | passes through unchecked | |
| update_menstrual_daily_log | updateMenstrualDailyLog | POST | `/periodichealth-service/menstrualcycle/dailylog/{calendar_date}` | — | `calendarDate, symptoms, moods, flow, discharge, sexDrive, sexualActivity, notes, ovulationDay, reportTimestamp` (+ `userProfilePk` if `self.profile_id` set); then passed through `_clean_menstrual_daily_log` which drops any `None`-valued key and any empty-`len()` collection except `notes` | `calendar_date: str, *, symptoms: list[str] \| None = None, moods: list[str] \| None = None, flow: str \| None = None, discharge: list[str] \| None = None, sex_drive: str \| None = None, sexual_activity: str \| None = None, notes: str \| None = None, ovulation_day: bool \| None = None` | dict | UNCERTAIN — no explicit null handling on the response | **This is a full-day replace, not a field-level merge** — omitted lists/scalars are cleared server-side. At least one field must be non-`None`, or raises `ValueError` (guards against an accidental full-day wipe). `notes=None` preserves the existing note; `notes=""` clears it — a semantic distinction between "omitted" and "empty string" that must be preserved in the TS signature (e.g. `undefined` vs `""`, not defaulting both to the same thing). Enum fields validated/normalized (uppercased) against fixed sets (`VALID_MENSTRUAL_SYMPTOMS`, `_MOODS`, `_FLOW`, `_DISCHARGE`, `_SEX_DRIVE`, `_SEXUAL_ACTIVITY`); `discharge` additionally rejects combining `"NO_DISCHARGE"` with any other value. `ovulationDay` always sent, defaulting to `false` if `None`. Timestamp uses `_fmt_ts_utc()` (UTC), unlike weight/blood-pressure/hydration writes which use local `_fmt_ts()`. |
| update_menstrual_calendar | updateMenstrualCalendar | POST | `/periodichealth-service/menstrualcycle/calendarupdates` | — | `todayCalendarDate, startDate, endDate, reportTimestamp, cycleDatesLists, futureEditsByFE: true` (+ `userProfilePk` if set) | `startdate: str, enddate: str, cycle_dates_lists: list[list[str]], *, today_calendar_date: str \| None = None` | dict | UNCERTAIN — no explicit null handling | **This is also a full replace, not a merge** — omitted previously-confirmed days within the range are removed server-side. `cycle_dates_lists` is validated: each inner list must be non-empty and consist of **consecutive** calendar dates; every date in every group must fall within `[startdate, enddate]`, else `ValueError`. Predicted (unconfirmed) cycles should not be posted here per the docstring. Uses UTC `_fmt_ts_utc()` for `reportTimestamp`. |
| init_menstrual_cycle_setup | initMenstrualCycleSetup | POST | `/periodichealth-service/menstrualcycle/initCycleSetup` | — | `periodStartDate, periodLength, cycleLength, reportTimestamp` (+ `userProfilePk` if set) | `period_start_date: str, period_length: int, cycle_length: int` | dict | UNCERTAIN — no explicit null handling | Docstring warns Garmin's first-run wizard also PUTs user menstrual settings in the same save — this method does **not** do that; call `update_menstrual_settings` separately if those tracking flags need to change. Not intended for editing an already-configured account. |
| confirm_menstrual_period_start | confirmMenstrualPeriodStart | POST | `/periodichealth-service/menstrualcycle/{period_start_date}` | — | `periodStartDate, periodLength, cycleLength, predictedCycle, hasSpecifiedCycleLength: true, hasSpecifiedPeriodLength: true, reportTimestamp` (+ `userProfilePk` if set) | `period_start_date: str, period_length: int, cycle_length: int, *, predicted_cycle: bool = False` | dict | UNCERTAIN — no explicit null handling | Can convert a predicted cycle into a confirmed period (`predicted_cycle=True`). Path base is `garmin_connect_menstrual_cycle_url` = `/periodichealth-service/menstrualcycle` (**not** the `_dayview`/`_calendar`/etc. variants used elsewhere — easy to mix up). |
| update_menstrual_settings | updateMenstrualSettings | PUT (with a preceding GET) | GET: `/userprofile-service/userprofile/user-settings` (via `get_user_profile()`). PUT: `/userprofile-service/userprofile/user-settings` | — | `userMenstrualCycleSettings: {...current merged with settings...}` (+ `id: user_settings_id` if resolved) | `settings: dict[str, Any], *, user_settings_id: int \| None = None` | dict | UNCERTAIN — no explicit null handling on the PUT response | `settings` must be a non-empty dict or raises `ValueError`. **Multi-step**: first calls `get_user_profile()` to read the current `userMenstrualCycleSettings` (used as an overlay base — caller's `settings` keys win, omitted keys preserved) and, if `user_settings_id` not explicitly passed, tries to pull `profile["id"]` (only if it's a non-bool `int`) to include as `id` in the PUT body. Pregnancy-only fields are explicitly out of scope per the docstring. |

## userProfile

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| get_full_name | getFullName | (no HTTP call — reads cached state) | — | — | — | (none) | `str \| None` | returns `self.full_name` directly, which is `None` until a successful login/profile load populates it | Purely an in-memory accessor; populated during `login()`/`resume_login()` via `_load_profile_and_settings`/`_load_social_profile` (not itself in scope — those are excluded plumbing/underscore methods). |
| get_unit_system | getUnitSystem | (no HTTP call — reads cached state) | — | — | — | (none) | `str \| None` | returns `self.unit_system` directly, `None` until populated by login | Same caching pattern as `get_full_name`. |
| get_user_profile | getUserProfile | GET | `/userprofile-service/userprofile/user-settings` | — | — | (none) | dict | passes through unchecked | Docstring: "Get all users settings." Note this shares its endpoint with the GET half of `update_menstrual_settings`. |
| get_userprofile_settings | getUserprofileSettings | GET | `/userprofile-service/userprofile/settings` | — | — | (none) | dict | passes through unchecked | Distinct from `get_user_profile` — note the singular `settings` path vs. `user-settings`; easy to transpose. |

## golf

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| get_golf_summary | getGolfSummary | GET | `/gcs-golfcommunity/api/v2/scorecard/summary` | `per-page=str(limit)`, `start=str(start)` | — | `start: int = 0, limit: int = 100` | list | passes through unchecked | Note param name is literally `"per-page"` (hyphenated), not `perPage`. |
| get_golf_scorecard | getGolfScorecard | GET | `/gcs-golfcommunity/api/v2/scorecard/detail` | `scorecard-ids=str(scorecard_id)`, `include-longest-shot-distance="true"` | — | `scorecard_id: int \| str` | dict | passes through unchecked | Hyphenated param names again: `scorecard-ids`, `include-longest-shot-distance`. |
| get_golf_shot_data | getGolfShotData | GET | `/gcs-golfcommunity/api/v2/shot/scorecard/{scorecard_id}/hole` | raw query string `"hole-numbers={value}"` (passed as the `params` kwarg directly as a string, not a dict) if `hole_numbers` given and no hole > 9; `None`/omitted otherwise (fetches all 18) | — | `scorecard_id: int \| str, hole_numbers: str \| None = None` | dict | passes through unchecked | `hole_numbers` validated/normalized via `_validate_hole_numbers` (commas or hyphens accepted as input, spaces stripped) then commas replaced with `-` before sending (`Garmin's API only accepts '-'`). **Special case**: if any requested hole number is >9 (10-18), the filter is silently dropped and *all 18 holes* are requested instead, because Garmin's endpoint drops double-digit hole numbers from filtered queries — logs a warning when this happens. Passing `params` as a raw pre-formatted string (not a dict) to `connectapi` is itself notable — verify the TS HTTP client supports a literal query string this way, or reformat as a dict with key `"hole-numbers"`. |
| get_golf_club_stats | getGolfClubStats | GET | `/gcs-golfcommunity/api/v2/club/player` | `per-page=str(limit)`, `include-stats="true"` | — | `limit: int = 1000` | dict | passes through unchecked | |
| get_golf_user_stats | getGolfUserStats | GET | `/gcs-golfcommunity/api/v2/player/stats` | — | — | (none) | dict | passes through unchecked | Handicap and strokes-gained overview. |

## nutrition

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| get_nutrition_daily_food_log | getNutritionDailyFoodLog | GET | `/nutrition-service/food/logs/{cdate}` | — | — | `cdate: str` | dict | passes through unchecked | |
| get_nutrition_daily_meals | getNutritionDailyMeals | GET | `/nutrition-service/meals/{cdate}` | — | — | `cdate: str` | dict | passes through unchecked | |
| get_nutrition_daily_settings | getNutritionDailySettings | GET | `/nutrition-service/settings/{cdate}` | — | — | `cdate: str` | dict | passes through unchecked | |

## trainingPlans

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| get_training_plans | getTrainingPlans | GET | `/trainingplan-service/trainingplan/plans` | — | — | (none) | dict | passes through unchecked | |
| get_training_plan_by_id | getTrainingPlanById | GET | `/trainingplan-service/trainingplan/phased/{plan_id}` | — | — | `plan_id: int \| str` | dict | passes through unchecked | |
| get_adaptive_training_plan_by_id | getAdaptiveTrainingPlanById | GET | `/trainingplan-service/trainingplan/fbt-adaptive/{plan_id}` | — | — | `plan_id: int \| str` | dict | passes through unchecked | Note distinct sub-path (`fbt-adaptive`) from the phased-plan endpoint. |

## misc

| python_name | ts_name | verb | path | params | body | args | returns | null_behaviour | notes |
|---|---|---|---|---|---|---|---|---|---|
| get_lifestyle_logging_data | getLifestyleLoggingData | GET | `/lifestylelogging-service/dailyLog/{cdate}` | — | — | `cdate: str` | dict | passes through unchecked | Grouped here per the task's explicit instruction (lifestyle logging → misc) even though it superficially resembles a wellness-daily endpoint. |
| request_reload | requestReload | POST | `/wellness-service/wellness/epoch/request/{cdate}` | — | (no JSON body — `client.post` called without a `json=` kwarg) | `cdate: str` | dict | UNCERTAIN — no explicit null handling | Requests Garmin reload/recompute data for a date (needed because Garmin offloads older data). Constant is `garmin_request_reload_url`. |
| query_garmin_graphql | queryGarminGraphql | POST | `graphql-gateway/graphql` (note: **no leading slash** in this constant, unlike every other endpoint constant in the file — verify how the TS HTTP client's base-URL joining handles a relative vs. absolute path here) | — | caller-supplied GraphQL request body verbatim, e.g. `{"query": "...", "variables": {...}}` | `query: dict[str, Any]` | dict (`.json()`) | UNCERTAIN — no explicit null handling, calls `.json()` on the response directly | Pure passthrough to Garmin's GraphQL gateway; only used for logging (`operationName`, sorted `variables` keys) before the call. |
| logout | logout | (no HTTP call) | — | — | — | `tokenstore: str \| None = None` | `None` | N/A — not an API call; clears local state only | Clears in-memory auth fields (`username`, `password`, `display_name`, `full_name`, `unit_system`, `profile_id`) and calls `self.client._clear_auth_state()`. Optionally deletes the on-disk token file: resolves `tokenstore` from the arg or `GARMINTOKENS` env var, skips deletion if the value "looks like JSON" (inline token string) via `_looks_like_json`, otherwise resolves the path via `client.token_file_path(tokenstore)` and unlinks it, swallowing `FileNotFoundError` and logging (not raising) on `ValueError` from an unsafe path. Does **not** revoke the token server-side — local-only. |

---

## Methods deliberately excluded

Per the task instructions, the following plumbing/infrastructure methods on `Garmin`
were **not** inventoried as ported service methods (they're either internal
transport primitives that every service method routes through, or auth/session
lifecycle calls that don't map onto a single REST resource):

- **`typed`** — a `functools.cached_property` returning a `TypedGarmin` wrapper
  (Pydantic-typed façade over selected endpoints); not itself an endpoint call.
- **`connectapi`** — the generic authenticated-GET/request wrapper every read
  method above calls internally; porting it is an HTTP-client-layer concern, not a
  per-service-method concern.
- **`connectwebproxy`** — a parallel generic wrapper for the `connect` (web proxy)
  host instead of the API host; not used by any of the 154 methods observed above
  (`UNCERTAIN: no call site for connectwebproxy was found in this pass — it may be
  dead code or used only by external callers of the library.`), and is infrastructure
  either way.
- **`download`** — the generic binary-download wrapper used internally by
  `download_activity`, `download_health_snapshot`, and `download_workout`.
- **`login`** — full authentication/session-establishment flow (credentials or
  token-store loading, MFA handling, retry/self-healing of stale cached tokens);
  session lifecycle, not a data endpoint.
- **`resume_login`** — companion to `login` for completing an MFA-interrupted login;
  same lifecycle category.

Also excluded per the task's general rule against underscore-prefixed methods
(`_load_social_profile`, `_load_profile_and_settings`, `_require_display_name`, and
all `_validate_*`/`_fmt_ts*`/`_clean_*`/`_handle_api_errors`/`_is_retryable`/etc.
module-level helpers) — these are private implementation details, not part of the
public `Garmin` surface being ported.
