import { GarminError } from "../errors.js";

const SPORT_KEY_RE = /^[A-Z_]+$/;

/**
 * Upper-cases the input and requires it to match `^[A-Z_]+$` afterward. Shared by
 * `src/services/metrics.ts` (live-verified across 20+ read probes covering FTP/power-zone/sport-key
 * endpoints) and `src/services/gear.ts` (`gearType`/`usageType`/`activityType`), so the two never
 * drift apart.
 */
export function validateSportKey(sport: string): string {
  const normalized = sport.toUpperCase();
  if (!SPORT_KEY_RE.test(normalized)) {
    throw new GarminError(`Invalid sport key: "${sport}"`);
  }
  return normalized;
}

/**
 * Requires an integer >= 0. Shared across services (badges, goals, ...) for the same reason
 * `validateSportKey` lives here.
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

/** Requires an integer > 0. See `validateNonNegativeInteger` above. */
export function validatePositiveInteger(value: number, paramName: string): number {
  if (!Number.isInteger(value)) {
    throw new GarminError(`${paramName} must be an integer`);
  }
  if (value <= 0) {
    throw new GarminError(`${paramName} must be a positive integer, got: ${value}`);
  }
  return value;
}

/**
 * Percent-encodes a single URL path segment before it is interpolated into a request path.
 *
 * Every service in this library builds its path with a template literal (`` `/activity-service/
 * activity/${activityId}` ``), and `Fetcher.request` then hands that string to `new URL()`, which
 * NORMALIZES `..` segments. Without encoding, a caller-controlled id is a path-traversal /
 * request-redirection primitive: `getActivity("../../weight-service/weight/2026-01-01/byversion/
 * 999")` resolved to a completely different Garmin service, carrying the user's bearer token, and
 * `getActivity("1?x=y#frag")` smuggled a query string and fragment into the request. The headline
 * use case for this library is a Next.js route handler forwarding a user-controlled route param,
 * so that is the DEFAULT shape of consuming code, not an exotic one.
 *
 * Encoding is behaviour-preserving for every legitimate value: numeric ids, hex UUIDs,
 * `YYYY-MM-DD` dates and Garmin display names all round-trip through `encodeURIComponent`
 * unchanged.
 */
export function pathSegment(value: string | number): string {
  return encodeURIComponent(String(value));
}

const UUID_HEX_RE = /^[0-9a-fA-F]+$/;

/**
 * Hex characters, hyphens optional (stripped before checking).
 *
 * Originally private to `src/services/gear.ts` and applied at exactly ONE of the eight `gearUUID`
 * interpolation sites (`getGearStats`). Extracted here and applied at all eight so the rule is
 * uniform: a `gearUUID` that reaches a URL has been checked, everywhere. It is a defence in depth
 * alongside `pathSegment` — encoding neutralises injection, validation rejects the value outright.
 */
export function validateUuid(uuid: string): string {
  const stripped = uuid.replace(/-/g, "");
  if (stripped.length === 0 || !UUID_HEX_RE.test(stripped)) {
    throw new GarminError(`Invalid gear UUID: "${uuid}"`);
  }
  return uuid;
}
