import { pathSegment } from "../util/validate.js";
import { GarminAuthError, GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { formatDate, formatGmtTimestamp, formatLocalTimestamp } from "../util/date.js";
import { getBodyComposition } from "./bodyComposition.js";
import type {
  BloodPressureRange,
  BloodPressureSetResult,
  BodyBatteryEntry,
  BodyBatteryEvent,
  CaloriesDailyEntry,
  DailyEventsData,
  DailyStatsEntry,
  DailyStatsType,
  DailyStepsEntry,
  DailyStressData,
  FloorsData,
  HeartRateData,
  HrvData,
  HrvDataRange,
  HydrationLogResult,
  IntensityMinutesData,
  RespirationData,
  RhrDailyEntry,
  RhrDayData,
  SleepData,
  SleepDailyEntry,
  Spo2Data,
  StatsAndBody,
  StepsEntry,
  UserSummary,
  WeeklyIntensityMinutesEntry,
  WeeklyStepsEntry,
  WeeklyStressEntry,
} from "../types/wellness.js";

/** Implemented against a host exposing `client` and `displayName()`. */
export interface WellnessHost {
  readonly client: GarminClient;
  displayName(): Promise<string>;
}

export async function getUserSummary(
  host: WellnessHost,
  cdate: string | Date,
): Promise<UserSummary> {
  const date = formatDate(cdate);
  const summary = await host.client.connectapi<UserSummary>(
    `/usersummary-service/usersummary/daily/${pathSegment(await host.displayName())}`,
    { params: { calendarDate: date } },
  );
  if (!summary) throw new GarminError("No user summary received from Garmin");
  if (summary.privacyProtected === true) {
    throw new GarminAuthError("User summary is privacy-protected");
  }
  return summary;
}

export async function getStepsData(
  host: WellnessHost,
  cdate: string | Date,
): Promise<StepsEntry[]> {
  const date = formatDate(cdate);
  const steps = await host.client.connectapi<StepsEntry[]>(
    `/wellness-service/wellness/dailySummaryChart/${pathSegment(await host.displayName())}`,
    { params: { date } },
  );
  return steps ?? [];
}

export async function getHeartRates(
  host: WellnessHost,
  cdate: string | Date,
): Promise<HeartRateData> {
  const date = formatDate(cdate);
  const data = await host.client.connectapi<HeartRateData>(
    `/wellness-service/wellness/dailyHeartRate/${pathSegment(await host.displayName())}`,
    { params: { date } },
  );
  if (!data) throw new GarminError("No heart rate data received from Garmin");
  return data;
}

// No null check — returns whatever connectapi gives back, including nothing
// for a night the user didn't wear the watch. That's an ordinary, expected
// result, not an error, so this returns null instead of throwing. Null
// behaviour is decided per-method rather than by a blanket policy.
export async function getSleepData(
  host: WellnessHost,
  cdate: string | Date,
): Promise<SleepData | null> {
  const date = formatDate(cdate);
  return host.client.connectapi<SleepData>(
    `/wellness-service/wellness/dailySleepData/${pathSegment(await host.displayName())}`,
    { params: { date, nonSleepBufferMinutes: 60 } },
  );
}

export async function getHrvData(
  host: WellnessHost,
  cdate: string | Date,
): Promise<HrvData | null> {
  return host.client.connectapi<HrvData>(`/hrv-service/hrv/${pathSegment(formatDate(cdate))}`);
}

export async function getBodyBattery(
  host: WellnessHost,
  startdate: string | Date,
  enddate?: string | Date,
): Promise<BodyBatteryEntry[]> {
  const start = formatDate(startdate);
  const end = enddate === undefined ? start : formatDate(enddate);
  const data = await host.client.connectapi<BodyBatteryEntry[]>(
    "/wellness-service/wellness/bodyBattery/reports/daily",
    { params: { startDate: start, endDate: end } },
  );
  return data ?? [];
}

export async function getBodyBatteryEvents(
  host: WellnessHost,
  cdate: string | Date,
): Promise<BodyBatteryEvent[] | null> {
  return host.client.connectapi<BodyBatteryEvent[]>(
    `/wellness-service/wellness/bodyBattery/events/${pathSegment(formatDate(cdate))}`,
  );
}

export async function getFloors(host: WellnessHost, cdate: string | Date): Promise<FloorsData> {
  const date = formatDate(cdate);
  const data = await host.client.connectapi<FloorsData>(
    `/wellness-service/wellness/floorsChartData/daily/${pathSegment(date)}`,
  );
  if (!data) throw new GarminError("No floors data received from Garmin");
  return data;
}

const MS_PER_DAY = 86_400_000;

function toUtcMidnight(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

/** Adds (or subtracts) whole days to a `YYYY-MM-DD` string, staying in UTC. */
function addDays(dateStr: string, days: number): string {
  const d = toUtcMidnight(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Exact day count between two `YYYY-MM-DD` strings (end minus start). */
function daysBetween(startStr: string, endStr: string): number {
  return Math.round((toUtcMidnight(endStr).getTime() - toUtcMidnight(startStr).getTime()) / MS_PER_DAY);
}

/**
 * Splits ranges over Garmin's 28-day-per-request limit into windows of
 * ≤28 calendar days per request and concatenates. Within the limit, a single
 * request's raw (possibly `null`) result is returned unchecked; a chunked
 * request only appends a chunk's results when they are truthy.
 */
export async function getDailySteps(
  host: WellnessHost,
  start: string | Date,
  end: string | Date,
): Promise<DailyStepsEntry[] | null> {
  const startDate = formatDate(start);
  const endDate = formatDate(end);
  if (startDate > endDate) {
    throw new GarminError("getDailySteps: start date must not be after end date");
  }
  const url = (s: string, e: string): string => `/usersummary-service/stats/steps/daily/${pathSegment(s)}/${pathSegment(e)}`;
  if (daysBetween(startDate, endDate) <= 28) {
    return host.client.connectapi<DailyStepsEntry[]>(url(startDate, endDate));
  }
  const results: DailyStepsEntry[] = [];
  let chunkStart = startDate;
  while (chunkStart <= endDate) {
    const chunkEnd = daysBetween(chunkStart, endDate) > 27 ? addDays(chunkStart, 27) : endDate;
    const chunkResults = await host.client.connectapi<DailyStepsEntry[]>(url(chunkStart, chunkEnd));
    if (chunkResults) results.push(...chunkResults);
    chunkStart = addDays(chunkEnd, 1);
  }
  return results;
}

const DAILY_STATS_TYPES: ReadonlySet<string> = new Set<DailyStatsType>(["CALORIES", "STEPS"]);

/**
 * Per-day calorie or step totals for a date range, from
 * `GET /usersummary-service/stats/daily/{start}/{end}?statsType=…`, verified live on
 * 2026-10-06.
 *
 * Garmin refuses a span of more than 28 days (`end - start > 27` is a 400), so a longer range is
 * fetched in 28-day windows and the days concatenated. Garmin's own `aggregations` block (the
 * averages) is per request, so it is dropped rather than returned wrong for a chunked range.
 * A range with no data at all comes back as `[]`.
 *
 * It overlaps `getDailySteps` and `getCaloriesDaily`; this one returns each day's calories as
 * total, active and resting together, and steps alongside distance and the step goal.
 */
export async function getDailyStats(
  host: WellnessHost,
  start: string | Date,
  end: string | Date,
  statsType: DailyStatsType,
): Promise<DailyStatsEntry[]> {
  if (!DAILY_STATS_TYPES.has(statsType)) {
    throw new GarminError(`statsType must be "CALORIES" or "STEPS"; got "${String(statsType)}"`);
  }
  const startDate = formatDate(start);
  const endDate = formatDate(end);
  if (startDate > endDate) {
    throw new GarminError("getDailyStats: start date must not be after end date");
  }
  const results: DailyStatsEntry[] = [];
  let chunkStart = startDate;
  while (chunkStart <= endDate) {
    const chunkEnd = daysBetween(chunkStart, endDate) > 27 ? addDays(chunkStart, 27) : endDate;
    const page = await host.client.connectapi<{ values?: DailyStatsEntry[] }>(
      `/usersummary-service/stats/daily/${pathSegment(chunkStart)}/${pathSegment(chunkEnd)}`,
      { params: { statsType } },
    );
    if (page?.values) results.push(...page.values);
    chunkStart = addDays(chunkEnd, 1);
  }
  return results;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new GarminError(`${name} must be a positive integer`);
  }
}

export async function getWeeklySteps(
  host: WellnessHost,
  end: string | Date,
  weeks = 52,
): Promise<WeeklyStepsEntry[] | null> {
  assertPositiveInteger(weeks, "weeks");
  const endDate = formatDate(end);
  return host.client.connectapi<WeeklyStepsEntry[]>(
    `/usersummary-service/stats/steps/weekly/${pathSegment(endDate)}/${pathSegment(weeks)}`,
  );
}

export async function getWeeklyStress(
  host: WellnessHost,
  end: string | Date,
  weeks = 52,
): Promise<WeeklyStressEntry[] | null> {
  assertPositiveInteger(weeks, "weeks");
  const endDate = formatDate(end);
  return host.client.connectapi<WeeklyStressEntry[]>(
    `/usersummary-service/stats/stress/weekly/${pathSegment(endDate)}/${pathSegment(weeks)}`,
  );
}

export async function getWeeklyIntensityMinutes(
  host: WellnessHost,
  start: string | Date,
  end: string | Date,
): Promise<WeeklyIntensityMinutesEntry[] | null> {
  const s = formatDate(start);
  const e = formatDate(end);
  return host.client.connectapi<WeeklyIntensityMinutesEntry[]>(
    `/usersummary-service/stats/im/weekly/${pathSegment(s)}/${pathSegment(e)}`,
  );
}

/**
 * Calls `getUserSummary(cdate)` and `getBodyComposition(cdate)` and merges
 * the summary with the body composition's `totalAverage` block (or `{}`).
 * Delegates to the `bodyComposition` service rather than inlining its own
 * `GET /weight-service/weight/dateRange` call.
 */
export async function getStatsAndBody(
  host: WellnessHost,
  cdate: string | Date,
): Promise<StatsAndBody> {
  const date = formatDate(cdate);
  const [stats, body] = await Promise.all([
    getUserSummary(host, date),
    getBodyComposition(host, date),
  ]);
  const totalAverage =
    body && typeof body === "object" && body.totalAverage && typeof body.totalAverage === "object"
      ? body.totalAverage
      : {};
  return { ...stats, ...totalAverage };
}


/**
 * `pulse` is optional — Garmin's own UI allows a blood-pressure entry
 * without a heart rate. Ranges enforced: systolic 70-260,
 * diastolic 40-150, pulse (if given) 20-250, all integers.
 *
 * Returns whatever `connectapi` gives back unchecked (which is `null` on a
 * 204/empty body, per this library's `connectapi` contract).
 */
export async function setBloodPressure(
  host: WellnessHost,
  systolic: number,
  diastolic: number,
  pulse?: number,
  when: Date = new Date(),
  notes = "",
): Promise<BloodPressureSetResult | null> {
  if (!Number.isInteger(systolic) || systolic < 70 || systolic > 260) {
    throw new GarminError("systolic must be an integer between 70 and 260");
  }
  if (!Number.isInteger(diastolic) || diastolic < 40 || diastolic > 150) {
    throw new GarminError("diastolic must be an integer between 40 and 150");
  }
  if (pulse !== undefined && (!Number.isInteger(pulse) || pulse < 20 || pulse > 250)) {
    throw new GarminError("pulse must be an integer between 20 and 250");
  }
  return host.client.connectapi<BloodPressureSetResult>("/bloodpressure-service/bloodpressure", {
    method: "POST",
    json: {
      measurementTimestampLocal: formatLocalTimestamp(when),
      measurementTimestampGMT: formatGmtTimestamp(when),
      systolic,
      diastolic,
      sourceType: "MANUAL",
      notes,
      ...(pulse !== undefined ? { pulse } : {}),
    },
  });
}

export async function getBloodPressure(
  host: WellnessHost,
  startdate: string | Date,
  enddate?: string | Date,
): Promise<BloodPressureRange | null> {
  const start = formatDate(startdate);
  const end = enddate === undefined ? start : formatDate(enddate);
  return host.client.connectapi<BloodPressureRange>(
    `/bloodpressure-service/bloodpressure/range/${pathSegment(start)}/${pathSegment(end)}`,
    { params: { includeAll: "true" } },
  );
}

/** Returns Garmin's raw response to the DELETE. */
export async function deleteBloodPressure(
  host: WellnessHost,
  version: number | string,
  cdate: string | Date,
): Promise<unknown> {
  const v = Number(version);
  assertPositiveInteger(v, "version");
  const date = formatDate(cdate);
  return host.client.connectapi(`/bloodpressure-service/bloodpressure/${pathSegment(date)}/${pathSegment(v)}`, {
    method: "DELETE",
  });
}

const MAX_HYDRATION_ML = 10_000;

/**
 * `valueInMl` is sent RAW in milliliters (field name `valueInML`) —
 * negative values are allowed (they subtract), magnitude capped at
 * `MAX_HYDRATION_ML`. Date/timestamp reconciliation: if
 * both `when` and `cdate` are omitted, uses now(); if only `cdate` is given,
 * uses local midnight of that date; if only `when` is given, derives
 * `cdate` from it; if both are given, their dates must agree or this
 * throws.
 *
 * Returns Garmin's raw response.
 */
export async function addHydrationData(
  host: WellnessHost,
  valueInMl: number,
  when?: Date,
  cdate?: string | Date,
): Promise<HydrationLogResult | null> {
  if (Math.abs(valueInMl) > MAX_HYDRATION_ML) {
    throw new GarminError(`valueInMl magnitude must not exceed ${MAX_HYDRATION_ML}`);
  }
  let date: string;
  let timestampLocal: string;
  if (when === undefined && cdate === undefined) {
    const now = new Date();
    date = formatDate(now);
    timestampLocal = formatLocalTimestamp(now);
  } else if (when === undefined) {
    date = formatDate(cdate as string | Date);
    timestampLocal = `${date}T00:00:00.00`;
  } else if (cdate === undefined) {
    date = formatDate(when);
    timestampLocal = formatLocalTimestamp(when);
  } else {
    date = formatDate(cdate);
    const derivedDate = formatDate(when);
    if (derivedDate !== date) {
      throw new GarminError("timestamp's date does not match cdate");
    }
    timestampLocal = formatLocalTimestamp(when);
  }
  return host.client.connectapi<HydrationLogResult>(
    "/usersummary-service/usersummary/hydration/log",
    {
      method: "PUT",
      json: { calendarDate: date, timestampLocal, valueInML: valueInMl },
    },
  );
}

export async function getHydrationData(
  host: WellnessHost,
  cdate: string | Date,
): Promise<HydrationLogResult | null> {
  return host.client.connectapi<HydrationLogResult>(
    `/usersummary-service/usersummary/hydration/daily/${pathSegment(formatDate(cdate))}`,
  );
}

export async function getRespirationData(
  host: WellnessHost,
  cdate: string | Date,
): Promise<RespirationData | null> {
  return host.client.connectapi<RespirationData>(
    `/wellness-service/wellness/daily/respiration/${pathSegment(formatDate(cdate))}`,
  );
}

/**
 * If Garmin sends `lastSevenDaysAvgSpO2` as a string, it is coerced to a
 * number in place before returning.
 */
export async function getSpo2Data(
  host: WellnessHost,
  cdate: string | Date,
): Promise<Spo2Data | null> {
  const data = await host.client.connectapi<Spo2Data>(
    `/wellness-service/wellness/daily/spo2/${pathSegment(formatDate(cdate))}`,
  );
  if (data && typeof data === "object" && typeof data.lastSevenDaysAvgSpO2 === "string") {
    data.lastSevenDaysAvgSpO2 = Number(data.lastSevenDaysAvgSpO2);
  }
  return data;
}

export async function getIntensityMinutesData(
  host: WellnessHost,
  cdate: string | Date,
): Promise<IntensityMinutesData | null> {
  return host.client.connectapi<IntensityMinutesData>(
    `/wellness-service/wellness/daily/im/${pathSegment(formatDate(cdate))}`,
  );
}

export async function getAllDayStress(
  host: WellnessHost,
  cdate: string | Date,
): Promise<DailyStressData | null> {
  return host.client.connectapi<DailyStressData>(
    `/wellness-service/wellness/dailyStress/${pathSegment(formatDate(cdate))}`,
  );
}

/**
 * Same URL as `getAllDayStress` — two separate methods hitting the identical
 * endpoint, kept for API compatibility.
 */
export async function getStressData(
  host: WellnessHost,
  cdate: string | Date,
): Promise<DailyStressData | null> {
  return host.client.connectapi<DailyStressData>(
    `/wellness-service/wellness/dailyStress/${pathSegment(formatDate(cdate))}`,
  );
}

export async function getAllDayEvents(
  host: WellnessHost,
  cdate: string | Date,
): Promise<DailyEventsData | null> {
  const date = formatDate(cdate);
  return host.client.connectapi<DailyEventsData>("/wellness-service/wellness/dailyEvents", {
    params: { calendarDate: date },
  });
}

/**
 * Garmin's `sleep-service/stats/sleep/daily` endpoint has a documented
 * 28-day-per-request limit; ranges longer than that are auto-chunked into
 * ≤28-day windows (same chunking scheme as `getDailySteps`), and the
 * per-chunk `individualStats` rows are de-duplicated by `calendarDate` and
 * sorted by `calendarDate` before being returned.
 */
export async function getSleepDaily(
  host: WellnessHost,
  start: string | Date,
  end: string | Date,
): Promise<SleepDailyEntry[]> {
  const startDate = formatDate(start);
  const endDate = formatDate(end);
  if (startDate > endDate) {
    throw new GarminError("getSleepDaily: start date must not be after end date");
  }
  const byDate = new Map<string, SleepDailyEntry>();
  let chunkStart = startDate;
  while (chunkStart <= endDate) {
    const chunkEnd = daysBetween(chunkStart, endDate) > 27 ? addDays(chunkStart, 27) : endDate;
    const data = await host.client.connectapi<{ individualStats?: SleepDailyEntry[] }>(
      `/sleep-service/stats/sleep/daily/${pathSegment(chunkStart)}/${pathSegment(chunkEnd)}`,
    );
    for (const row of data?.individualStats ?? []) {
      const key = typeof row.calendarDate === "string" ? row.calendarDate : JSON.stringify(row);
      byDate.set(key, row);
    }
    chunkStart = addDays(chunkEnd, 1);
  }
  return [...byDate.values()].sort((a, b) =>
    String(a.calendarDate ?? "").localeCompare(String(b.calendarDate ?? "")),
  );
}

export async function getRhrDay(
  host: WellnessHost,
  cdate: string | Date,
): Promise<RhrDayData | null> {
  const date = formatDate(cdate);
  return host.client.connectapi<RhrDayData>(
    `/userstats-service/wellness/daily/${pathSegment(await host.displayName())}`,
    { params: { fromDate: date, untilDate: date, metricId: 60 } },
  );
}

/**
 * Reshapes Garmin's `allMetrics.metricsMap` response into
 * `[{ calendarDate, value }, ...]`, dropping rows whose value is
 * null/missing; a missing `allMetrics` or `metricsMap` yields `[]`. This
 * iterates every array found under `metricsMap` rather than assuming a
 * specific key name —
 * `metricId: 60` in the request already scopes the server-side response to
 * resting heart rate.
 */
export async function getRhrDaily(
  host: WellnessHost,
  start: string | Date,
  end: string | Date,
): Promise<RhrDailyEntry[]> {
  const s = formatDate(start);
  const e = formatDate(end);
  const data = await host.client.connectapi<{
    allMetrics?: { metricsMap?: Record<string, unknown> };
  }>(`/userstats-service/wellness/daily/${pathSegment(await host.displayName())}`, {
    params: { fromDate: s, untilDate: e, metricId: 60 },
  });
  const metricsMap = data?.allMetrics?.metricsMap ?? {};
  const rows: RhrDailyEntry[] = [];
  for (const entries of Object.values(metricsMap)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as unknown[]) {
      if (!entry || typeof entry !== "object") continue;
      const e2 = entry as Record<string, unknown>;
      if (e2.value === null || e2.value === undefined) continue;
      rows.push({ calendarDate: e2.calendarDate as string | undefined, value: e2.value as number });
    }
  }
  return rows;
}

/**
 * Same `metricsMap` navigation as `getRhrDaily`, requesting `metricId=22`
 * (active calories) and `metricId=23` (BMR/resting calories) and merging
 * both series by `calendarDate` into
 * `{ calendarDate, active, resting, total }`, where
 * `total = (active ?? 0) + (resting ?? 0)`. Rows where both are
 * null/missing are skipped.
 *
 * Two details were resolved by a live probe against
 * `/userstats-service/wellness/daily/{displayName}` rather than guessed:
 * - A *repeated* `metricId` query param (`?metricId=22&metricId=23`) is
 *   required — a comma-joined `metricId=22,23` 404s. `connectapi`'s
 *   `params` option only supports one value per key, so the repeated pair
 *   is built into the path's query string directly instead.
 * - `metricsMap`'s keys are the metric names, not ids — confirmed live as
 *   `WELLNESS_ACTIVE_CALORIES` (22) and `WELLNESS_BMR_CALORIES` (23); there
 *   is no per-entry `metricId` field to key off of.
 */
export async function getCaloriesDaily(
  host: WellnessHost,
  start: string | Date,
  end: string | Date,
): Promise<CaloriesDailyEntry[]> {
  const s = formatDate(start);
  const e = formatDate(end);
  const query = new URLSearchParams({ fromDate: s, untilDate: e });
  query.append("metricId", "22");
  query.append("metricId", "23");
  const data = await host.client.connectapi<{
    allMetrics?: { metricsMap?: Record<string, unknown> };
  }>(`/userstats-service/wellness/daily/${pathSegment(await host.displayName())}?${query.toString()}`);
  const metricsMap = data?.allMetrics?.metricsMap ?? {};
  const byDate = new Map<string, { calendarDate: string; active?: number; resting?: number }>();
  const collect = (key: string, assign: (row: { active?: number; resting?: number }, value: number | undefined) => void) => {
    const entries = metricsMap[key];
    if (!Array.isArray(entries)) return;
    for (const entry of entries as unknown[]) {
      if (!entry || typeof entry !== "object") continue;
      const e2 = entry as Record<string, unknown>;
      const calendarDate = e2.calendarDate as string | undefined;
      if (!calendarDate) continue;
      const value = e2.value as number | null | undefined;
      const existing = byDate.get(calendarDate) ?? { calendarDate };
      assign(existing, value ?? undefined);
      byDate.set(calendarDate, existing);
    }
  };
  collect("WELLNESS_ACTIVE_CALORIES", (row, value) => {
    row.active = value;
  });
  collect("WELLNESS_BMR_CALORIES", (row, value) => {
    row.resting = value;
  });
  const result: CaloriesDailyEntry[] = [];
  for (const { calendarDate, active, resting } of byDate.values()) {
    if (active === undefined && resting === undefined) continue;
    result.push({ calendarDate, active, resting, total: (active ?? 0) + (resting ?? 0) });
  }
  return result;
}

export async function getHrvDataRange(
  host: WellnessHost,
  start: string | Date,
  end: string | Date,
): Promise<HrvDataRange | null> {
  const s = formatDate(start);
  const e = formatDate(end);
  return host.client.connectapi<HrvDataRange>(`/hrv-service/hrv/daily/${pathSegment(s)}/${pathSegment(e)}`);
}
