import { GarminError } from "../errors.js";

const SPORT_KEY_RE = /^[A-Z_]+$/;

/**
 * Mirrors upstream `_validate_sport_key`: upper-cases the input and requires it to match
 * `^[A-Z_]+$` afterward. Originally lived in `src/services/metrics.ts` (live-verified there across
 * 20+ read probes covering FTP/power-zone/sport-key endpoints) before being extracted here so
 * `src/services/gear.ts` (which needs the identical rule for `gearType`/`usageType`/`activityType`)
 * could share it instead of duplicating the regex and risking drift between two copies.
 */
export function validateSportKey(sport: string): string {
  const normalized = sport.toUpperCase();
  if (!SPORT_KEY_RE.test(normalized)) {
    throw new GarminError(`Invalid sport key: "${sport}"`);
  }
  return normalized;
}

/**
 * Mirrors upstream `_validate_non_negative_integer`. Extracted here (from `badges.ts`, where it was
 * first written and live-verified) when `goals.ts` needed the same rule — third-copy prevention,
 * same reason `validateSportKey` lives here.
 */
export function validateNonNegativeInteger(value: number, paramName: string): number {
  if (!Number.isInteger(value)) {
    throw new GarminError(`${paramName} must be an integer`);
  }
  if (value < 0) {
    throw new GarminError(`${paramName} must be non-negative, got: ${value}`);
  }
  return value;
}

/** Mirrors upstream `_validate_positive_integer`. See `validateNonNegativeInteger` above. */
export function validatePositiveInteger(value: number, paramName: string): number {
  if (!Number.isInteger(value)) {
    throw new GarminError(`${paramName} must be an integer`);
  }
  if (value <= 0) {
    throw new GarminError(`${paramName} must be a positive integer, got: ${value}`);
  }
  return value;
}

