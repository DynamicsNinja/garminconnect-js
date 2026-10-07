/**
 * Everything the hosted server hands out — client ids, sign-in form state, codes, access and
 * refresh tokens — is JSON sealed with AES-256-GCM: the MCP client stores it but cannot read or
 * alter it, and the server needs no storage to read it back. The purpose is bound in as AAD, so
 * a token sealed for one use can never pass as another. The first key seals; every key unseals,
 * so a key can be rotated without signing everyone out.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export type Purpose = "client" | "authreq" | "mfa" | "code" | "access" | "refresh";

export interface Unsealed<T> {
  data: T;
  exp?: number;
}

const VERSION = 1;
const IV = 12;
const TAG = 16;
const MAX_TOKEN = 16_384;

export function parseSealKeys(raw: string | undefined): Buffer[] {
  const keys = (raw ?? "").split(",").map((k) => k.trim()).filter(Boolean).map((k) => Buffer.from(k, "base64"));
  if (keys.length === 0) throw new Error("SEAL_KEYS is not set: generate one with `openssl rand -base64 32`");
  keys.forEach((key, i) => {
    if (key.length !== 32) throw new Error(`SEAL_KEYS entry ${i + 1} is ${key.length} bytes; each key must be 32 bytes of base64`);
  });
  return keys;
}

export class Sealer {
  readonly #keys: Buffer[];
  readonly #now: () => number;

  constructor(keys: Buffer[], now: () => number = () => Math.floor(Date.now() / 1000)) {
    if (keys.length === 0) throw new Error("Sealer needs at least one key");
    this.#keys = keys;
    this.#now = now;
  }

  seal(purpose: Purpose, data: unknown, ttlSeconds?: number): string {
    const body: { d: unknown; e?: number } = { d: data };
    if (ttlSeconds !== undefined) body.e = this.#now() + ttlSeconds;
    const iv = randomBytes(IV);
    const cipher = createCipheriv("aes-256-gcm", this.#keys[0]!, iv);
    cipher.setAAD(Buffer.from(purpose));
    const ct = Buffer.concat([cipher.update(deflateRawSync(Buffer.from(JSON.stringify(body)))), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]).toString("base64url");
  }

  /** `null` for anything tampered with, sealed for another purpose or under an unknown key, or expired. */
  unseal<T>(purpose: Purpose, token: unknown): Unsealed<T> | null {
    if (typeof token !== "string" || token.length > MAX_TOKEN) return null;
    const raw = Buffer.from(token, "base64url");
    if (raw.length <= 1 + IV + TAG || raw[0] !== VERSION) return null;
    const iv = raw.subarray(1, 1 + IV);
    const tag = raw.subarray(1 + IV, 1 + IV + TAG);
    const ct = raw.subarray(1 + IV + TAG);
    for (const key of this.#keys) {
      let body: { d: T; e?: number };
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(Buffer.from(purpose));
        decipher.setAuthTag(tag);
        body = JSON.parse(inflateRawSync(Buffer.concat([decipher.update(ct), decipher.final()])).toString("utf8")) as { d: T; e?: number };
      } catch {
        continue; // another key, or tampered
      }
      if (body.e !== undefined && body.e <= this.#now()) return null;
      return body.e === undefined ? { data: body.d } : { data: body.d, exp: body.e };
    }
    return null;
  }

  /** A stable keyed pseudonym, so the grant table never holds a Garmin id. */
  pseudonym(value: string): string {
    return createHmac("sha256", this.#keys[0]!).update(`garmin-user:${value}`).digest("base64url");
  }
}
