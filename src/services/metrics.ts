import { GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import { validateSportKey, pathSegment } from "../util/validate.js";
import type {
  CyclingFtpResult,
  EnduranceScoreResult,
  FitnessAgeResult,
  FtpRangeResult,
  HeartRateZoneEntry,
  HeartRateZoneMethod,
  HeartRateZoneUpdate,
  HillScoreResult,
  LactateThresholdLatest,
  LactateThresholdRange,
  MaxMetricsResult,
  PowerZoneEntry,
  PowerZonesForSportResult,
  RacePredictionsResult,
  RunningToleranceEntry,
  TrainingReadinessEntry,
  TrainingStatusResult,
} from "../types/metrics.js";

/** Implemented against a host exposing `client` and `displayName()` (race predictions interpolates it). */
export interface MetricsHost {
  readonly client: GarminClient;
  displayName(): Promise<string>;
}

const MS_PER_DAY = 86_400_000;

function toUtcMidnight(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

/** Exact day count between two `YYYY-MM-DD` strings (end minus start). */
function daysBetween(startStr: string, endStr: string): number {
  return Math.round((toUtcMidnight(endStr).getTime() - toUtcMidnight(startStr).getTime()) / MS_PER_DAY);
}

const FTP_AGGREGATIONS = new Set(["daily", "weekly", "monthly", "yearly"]);

function validateFtpAggregation(aggregation: string): string {
  if (!FTP_AGGREGATIONS.has(aggregation)) {
    throw new GarminError(
      `aggregation must be one of daily, weekly, monthly, yearly; got "${aggregation}"`,
    );
  }
  return aggregation;
}

/** Note the date is repeated twice in the path (start=end=cdate). */
export async function getMaxMetrics(
  host: MetricsHost,
  cdate: string | Date,
): Promise<MaxMetricsResult | null> {
  const date = formatDate(cdate);
  return host.client.connectapi<MaxMetricsResult>(
    `/metrics-service/metrics/maxmet/daily/${pathSegment(date)}/${pathSegment(date)}`,
  );
}

/** Throws `GarminError` unless `start <= end`. */
export async function getMaxMetricsRange(
  host: MetricsHost,
  start: string | Date,
  end: string | Date,
): Promise<MaxMetricsResult | null> {
  const startDate = formatDate(start);
  const endDate = formatDate(end);
  if (startDate > endDate) {
    throw new GarminError("getMaxMetricsRange: start date must not be after end date");
  }
  return host.client.connectapi<MaxMetricsResult>(
    `/metrics-service/metrics/maxmet/daily/${pathSegment(startDate)}/${pathSegment(endDate)}`,
  );
}

/**
 * Undocumented endpoint used because `getCyclingFtp` only returns the
 * latest value. `sport` is normalized via `validateSportKey`; `aggregation`
 * must be one of `daily`/`weekly`/`monthly`/`yearly`.
 */
export async function getFunctionalThresholdPowerRange(
  host: MetricsHost,
  start: string | Date,
  end: string | Date,
  sport = "RUNNING",
  aggregation = "daily",
): Promise<FtpRangeResult | null> {
  const startDate = formatDate(start);
  const endDate = formatDate(end);
  const normalizedSport = validateSportKey(sport);
  const validatedAggregation = validateFtpAggregation(aggregation);
  return host.client.connectapi<FtpRangeResult>(
    `/biometric-service/stats/functionalThresholdPower/range/${pathSegment(startDate)}/${pathSegment(endDate)}`,
    { params: { sport: normalizedSport, aggregation: validatedAggregation, aggregationStrategy: "LATEST" } },
  );
}

/**
 * **Two distinct call shapes per branch, both implemented — this is the
 * defining branching method in this service.**
 *
 * `latest=true` (default): fires two GETs —
 * `/biometric-service/biometric/latestLactateThreshold` (an iterable of
 * speed/heart-rate entries, merged into one dict — falling back
 * `heartRate ?? hearRate`, Garmin's own historical typo) and
 * `/biometric-service/biometric/powerToWeight/latest/{today}` with the
 * LITERAL param `sport: "Running"` (mixed case — deliberately NOT run
 * through `validateSportKey`: Garmin expects this exact mixed-case value,
 * distinct from the range branch's fully-uppercase `"RUNNING"`; do not
 * normalise it). There is no null-guard before iterating the speed/heart-rate
 * entries: if that endpoint returns nothing, the `for...of` over
 * `null`/`undefined` throws a `TypeError`.
 *
 * `latest=false`: requires `startDate` (throws if omitted); `endDate`
 * defaults to today. Fires
 * `/biometric-service/stats/lactateThresholdSpeed/range/{start}/{end}` and
 * `.../lactateThresholdHeartRate/range/{start}/{end}` with
 * `sport: "RUNNING"` (validated/uppercase) + `aggregation` +
 * `aggregationStrategy: "LATEST"`, plus a `getFunctionalThresholdPowerRange`
 * call for `power`.
 */
export async function getLactateThreshold(
  host: MetricsHost,
  latest = true,
  startDate?: string | Date,
  endDate?: string | Date,
  aggregation = "daily",
): Promise<LactateThresholdLatest | LactateThresholdRange> {
  if (latest) {
    const today = formatDate(new Date());
    const [speedAndHeartRateRaw, powerRaw] = await Promise.all([
      host.client.connectapi<unknown>("/biometric-service/biometric/latestLactateThreshold"),
      host.client.connectapi<unknown>(
        `/biometric-service/biometric/powerToWeight/latest/${pathSegment(today)}`,
        { params: { sport: "Running" } },
      ),
    ]);
    const power: Record<string, unknown> = Array.isArray(powerRaw)
      ? ((powerRaw[0] as Record<string, unknown> | undefined) ?? {})
      : powerRaw && typeof powerRaw === "object"
        ? (powerRaw as Record<string, unknown>)
        : {};
    const merged: Record<string, unknown> = {};
    for (const entry of speedAndHeartRateRaw as Iterable<unknown>) {
      const record = entry as Record<string, unknown>;
      for (const [key, value] of Object.entries(record)) {
        if (key === "heartRate" || key === "hearRate") continue;
        merged[key] = value;
      }
      const heartRate = record.heartRate ?? record.hearRate;
      if (heartRate !== undefined) merged.heartRate = heartRate;
    }
    return { speed_and_heart_rate: merged, power };
  }

  if (startDate === undefined) {
    throw new GarminError("getLactateThreshold: startDate is required when latest is false");
  }
  const start = formatDate(startDate);
  const end = endDate === undefined ? formatDate(new Date()) : formatDate(endDate);
  const validatedAggregation = validateFtpAggregation(aggregation);
  const params = { sport: "RUNNING", aggregation: validatedAggregation, aggregationStrategy: "LATEST" };
  const [speed, heartRate, power] = await Promise.all([
    host.client.connectapi<unknown>(
      `/biometric-service/stats/lactateThresholdSpeed/range/${pathSegment(start)}/${pathSegment(end)}`,
      { params },
    ),
    host.client.connectapi<unknown>(
      `/biometric-service/stats/lactateThresholdHeartRate/range/${pathSegment(start)}/${pathSegment(end)}`,
      { params },
    ),
    getFunctionalThresholdPowerRange(host, start, end, "RUNNING", validatedAggregation),
  ]);
  return { speed, heart_rate: heartRate, power };
}

export async function getTrainingReadiness(
  host: MetricsHost,
  cdate: string | Date,
): Promise<TrainingReadinessEntry[] | null> {
  return host.client.connectapi<TrainingReadinessEntry[]>(
    `/metrics-service/metrics/trainingreadiness/${pathSegment(formatDate(cdate))}`,
  );
}

/**
 * Delegates to `getTrainingReadiness` — no HTTP call of its own. Returns
 * `null` if the underlying result is falsy or an EMPTY array (truthy in JS,
 * so it is checked explicitly). Filters for `inputContext === "AFTER_WAKEUP_RESET"`,
 * falling back to the first entry if no such entry exists (not all firmware
 * populates `inputContext`). Defensively returns a non-array result as-is,
 * even though the real endpoint returns a list.
 */
export async function getMorningTrainingReadiness(
  host: MetricsHost,
  cdate: string | Date,
): Promise<TrainingReadinessEntry | null> {
  const data = (await getTrainingReadiness(host, cdate)) as unknown;
  if (!data || (Array.isArray(data) && data.length === 0)) return null;
  if (!Array.isArray(data)) return data as TrainingReadinessEntry;
  const list = data as TrainingReadinessEntry[];
  const match = list.find((entry) => entry.inputContext === "AFTER_WAKEUP_RESET");
  return match ?? list[0] ?? null;
}

/**
 * Two branches by presence of `enddate`. Single day hits
 * `/metrics-service/metrics/endurancescore` with `calendarDate`; a range
 * hits `.../endurancescore/stats` with a hard-coded `aggregation="weekly"`
 * (NOT configurable — contrast with `getHillScore`'s range branch, which
 * hard-codes `"daily"`; do not conflate the two).
 */
export async function getEnduranceScore(
  host: MetricsHost,
  startdate: string | Date,
  enddate?: string | Date,
): Promise<EnduranceScoreResult | null> {
  const start = formatDate(startdate);
  if (enddate === undefined) {
    return host.client.connectapi<EnduranceScoreResult>(
      "/metrics-service/metrics/endurancescore",
      { params: { calendarDate: start } },
    );
  }
  const end = formatDate(enddate);
  return host.client.connectapi<EnduranceScoreResult>(
    "/metrics-service/metrics/endurancescore/stats",
    { params: { startDate: start, endDate: end, aggregation: "weekly" } },
  );
}

const RUNNING_TOLERANCE_AGGREGATIONS = new Set(["daily", "weekly"]);

/** `aggregation` is restricted to `{daily, weekly}` — narrower than the FTP/lactate methods. */
export async function getRunningTolerance(
  host: MetricsHost,
  startdate: string | Date,
  enddate: string | Date,
  aggregation = "weekly",
): Promise<RunningToleranceEntry[] | null> {
  if (!RUNNING_TOLERANCE_AGGREGATIONS.has(aggregation)) {
    throw new GarminError(`aggregation must be one of daily, weekly; got "${aggregation}"`);
  }
  const start = formatDate(startdate);
  const end = formatDate(enddate);
  return host.client.connectapi<RunningToleranceEntry[]>(
    "/metrics-service/metrics/runningtolerance/stats",
    { params: { startDate: start, endDate: end, aggregation } },
  );
}

/**
 * Two branches, all-or-nothing params: with none of `startdate`/`enddate`/
 * `type` supplied, hits `/metrics-service/metrics/racepredictions/latest/{displayName}`.
 * With all three supplied, hits `/metrics-service/metrics/racepredictions/{type}/{displayName}`
 * with `fromCalendarDate`/`toCalendarDate`. Any partial combination throws.
 * `type` must be `"daily"` or `"monthly"`. The range branch also enforces
 * `(enddate - startdate) <= 366` days (a negative span, i.e. `enddate` before
 * `startdate`, is NOT rejected here — the check is a literal
 * `enddate - startdate <= 366 days`, which a negative delta already
 * satisfies).
 */
export async function getRacePredictions(
  host: MetricsHost,
  startdate?: string | Date,
  enddate?: string | Date,
  type?: "daily" | "monthly",
): Promise<RacePredictionsResult | null> {
  const provided = [startdate, enddate, type].filter((v) => v !== undefined).length;
  if (provided !== 0 && provided !== 3) {
    throw new GarminError(
      "getRacePredictions: you must either provide all parameters or no parameters",
    );
  }
  if (provided === 0) {
    return host.client.connectapi<RacePredictionsResult>(
      `/metrics-service/metrics/racepredictions/latest/${pathSegment(await host.displayName())}`,
    );
  }
  if (type !== "daily" && type !== "monthly") {
    throw new GarminError('getRacePredictions: type must be "daily" or "monthly"');
  }
  const start = formatDate(startdate as string | Date);
  const end = formatDate(enddate as string | Date);
  if (daysBetween(start, end) > 366) {
    throw new GarminError("getRacePredictions: date range must not exceed 366 days");
  }
  return host.client.connectapi<RacePredictionsResult>(
    `/metrics-service/metrics/racepredictions/${pathSegment(type)}/${pathSegment(await host.displayName())}`,
    { params: { fromCalendarDate: start, toCalendarDate: end } },
  );
}

export async function getTrainingStatus(
  host: MetricsHost,
  cdate: string | Date,
): Promise<TrainingStatusResult | null> {
  return host.client.connectapi<TrainingStatusResult>(
    `/metrics-service/metrics/trainingstatus/aggregated/${pathSegment(formatDate(cdate))}`,
  );
}

export async function getFitnessAgeData(
  host: MetricsHost,
  cdate: string | Date,
): Promise<FitnessAgeResult | null> {
  return host.client.connectapi<FitnessAgeResult>(`/fitnessage-service/fitnessage/${pathSegment(formatDate(cdate))}`);
}

/**
 * Two branches by presence of `enddate`, same shape as `getEnduranceScore`
 * but with the OPPOSITE hard-coded range aggregation: `"daily"`, not
 * `"weekly"` — do not conflate the two.
 */
export async function getHillScore(
  host: MetricsHost,
  startdate: string | Date,
  enddate?: string | Date,
): Promise<HillScoreResult | null> {
  const start = formatDate(startdate);
  if (enddate === undefined) {
    return host.client.connectapi<HillScoreResult>(
      "/metrics-service/metrics/hillscore",
      { params: { calendarDate: start } },
    );
  }
  const end = formatDate(enddate);
  return host.client.connectapi<HillScoreResult>(
    "/metrics-service/metrics/hillscore/stats",
    { params: { startDate: start, endDate: end, aggregation: "daily" } },
  );
}

/** Returns only the latest value; use `getFunctionalThresholdPowerRange` for history. */
export async function getCyclingFtp(host: MetricsHost): Promise<CyclingFtpResult | null> {
  return host.client.connectapi<CyclingFtpResult>(
    "/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING",
  );
}

/** Configured HR zones for all sport profiles. */
export async function getHeartRateZones(host: MetricsHost): Promise<HeartRateZoneEntry[] | null> {
  return host.client.connectapi<HeartRateZoneEntry[]>("/biometric-service/heartRateZones");
}

// ---------------------------------------------------------------------------
// Heart-rate zone writes. `PUT /biometric-service/heartRateZones` takes an ARRAY of the profiles
// that changed and answers 204. Verified live on 2026-10-06 (DEFAULT floors changed and read back,
// a RUNNING profile created then deleted, everything restored), including `changeState: "DELETED"`
// removing a sport profile.
// ---------------------------------------------------------------------------

const HR_ZONES_PATH = "/biometric-service/heartRateZones";
const HR_ZONE_METHODS: ReadonlySet<string> = new Set<HeartRateZoneMethod>([
  "HR_MAX",
  "HR_RESERVE",
  "LACTATE_THRESHOLD",
]);

function assertBpm(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 300) {
    throw new GarminError(`${name} must be a whole number of bpm from 1 to 300; got ${String(value)}`);
  }
}

/**
 * Changes one heart-rate zone profile — DEFAULT, or a sport's own — and returns it as stored.
 *
 * READ-MODIFY-WRITE: GETs every profile, overlays `update` onto the matching one, PUTs it back,
 * then reads it back again (the PUT itself returns nothing). A sport with no profile of its own
 * yet starts as a copy of DEFAULT, which is what Garmin Connect's settings page does.
 *
 * Garmin does not recalculate the floors when the method or a heart rate changes; see
 * `HeartRateZoneUpdate`. It does reject floors that are not ascending, and so does this method,
 * before sending anything.
 */
export async function setHeartRateZones(
  host: MetricsHost,
  update: HeartRateZoneUpdate,
): Promise<HeartRateZoneEntry | null> {
  const sport = validateSportKey(update.sport ?? "DEFAULT");
  const { trainingMethod, maxHeartRate, restingHeartRate, lactateThresholdHeartRate, zoneFloors } =
    update;
  if (
    [trainingMethod, maxHeartRate, restingHeartRate, lactateThresholdHeartRate, zoneFloors].every(
      (v) => v === undefined,
    )
  ) {
    throw new GarminError("setHeartRateZones needs at least one field to change besides sport");
  }
  if (trainingMethod !== undefined && !HR_ZONE_METHODS.has(trainingMethod)) {
    throw new GarminError(
      `Unknown trainingMethod "${String(trainingMethod)}" — expected HR_MAX, HR_RESERVE or LACTATE_THRESHOLD`,
    );
  }
  if (maxHeartRate !== undefined) assertBpm(maxHeartRate, "maxHeartRate");
  if (restingHeartRate !== undefined) assertBpm(restingHeartRate, "restingHeartRate");
  if (lactateThresholdHeartRate !== undefined) {
    assertBpm(lactateThresholdHeartRate, "lactateThresholdHeartRate");
  }
  if (zoneFloors !== undefined) {
    if (!Array.isArray(zoneFloors) || zoneFloors.length !== 5) {
      throw new GarminError("zoneFloors must hold exactly five values, the floors of zones 1-5");
    }
    zoneFloors.forEach((f, i) => assertBpm(f, `zoneFloors[${String(i)}]`));
    for (let i = 1; i < 5; i++) {
      if (zoneFloors[i]! <= zoneFloors[i - 1]!) {
        throw new GarminError("zoneFloors must be strictly ascending");
      }
    }
  }

  const profiles = (await host.client.connectapi<HeartRateZoneEntry[]>(HR_ZONES_PATH)) ?? [];
  const existing = profiles.find((p) => p.sport === sport);
  const base = existing ?? profiles.find((p) => p.sport === "DEFAULT");
  if (!base) {
    throw new GarminError(`No ${sport} heart-rate zone profile, and no DEFAULT one to start it from`);
  }
  const next: HeartRateZoneEntry = { ...base, sport, changeState: "CHANGED" };
  if (trainingMethod !== undefined) next.trainingMethod = trainingMethod;
  if (maxHeartRate !== undefined) next.maxHeartRateUsed = maxHeartRate;
  if (restingHeartRate !== undefined) {
    next.restingHeartRateUsed = restingHeartRate;
    next.restingHrAutoUpdateUsed = false;
  }
  if (lactateThresholdHeartRate !== undefined) {
    next.lactateThresholdHeartRateUsed = lactateThresholdHeartRate;
  }
  if (zoneFloors !== undefined) {
    zoneFloors.forEach((floor, i) => {
      next[`zone${String(i + 1)}Floor`] = floor;
    });
  }

  await host.client.connectapi(HR_ZONES_PATH, { method: "PUT", json: [next] });
  const after = await host.client.connectapi<HeartRateZoneEntry[]>(HR_ZONES_PATH);
  return after?.find((p) => p.sport === sport) ?? null;
}

/**
 * Removes a sport's own heart-rate zone profile, so that sport falls back to DEFAULT. Sends the
 * stored profile back with `changeState: "DELETED"`, which Garmin honours (verified live: the
 * profile was gone on read-back). DEFAULT itself cannot be deleted, and a sport with no profile
 * throws rather than silently doing nothing.
 */
export async function deleteHeartRateZones(host: MetricsHost, sport: string): Promise<unknown> {
  const key = validateSportKey(sport);
  if (key === "DEFAULT") {
    throw new GarminError("The DEFAULT heart-rate zone profile cannot be deleted");
  }
  const profiles = (await host.client.connectapi<HeartRateZoneEntry[]>(HR_ZONES_PATH)) ?? [];
  const existing = profiles.find((p) => p.sport === key);
  if (!existing) {
    throw new GarminError(`There is no ${key} heart-rate zone profile to delete`);
  }
  return host.client.connectapi(HR_ZONES_PATH, {
    method: "PUT",
    json: [{ ...existing, changeState: "DELETED" }],
  });
}

export async function getPowerZones(host: MetricsHost): Promise<PowerZoneEntry[] | null> {
  return host.client.connectapi<PowerZoneEntry[]>("/biometric-service/powerZones/sports/all");
}

export async function getPowerZonesForSport(
  host: MetricsHost,
  sport: string,
): Promise<PowerZonesForSportResult | null> {
  const normalized = validateSportKey(sport);
  return host.client.connectapi<PowerZonesForSportResult>(
    `/biometric-service/powerZones/sport/${pathSegment(normalized)}`,
  );
}
