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
  /**
   * Pause before the SSO widget's credential POST (the fallback when the mobile login is rate
   * limited), in ms. Default: random 3000–8000. Tests pass 0.
   */
  loginDelayMs?: number;
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
  readonly #loginDelayMs: number | undefined;

  constructor(options: GarminClientOptions = {}) {
    this.domain = options.isCn ? "garmin.cn" : "garmin.com";
    this.tokenStore = options.tokenStore ?? new MemoryTokenStore();
    this.#loginDelayMs = options.loginDelayMs;
    this.#fetcher = new Fetcher({
      timeoutMs: options.timeoutMs,
      retries: options.retries,
      backoffMs: options.backoffMs,
      fetchImpl: options.fetchImpl,
    });
  }

  get #ssoContext(): SsoContext {
    return { fetcher: this.#fetcher, domain: this.domain, loginDelayMs: this.#loginDelayMs };
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

  /**
   * Seeds a `Headers` from the caller's headers, then `.set()`s the transport's own on top so
   * they always win regardless of the caller's casing. See the callers' comments.
   */
  #withTransportHeaders(callerHeaders: Record<string, string> | undefined, tokens: Tokens): Headers {
    const headers = new Headers(callerHeaders ?? {});
    headers.set("authorization", authorizationHeader(tokens.oauth2));
    headers.set("User-Agent", API_USER_AGENT);
    return headers;
  }

  async #apiRequest(path: string, options: ApiOptions = {}): Promise<Response> {
    const tokens = await this.#ensureFresh();
    return this.#fetcher.request(`https://connectapi.${this.domain}${path}`, {
      method: options.method,
      params: options.params,
      json: options.json,
      timeoutMs: options.timeoutMs,
      // Caller headers seed a `Headers` object, then the transport's own
      // headers are `.set()` on top. `Headers.set` matches case-insensitively
      // and REPLACES, so a caller-supplied `authorization` — or a
      // differently-cased `Authorization` — can never survive alongside the
      // injected bearer token. Object spread cannot do this: `Authorization`
      // and `authorization` are distinct object keys, and `new Headers()`
      // combines the duplicates with `", "` instead of dropping one.
      headers: this.#withTransportHeaders(options.headers, tokens),
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
    const uploadHeaders = new Headers({ "User-Agent": API_USER_AGENT });
    for (const [key, value] of new Headers(options.headers ?? {})) {
      uploadHeaders.set(key, value);
    }
    uploadHeaders.set("authorization", authorizationHeader(tokens.oauth2));
    const res = await this.#fetcher.request(`https://connectapi.${this.domain}${path}`, {
      method: "POST",
      body: form,
      timeoutMs: options.timeoutMs ?? TRANSFER_DEFAULT_TIMEOUT_MS,
      // Default `User-Agent` first, then caller headers (e.g.
      // `importActivity`'s load-bearing `NK`/`origin`/`User-Agent`
      // overrides — a caller MAY replace the User-Agent), then the
      // transport's own auth header `.set()` last so it can never be
      // replaced. Same case-insensitivity reasoning as `#apiRequest`.
      headers: uploadHeaders,
    });
    return this.#parseBody(res);
  }
}
