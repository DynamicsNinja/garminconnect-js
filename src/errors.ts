export class GarminError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** 401/403, failed SSO, or an expired OAuth1 token. Re-login is required. */
export class GarminAuthError extends GarminError {}

/** Network failure or timeout. */
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
