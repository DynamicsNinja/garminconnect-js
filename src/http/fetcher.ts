import {
  GarminAuthError,
  GarminConnectionError,
  GarminHttpError,
  GarminRateLimitError,
} from "../errors.js";
import { CookieJar } from "./cookie-jar.js";

const RETRY_STATUSES = new Set([408, 500, 502, 503, 504]);

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
  headers?: Record<string, string>;
  referer?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Fetcher {
  readonly jar: CookieJar;
  lastUrl: string | undefined;

  readonly #timeoutMs: number;
  readonly #retries: number;
  readonly #backoffMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: FetcherOptions = {}) {
    this.jar = options.jar ?? new CookieJar();
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#retries = options.retries ?? 3;
    this.#backoffMs = options.backoffMs ?? 500;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  async request(url: string, options: RequestOptions = {}): Promise<Response> {
    const target = new URL(url);
    for (const [k, v] of Object.entries(options.params ?? {})) {
      if (v !== undefined) target.searchParams.set(k, String(v));
    }
    const finalUrl = target.toString();

    const headers = new Headers(options.headers ?? {});
    const cookie = this.jar.cookieHeaderFor(finalUrl);
    if (cookie) headers.set("cookie", cookie);
    if (options.referer && this.lastUrl) headers.set("referer", this.lastUrl);

    let body = options.body;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#retries; attempt++) {
      if (attempt > 0) await sleep(this.#backoffMs * 2 ** (attempt - 1));

      let res: Response;
      try {
        res = await this.#fetch(finalUrl, {
          method: options.method ?? "GET",
          headers,
          body,
          redirect: "follow",
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (cause) {
        lastError = cause;
        continue;
      }

      const setCookie = this.#readSetCookie(res);
      if (setCookie.length > 0) this.jar.setFromResponse(finalUrl, setCookie);
      this.lastUrl = res.url || finalUrl;

      if (res.ok) return res;

      if (RETRY_STATUSES.has(res.status) && attempt < this.#retries) {
        continue;
      }
      throw await this.#toError(res, finalUrl);
    }

    throw new GarminConnectionError(
      `Request to ${finalUrl} failed after ${this.#retries + 1} attempts`,
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

  async #toError(res: Response, url: string): Promise<Error> {
    const body = await res.text().catch(() => "");
    if (res.status === 429) {
      const raw = res.headers.get("retry-after");
      const retryAfter = raw && !Number.isNaN(Number(raw)) ? Number(raw) : undefined;
      return new GarminRateLimitError(`Rate limited by Garmin at ${url}`, retryAfter);
    }
    if (res.status === 401 || res.status === 403) {
      return new GarminAuthError(`Not authorized for ${url} (${res.status})`);
    }
    return new GarminHttpError(
      `Request to ${url} failed with ${res.status}`,
      res.status,
      url,
      body,
    );
  }
}
