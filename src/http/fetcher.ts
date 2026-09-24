import {
  GarminAuthError,
  GarminConnectionError,
  GarminHttpError,
  GarminRateLimitError,
} from "../errors.js";
import { CookieJar } from "./cookie-jar.js";

const RETRY_STATUSES = new Set([408, 500, 502, 503, 504]);

/**
 * Methods safe to retry automatically: repeating them has no side effect
 * beyond the first successful application. POST is not idempotent — Garmin
 * may already have processed a write when a 502/503 or network blip hits
 * after the fact, so replaying it would duplicate the write. A caller that
 * knows a specific POST is safe (e.g. it's idempotent in effect on the
 * server) can opt in per-request via `RequestOptions.retry`.
 */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);

export interface FetcherOptions {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  fetchImpl?: typeof fetch;
  jar?: CookieJar;
}

export interface RequestOptions {
  method?: string;
  params?: Record<string, string | number | undefined>;
  body?: RequestInit["body"];
  json?: unknown;
  /**
   * Widened from `Record<string, string>`: callers that must GUARANTEE a header wins
   * (e.g. `GarminClient` injecting the bearer token) build a `Headers` and use `.set()`, which is
   * case-insensitive. Object spread is not — `Authorization` and `authorization` are distinct
   * object keys, and `new Headers()` then COMBINES them with `", "` rather than replacing.
   */
  headers?: RequestInit["headers"];
  referer?: boolean;
  /** Per-request timeout, overriding the Fetcher's default. */
  timeoutMs?: number;
  /**
   * Opt in to retrying a non-idempotent method (i.e. POST) on a retryable
   * status or network error. Idempotent methods (GET/HEAD/PUT/DELETE/OPTIONS)
   * already retry by default and ignore this flag.
   */
  retry?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Fetcher {
  readonly jar: CookieJar;
  lastUrl: string | undefined;

  readonly #options: FetcherOptions;
  readonly #timeoutMs: number;
  readonly #retries: number;
  readonly #backoffMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: FetcherOptions = {}) {
    this.#options = options;
    this.jar = options.jar ?? new CookieJar();
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#retries = options.retries ?? 3;
    this.#backoffMs = options.backoffMs ?? 500;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  /**
   * The same timeouts, retries and `fetchImpl`, with an empty cookie jar. The SSO widget sign-in
   * uses it so cookies left by a failed mobile sign-in never mix into the widget's session.
   */
  withFreshJar(): Fetcher {
    return new Fetcher({ ...this.#options, jar: new CookieJar() });
  }

  async request(url: string, options: RequestOptions = {}): Promise<Response> {
    const target = new URL(url);
    for (const [k, v] of Object.entries(options.params ?? {})) {
      if (v !== undefined) target.searchParams.set(k, String(v));
    }
    const finalUrl = target.toString();
    // Computed once, alongside finalUrl, so every error construction path
    // in this method (including the retry-exhausted branch below) uses it
    // rather than the raw, secret-carrying URL.
    const safeUrl = this.#redactUrl(finalUrl);

    const headers = new Headers(options.headers ?? {});
    const cookie = this.jar.cookieHeaderFor(finalUrl);
    if (cookie) headers.set("cookie", cookie);
    if (options.referer && this.lastUrl) headers.set("referer", this.lastUrl);

    let body = options.body;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }

    const method = options.method ?? "GET";
    const canRetry = IDEMPOTENT_METHODS.has(method.toUpperCase()) || options.retry === true;
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#retries; attempt++) {
      if (attempt > 0) await sleep(this.#backoffMs * 2 ** (attempt - 1));

      let res: Response;
      try {
        res = await this.#fetch(finalUrl, {
          method,
          headers,
          body,
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        lastError = cause;
        if (canRetry && attempt < this.#retries) continue;
        throw new GarminConnectionError(
          `Request to ${safeUrl} failed after ${attempt + 1} attempt${attempt === 0 ? "" : "s"}`,
          { cause: lastError },
        );
      }

      const setCookie = this.#readSetCookie(res);
      if (setCookie.length > 0) this.jar.setFromResponse(finalUrl, setCookie);
      this.lastUrl = res.url || finalUrl;

      if (res.ok) return res;

      if (RETRY_STATUSES.has(res.status) && canRetry && attempt < this.#retries) {
        continue;
      }
      throw await this.#toError(res, safeUrl);
    }

    throw new GarminConnectionError(
      `Request to ${safeUrl} failed after ${this.#retries + 1} attempts`,
      { cause: lastError },
    );
  }

  #readSetCookie(res: Response): string[] {
    const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] })
      .getSetCookie;
    if (typeof getSetCookie === "function") return getSetCookie.call(res.headers);
    const single = res.headers.get("set-cookie");
    return single ? [single] : [];
  }

  /** `safeUrl` must already be redacted (see `#redactUrl`) — callers compute it once. */
  async #toError(res: Response, safeUrl: string): Promise<Error> {
    const body = await res.text().catch(() => "");
    if (res.status === 429) {
      const raw = res.headers.get("retry-after");
      const retryAfter = raw && !Number.isNaN(Number(raw)) ? Number(raw) : undefined;
      return new GarminRateLimitError(`Rate limited by Garmin at ${safeUrl}`, retryAfter);
    }
    if (res.status === 401 || res.status === 403) {
      return new GarminAuthError(`Not authorized for ${safeUrl} (${res.status})`);
    }
    return new GarminHttpError(
      `Request to ${safeUrl} failed with ${res.status}`,
      res.status,
      safeUrl,
      body,
    );
  }

  #redactUrl(url: string): string {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`;
    } catch {
      return url;
    }
  }
}
