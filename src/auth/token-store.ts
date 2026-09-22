import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
      const oauth1: OAuth1Token = {
        oauth_token: String(parsed1["oauth_token"]),
        oauth_token_secret: String(parsed1["oauth_token_secret"]),
        // Python writes null where TS wants undefined.
        mfa_token: (parsed1["mfa_token"] as string | null) ?? undefined,
        mfa_expiration_timestamp:
          (parsed1["mfa_expiration_timestamp"] as string | null) ?? undefined,
        domain: (parsed1["domain"] as string | null) ?? undefined,
      };
      return { oauth1, oauth2: JSON.parse(raw2) as OAuth2Token };
    } catch {
      return null;
    }
  }

  async save(tokens: Tokens): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await Promise.all([
      writeFile(join(this.dir, OAUTH1_FILE), JSON.stringify(tokens.oauth1, null, 2), {
        mode: 0o600,
      }),
      writeFile(join(this.dir, OAUTH2_FILE), JSON.stringify(tokens.oauth2, null, 2), {
        mode: 0o600,
      }),
    ]);
  }

  async clear(): Promise<void> {
    await Promise.all([
      rm(join(this.dir, OAUTH1_FILE), { force: true }),
      rm(join(this.dir, OAUTH2_FILE), { force: true }),
    ]);
  }
}
