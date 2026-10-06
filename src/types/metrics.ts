/**
 * Garmin's payload shapes for these endpoints are undocumented beyond
 * object-vs-array. Every interface below is deliberately loose (index
 * signatures / `unknown`) rather than guessing fields that were never
 * observed.
 */

/** `GET /metrics-service/metrics/maxmet/daily/{cdate}/{cdate}` and the range variant. */
export interface MaxMetricsResult {
  [key: string]: unknown;
}

/** `GET /biometric-service/stats/functionalThresholdPower/range/{start}/{end}` — an object or an array. */
export type FtpRangeResult = Record<string, unknown> | Record<string, unknown>[];

/**
 * `getLactateThreshold`'s `latest=true` branch. `speed_and_heart_rate` is
 * the merged object's field name — snake_case, kept as-is for compatibility.
 */
export interface LactateThresholdLatest {
  speed_and_heart_rate: Record<string, unknown>;
  power: Record<string, unknown>;
}

/** `getLactateThreshold`'s `latest=false` (range) branch. */
export interface LactateThresholdRange {
  speed: unknown;
  heart_rate: unknown;
  power: FtpRangeResult | null;
}

/** `GET /metrics-service/metrics/trainingreadiness/{cdate}` entry. */
export interface TrainingReadinessEntry {
  inputContext?: string;
  [key: string]: unknown;
}

/** `GET /metrics-service/metrics/endurancescore` and `.../endurancescore/stats`. */
export interface EnduranceScoreResult {
  [key: string]: unknown;
}

/** `GET /metrics-service/metrics/runningtolerance/stats` entry. */
export interface RunningToleranceEntry {
  [key: string]: unknown;
}

/** `GET /metrics-service/metrics/racepredictions/...`. */
export interface RacePredictionsResult {
  [key: string]: unknown;
}

/** `GET /metrics-service/metrics/trainingstatus/aggregated/{cdate}`. */
export interface TrainingStatusResult {
  [key: string]: unknown;
}

/** `GET /fitnessage-service/fitnessage/{cdate}`. */
export interface FitnessAgeResult {
  [key: string]: unknown;
}

/** `GET /metrics-service/metrics/hillscore` and `.../hillscore/stats`. */
export interface HillScoreResult {
  [key: string]: unknown;
}

/** `GET /biometric-service/biometric/latestFunctionalThresholdPower/CYCLING` — an object or an array. */
export type CyclingFtpResult = Record<string, unknown> | Record<string, unknown>[];

/** `GET /biometric-service/heartRateZones` entry. */
export interface HeartRateZoneEntry {
  /** `"DEFAULT"`, or an upper-case sport key (`"RUNNING"`, `"CYCLING"`) for a sport's own profile. */
  sport?: string;
  trainingMethod?: HeartRateZoneMethod;
  /** Lower bound, in bpm, of zones 1-5. Garmin rejects floors that are not ascending. */
  zone1Floor?: number;
  zone2Floor?: number;
  zone3Floor?: number;
  zone4Floor?: number;
  zone5Floor?: number;
  maxHeartRateUsed?: number | null;
  restingHeartRateUsed?: number | null;
  lactateThresholdHeartRateUsed?: number | null;
  restingHrAutoUpdateUsed?: boolean;
  /** Always `"UNCHANGED"` on read. Garmin applies a PUT whatever this says. */
  changeState?: string;
  [key: string]: unknown;
}

/** How a heart-rate zone profile's floors are expressed: % of max HR, % of HR reserve, % of LTHR. */
export type HeartRateZoneMethod = "HR_MAX" | "HR_RESERVE" | "LACTATE_THRESHOLD";

/**
 * Input to `setHeartRateZones`. Every field except `sport` is optional; what is omitted keeps its
 * stored value. All heart rates are whole bpm.
 *
 * Garmin does NOT recompute the floors when `trainingMethod` or a heart rate changes — verified
 * live: switching a profile to `HR_RESERVE` kept the old floors. The floors are whatever was last
 * written, so send `zoneFloors` alongside a method change if they should move.
 */
export interface HeartRateZoneUpdate {
  /** `"DEFAULT"` (the default) or a sport key. A sport with no profile yet starts from DEFAULT's. */
  sport?: string;
  trainingMethod?: HeartRateZoneMethod;
  maxHeartRate?: number;
  /** Also turns off Garmin's automatic resting-HR updates for this profile. */
  restingHeartRate?: number;
  lactateThresholdHeartRate?: number;
  /** Floors of zones 1-5, in bpm, strictly ascending. */
  zoneFloors?: [number, number, number, number, number];
}

/** `GET /biometric-service/powerZones/sports/all` entry. */
export interface PowerZoneEntry {
  [key: string]: unknown;
}

/** `GET /biometric-service/powerZones/sport/{sport}`. */
export interface PowerZonesForSportResult {
  [key: string]: unknown;
}

/**
 * `aggregation` for `getFunctionalThresholdPowerRange` and `getLactateThreshold`. Case-sensitive:
 * anything else throws `GarminError` before a request is sent.
 */
export type FtpAggregation = "daily" | "weekly" | "monthly" | "yearly";

/** `aggregation` for `getRunningTolerance` — narrower than {@link FtpAggregation}. */
export type RunningToleranceAggregation = "daily" | "weekly";
