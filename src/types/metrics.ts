/**
 * Garmin's payload shapes for these endpoints are undocumented upstream —
 * the inventory records only `dict`/`list`/`dict | list` return types, not
 * field-level shapes. Every interface below is deliberately loose (index
 * signatures / `unknown`) rather than guessing fields that were never
 * observed.
 */

/** `GET /metrics-service/metrics/maxmet/daily/{cdate}/{cdate}` and the range variant. */
export interface MaxMetricsResult {
  [key: string]: unknown;
}

/** `GET /biometric-service/stats/functionalThresholdPower/range/{start}/{end}` — upstream types this `dict | list`. */
export type FtpRangeResult = Record<string, unknown> | Record<string, unknown>[];

/**
 * `getLactateThreshold`'s `latest=true` branch. `speed_and_heart_rate` is
 * upstream's own merged-dict field name (kept verbatim, including the
 * snake_case, since it is the literal key upstream returns under).
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

/** `GET /biometric-service/biometric/latestFunctionalThresholdPower/CYCLING` — upstream types this `dict | list`. */
export type CyclingFtpResult = Record<string, unknown> | Record<string, unknown>[];

/** `GET /biometric-service/heartRateZones` entry. */
export interface HeartRateZoneEntry {
  [key: string]: unknown;
}

/** `GET /biometric-service/powerZones/sports/all` entry. */
export interface PowerZoneEntry {
  [key: string]: unknown;
}

/** `GET /biometric-service/powerZones/sport/{sport}`. */
export interface PowerZonesForSportResult {
  [key: string]: unknown;
}
