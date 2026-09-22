import { describe, expect, it } from "vitest";
import {
  authorizationHeader,
  isExpired,
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
