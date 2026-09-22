import { GarminAuthError } from "./errors.js";
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
}

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
    const result = await ssoResumeLogin(mfaState, code, { fetcher: this.#fetcher });
    await this.#persist({ oauth1: result.oauth1, oauth2: result.oauth2 });
  }

  /** Returns false when the store holds nothing. */
  async loadTokens(): Promise<boolean> {
    const tokens = await this.tokenStore.load();
    if (!tokens) return false;
    this.#tokens = tokens;
    return true;
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

    // Collapse concurrent refreshes into one exchange.
    this.#refreshing ??= (async () => {
      try {
        const oauth2 = await exchange(tokens.oauth1, this.#ssoContext);
        await this.#persist({ oauth1: tokens.oauth1, oauth2 });
      } catch (cause) {
        await this.tokenStore.clear();
        this.#tokens = null;
        throw new GarminAuthError("Token refresh failed; log in again", { cause });
      } finally {
        this.#refreshing = null;
      }
    })();
    await this.#refreshing;

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
      headers: {
        authorization: authorizationHeader(tokens.oauth2),
        "User-Agent": API_USER_AGENT,
        ...options.headers,
      },
    });
  }

  async connectapi<T = unknown>(path: string, options: ApiOptions = {}): Promise<T | null> {
    const res = await this.#apiRequest(path, options);
    if (res.status === 204) return null;
    const text = await res.text();
    if (text.length === 0) return null;
    return JSON.parse(text) as T;
  }

  async download(path: string, options: ApiOptions = {}): Promise<Buffer> {
    const res = await this.#apiRequest(path, options);
    return Buffer.from(await res.arrayBuffer());
  }

  async upload(
    file: Blob,
    filename: string,
    path = "/upload-service/upload",
  ): Promise<unknown> {
    const tokens = await this.#ensureFresh();
    const form = new FormData();
    form.append("file", file, filename);
    // Content-Type is deliberately unset so fetch adds the multipart boundary.
    const res = await this.#fetcher.request(`https://connectapi.${this.domain}${path}`, {
      method: "POST",
      body: form,
      headers: {
        authorization: authorizationHeader(tokens.oauth2),
        "User-Agent": API_USER_AGENT,
      },
    });
    return res.json();
  }
}
