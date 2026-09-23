import { describe, expect, it } from "vitest";
import {
  authorizationHeader,
  isExpired,
  refreshExpired,
  setExpirations,
  type OAuth2Token,
} from "../../src/auth/tokens.js";

const raw = {
  scope: "CONNECT_READ",
  jti: "abc",
  token_type: "Bearer",
  access_token: "at",
  refresh_token: "rt",
  expires_in: 3600,
  refresh_token_expires_in: 7200,
};

describe("setExpirations", () => {
  it("computes absolute expiry seconds from the relative ones", () => {
    const now = 1_700_000_000_000;
    const token = setExpirations(raw, now);
    expect(token.expires_at).toBe(1_700_000_000 + 3600);
    expect(token.refresh_token_expires_at).toBe(1_700_000_000 + 7200);
  });

  it("preserves the original fields", () => {
    const token = setExpirations(raw, 0);
    expect(token.access_token).toBe("at");
    expect(token.token_type).toBe("Bearer");
  });
});

describe("isExpired", () => {
  const token: OAuth2Token = { ...raw, expires_at: 1_000, refresh_token_expires_at: 2_000 };

  it("is false well before expiry", () => {
    expect(isExpired(token, 60, 900_000)).toBe(false);
  });

  it("is true after expiry", () => {
    expect(isExpired(token, 60, 1_100_000)).toBe(true);
  });

  it("is true inside the safety margin", () => {
    expect(isExpired(token, 60, 970_000)).toBe(true);
  });
});

describe("authorizationHeader", () => {
  it("title-cases the token type", () => {
    const token = setExpirations({ ...raw, token_type: "bearer" }, 0);
    expect(authorizationHeader(token)).toBe("Bearer at");
  });
});

/**
 * I4: both predicates used to do bare arithmetic on `expires_at`. A token whose expiry was lost by
 * a caller-implemented `TokenStore` (a database schema, a field allowlist) produced
 * `NaN <= number` -> `false` -> "not expired", so the client never refreshed and the user was
 * silently logged out roughly every 27 hours. Both now fail CLOSED, which is self-healing: the
 * unknown expiry triggers a refresh that succeeds on a live OAuth1 token.
 */
describe("malformed expiry stamps fail closed", () => {
  const base = setExpirations(raw, 1_700_000_000_000);

  it("isExpired treats a missing expires_at as expired", () => {
    const broken = { ...base, expires_at: undefined } as unknown as OAuth2Token;
    expect(isExpired(broken, 60, 1_700_000_000_000)).toBe(true);
  });

  it("isExpired treats a non-numeric expires_at as expired", () => {
    const broken = { ...base, expires_at: "1700003600" } as unknown as OAuth2Token;
    expect(isExpired(broken, 60, 1_700_000_000_000)).toBe(true);
    expect(isExpired({ ...base, expires_at: NaN }, 60, 1_700_000_000_000)).toBe(true);
  });

  it("refreshExpired treats a missing refresh_token_expires_at as expired", () => {
    const broken = { ...base, refresh_token_expires_at: undefined } as unknown as OAuth2Token;
    expect(refreshExpired(broken, 1_700_000_000_000)).toBe(true);
  });

  it("still reports a well-formed, live token as not expired", () => {
    expect(isExpired(base, 60, 1_700_000_000_000)).toBe(false);
    expect(refreshExpired(base, 1_700_000_000_000)).toBe(false);
  });
});
