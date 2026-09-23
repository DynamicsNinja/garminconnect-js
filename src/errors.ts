export class GarminError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** 401/403, failed SSO, or an expired OAuth1 token. Re-login is required. */
export class GarminAuthError extends GarminError {}

/**
 * Network failure or timeout, after retries — PLUS a small set of semantic HTTP statuses that a
 * few services deliberately re-raise as this class to mirror upstream python-garminconnect:
 *
 *  - `importActivity` — EVERY HTTP error, not just the 409 ("Activity already exists
 *    (duplicate): ..."): it wraps any `GarminHttpError` as `Import error: ...`, so a 400 or a
 *    413 from an import arrives as this class too
 *  - `addGearToActivity` / `removeGearFromActivity` / `setGearDefault` — a 404
 *    ("gear not found (likely retired/removed)")
 *  - `getDeviceSolarData` — a falsy response or one missing `deviceSolarInput`
 *
 * Those are PERMANENT conditions, not transient ones. A consumer writing
 * `if (e instanceof GarminConnectionError) retryWithBackoff()` would spin forever on them, so
 * inspect the message (or the `cause`, which carries the original `GarminHttpError`) before
 * deciding to retry. Splitting these into a separate class would be a behaviour change; it is
 * recorded as a post-0.1.0 candidate instead.
 */
export class GarminConnectionError extends GarminError {}

/** 429. `retryAfter` is seconds, taken from the Retry-After header when present. */
export class GarminRateLimitError extends GarminError {
  constructor(
    message: string,
    readonly retryAfter?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Any other non-2xx response. */
export class GarminHttpError extends GarminError {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly body: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
