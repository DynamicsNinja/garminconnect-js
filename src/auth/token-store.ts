import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OAuth1Token, OAuth2Token, Tokens } from "./tokens.js";

export interface TokenStore {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  #tokens: Tokens | null = null;

  async load(): Promise<Tokens | null> {
    return this.#tokens;
  }
  async save(tokens: Tokens): Promise<void> {
    this.#tokens = tokens;
  }
  async clear(): Promise<void> {
    this.#tokens = null;
  }
}

const OAUTH1_FILE = "oauth1_token.json";
const OAUTH2_FILE = "oauth2_token.json";

/** garth-compatible on-disk format: tokens written by Python garth load directly. */
export class FileTokenStore implements TokenStore {
  constructor(private readonly dir: string) {}

  async load(): Promise<Tokens | null> {
    try {
      const [raw1, raw2] = await Promise.all([
        readFile(join(this.dir, OAUTH1_FILE), "utf8"),
        readFile(join(this.dir, OAUTH2_FILE), "utf8"),
      ]);
      const parsed1 = JSON.parse(raw1) as Record<string, unknown>;
      const parsed2 = JSON.parse(raw2) as Record<string, unknown>;

      // Validate required OAuth1 fields are present and non-empty.
      const token1 = parsed1["oauth_token"];
      const secret1 = parsed1["oauth_token_secret"];
      if (typeof token1 !== "string" || !token1 || typeof secret1 !== "string" || !secret1) {
        return null;
      }

      // Validate required OAuth2 fields are present and non-empty.
      const access2 = parsed2["access_token"];
      const refresh2 = parsed2["refresh_token"];
      if (typeof access2 !== "string" || !access2 || typeof refresh2 !== "string" || !refresh2) {
        return null;
      }

      // The two expiry stamps are validated too, not just the token strings. They drive every
      // refresh decision (`isExpired`/`refreshExpired`), and a file missing or corrupting them
      // used to slip through the `as unknown as OAuth2Token` cast below and produce a token the
      // client could never decide about. Those predicates now fail closed, but rejecting the
      // whole file here is better still: `loadTokens()` returns `false` and the caller is told to
      // log in, rather than the client carrying a half-valid token around.
      const expiresAt = parsed2["expires_at"];
      const refreshExpiresAt = parsed2["refresh_token_expires_at"];
      if (!Number.isFinite(expiresAt) || !Number.isFinite(refreshExpiresAt)) {
        return null;
      }

      const oauth1: OAuth1Token = {
        oauth_token: token1,
        oauth_token_secret: secret1,
        // Python writes null where TS wants undefined.
        mfa_token: (parsed1["mfa_token"] as string | null) ?? undefined,
        mfa_expiration_timestamp:
          (parsed1["mfa_expiration_timestamp"] as string | null) ?? undefined,
        domain: (parsed1["domain"] as string | null) ?? undefined,
      };
      return { oauth1, oauth2: parsed2 as unknown as OAuth2Token };
    } catch {
      return null;
    }
  }

  async save(tokens: Tokens): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    // Unique per call (pid + random suffix) so two processes sharing a
    // token directory (a cron refresher beside a web server, two Node
    // workers) can never interleave writes to the same temp file and
    // persist a torn pair; the catch block below only ever cleans up the
    // temp files THIS call created.
    const suffix = `${process.pid}-${Math.random().toString(36).slice(2)}`;
    const tmp1 = join(this.dir, `${OAUTH1_FILE}.${suffix}.tmp`);
    const tmp2 = join(this.dir, `${OAUTH2_FILE}.${suffix}.tmp`);

    try {
      // Write both temp files first with 0o600 permissions.
      await Promise.all([
        writeFile(tmp1, JSON.stringify(tokens.oauth1, null, 2), { mode: 0o600 }),
        writeFile(tmp2, JSON.stringify(tokens.oauth2, null, 2), { mode: 0o600 }),
      ]);

      // Then atomically rename both temp files into place.
      await Promise.all([
        rename(tmp1, join(this.dir, OAUTH1_FILE)),
        rename(tmp2, join(this.dir, OAUTH2_FILE)),
      ]);
    } catch (err) {
      // Clean up temp files if something went wrong.
      await Promise.all([
        rm(tmp1, { force: true }),
        rm(tmp2, { force: true }),
      ]);
      throw err;
    }
  }

  async clear(): Promise<void> {
    await Promise.all([
      rm(join(this.dir, OAUTH1_FILE), { force: true }),
      rm(join(this.dir, OAUTH2_FILE), { force: true }),
    ]);
  }
}
