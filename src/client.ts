import { GarminAuthError, GarminError } from "./errors.js";
import { Fetcher } from "./http/fetcher.js";
import { API_USER_AGENT } from "./auth/constants.js";
import {
  exchange,
  login as ssoLogin,
  resumeLogin as ssoResumeLogin,
  type LoginResult,
  type MfaState,
  type SsoContext,
} from "./auth/sso.js";
import {
  authorizationHeader,
  isExpired,
  refreshExpired,
  type Tokens,
} from "./auth/tokens.js";
import { MemoryTokenStore, type TokenStore } from "./auth/token-store.js";

export interface GarminClientOptions {
  tokenStore?: TokenStore;
  isCn?: boolean;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ApiOptions {
  method?: string;
  params?: Record<string, string | number | undefined>;
  json?: unknown;
  headers?: Record<string, string>;
  /** Per-request timeout, overriding the client's default (10s). */
  timeoutMs?: number;
}

/**
 * `download()`/`upload()` move binary payloads (FIT files, images) rather
 * than a small JSON body, so they get a longer default timeout than the
 * client's general-purpose 10s — a caller on a slow link can still override
 * it via `ApiOptions.timeoutMs`.
 */
const TRANSFER_DEFAULT_TIMEOUT_MS = 60_000;

export class GarminClient {
  readonly domain: string;
  readonly tokenStore: TokenStore;

  #fetcher: Fetcher;
  #tokens: Tokens | null = null;
  #refreshing: Promise<void> | null = null;

  constructor(options: GarminClientOptions = {}) {
    this.domain = options.isCn ? "garmin.cn" : "garmin.com";
    this.tokenStore = options.tokenStore ?? new MemoryTokenStore();
    this.#fetcher = new Fetcher({
      timeoutMs: options.timeoutMs,
      retries: options.retries,
      backoffMs: options.backoffMs,
      fetchImpl: options.fetchImpl,
    });
  }

  get #ssoContext(): SsoContext {
    return { fetcher: this.#fetcher, domain: this.domain };
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const result = await ssoLogin(email, password, this.#ssoContext);
    if (result.state === "success") {
      await this.#persist({ oauth1: result.oauth1, oauth2: result.oauth2 });
    }
    return result;
  }

  async resumeLogin(mfaState: MfaState, code: string): Promise<void> {
    this.#checkDomain(mfaState.domain);
    const result = await ssoResumeLogin(mfaState, code, { fetcher: this.#fetcher });
    await this.#persist({ oauth1: result.oauth1, oauth2: result.oauth2 });
  }

  /** Returns false when the store holds nothing. */
  async loadTokens(): Promise<boolean> {
    const tokens = await this.tokenStore.load();
    if (!tokens) return false;
    this.#checkDomain(tokens.oauth1.domain);
    this.#tokens = tokens;
    return true;
  }

  /**
   * A `.cn` MFA state resumed on a default `.com` client (or vice versa)
   * mints tokens whose signed `oauth_token` is scoped to the wrong SSO
   * realm, but every later request would still be sent to *this* client's
   * `connectapi.<domain>` — a mismatch severe enough to fail loudly rather
   * than surface as a confusing downstream 401. Tokens with no domain
   * recorded (e.g. hand-constructed, or from an older on-disk format) are
   * accepted as-is.
   */
  #checkDomain(tokenDomain: string | undefined): void {
    if (tokenDomain && tokenDomain !== this.domain) {
      throw new GarminAuthError(
        `Token domain ${tokenDomain} does not match client domain ${this.domain}; ` +
          `construct the client with isCn: ${tokenDomain === "garmin.cn"}`,
      );
    }
  }

  setTokens(tokens: Tokens): void {
    this.#tokens = tokens;
  }

  getTokens(): Tokens | null {
    return this.#tokens;
  }

  async #persist(tokens: Tokens): Promise<void> {
    this.#tokens = tokens;
    await this.tokenStore.save(tokens);
  }

  async #ensureFresh(): Promise<Tokens> {
    const tokens = this.#tokens;
    if (!tokens) {
      throw new GarminAuthError("Not authenticated: call login() or loadTokens() first");
    }
    if (!isExpired(tokens.oauth2)) return tokens;

    if (refreshExpired(tokens.oauth2)) {
      await this.tokenStore.clear();
      this.#tokens = null;
      throw new GarminAuthError("Refresh token expired; log in again");
    }

    // Collapse concurrent refreshes into one exchange. Captured into a local
    // immediately after the assignment so a later `await` can never observe
    // a `this.#refreshing` that a concurrent `finally` has already reset to
    // null out from under us.
    const refreshing = (this.#refreshing ??= (async () => {
      try {
        const oauth2 = await exchange(tokens.oauth1, this.#ssoContext);
        await this.#persist({ oauth1: tokens.oauth1, oauth2 });
      } catch (cause) {
        // Only a dead credential (Garmin returning 401/403, which the
        // Fetcher already maps to GarminAuthError) justifies destroying the
        // user's saved tokens. A transient failure — a DNS blip, a timeout,
        // a 5xx, a 429 — must not force a full interactive re-login: leave
        // the store untouched and let the error propagate so the caller can
        // retry later.
        if (cause instanceof GarminAuthError) {
          await this.tokenStore.clear();
          this.#tokens = null;
        }
        throw cause;
      } finally {
        // Reset unconditionally (success or failure) so a failed refresh
        // never wedges the client: the next call always tries again rather
        // than re-serving this rejected promise forever.
        this.#refreshing = null;
      }
    })());
    await refreshing;

    const refreshed = this.#tokens;
    if (!refreshed) throw new GarminAuthError("Token refresh failed; log in again");
    return refreshed;
  }

  async #apiRequest(path: string, options: ApiOptions = {}): Promise<Response> {
    const tokens = await this.#ensureFresh();
    return this.#fetcher.request(`https://connectapi.${this.domain}${path}`, {
      method: options.method,
      params: options.params,
      json: options.json,
      timeoutMs: options.timeoutMs,
      headers: {
        // Caller headers are spread first so the transport's own auth
        // header always wins — a caller-supplied `headers.authorization`
        // (or a differently-cased `Authorization`) can never replace the
        // bearer token this method injects.
        ...options.headers,
        authorization: authorizationHeader(tokens.oauth2),
        "User-Agent": API_USER_AGENT,
      },
    });
  }

  /**
   * Parses a JSON body, returning `null` for a 204 or an empty body. A 200
   * with a non-JSON body (e.g. an HTML Cloudflare challenge page) is turned
   * into a `GarminError` instead of letting a bare `SyntaxError` escape.
   */
  async #parseBody<T>(res: Response): Promise<T | null> {
    if (res.status === 204) return null;
    const text = await res.text();
    if (text.length === 0) return null;
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new GarminError("Garmin API returned a non-JSON response", { cause });
    }
  }

  async connectapi<T = unknown>(path: string, options: ApiOptions = {}): Promise<T | null> {
    const res = await this.#apiRequest(path, options);
    return this.#parseBody<T>(res);
  }

  async download(path: string, options: ApiOptions = {}): Promise<Buffer> {
    const res = await this.#apiRequest(path, {
      ...options,
      timeoutMs: options.timeoutMs ?? TRANSFER_DEFAULT_TIMEOUT_MS,
    });
    return Buffer.from(await res.arrayBuffer());
  }

  async upload(
    file: Blob,
    filename: string,
    path = "/upload-service/upload",
    options: Pick<ApiOptions, "timeoutMs" | "headers"> = {},
  ): Promise<unknown> {
    const tokens = await this.#ensureFresh();
    const form = new FormData();
    form.append("file", file, filename);
    // Content-Type is deliberately unset so fetch adds the multipart boundary.
    const res = await this.#fetcher.request(`https://connectapi.${this.domain}${path}`, {
      method: "POST",
      body: form,
      timeoutMs: options.timeoutMs ?? TRANSFER_DEFAULT_TIMEOUT_MS,
      headers: {
        // Defaults first, then caller headers (e.g. `importActivity`'s
        // load-bearing `NK`/`origin`/`User-Agent` overrides), then the
        // transport's own auth header last so it can never be replaced —
        // same ordering rule as `#apiRequest`.
        "User-Agent": API_USER_AGENT,
        ...options.headers,
        authorization: authorizationHeader(tokens.oauth2),
      },
    });
    return this.#parseBody(res);
  }
}
