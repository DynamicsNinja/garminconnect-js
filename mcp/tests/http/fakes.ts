import { GarminAuthError, type MfaState, type Tokens } from "garminconnect-js";
import type { Response } from "express";
// eslint-disable-next-line no-restricted-imports
import type { GarminAuth } from "../../src/http/garmin-auth.js";
import { TOKENS } from "../helpers.js";

/** Distinctive strings, so a test can prove none of them reach the database file. */
export const SECRET_TOKENS: Tokens = {
  oauth1: { oauth_token: "OAUTH1-TOKEN-SECRET", oauth_token_secret: "OAUTH1-SECRET-SECRET", domain: "garmin.com" },
  oauth2: { ...TOKENS.oauth2, access_token: "OAUTH2-ACCESS-SECRET", refresh_token: "OAUTH2-REFRESH-SECRET" },
};
export const PASSWORD = "right-password";
export const MFA_CODE = "123456";

export interface FakeAuth extends GarminAuth {
  refreshes: number;
  failRefresh: Error | null;
}

/** Any email works with PASSWORD; an email starting "mfa" needs MFA_CODE. Every user is profile 42. */
export function fakeAuth(): FakeAuth {
  const auth: FakeAuth = {
    refreshes: 0,
    failRefresh: null,
    async login(email, password) {
      if (password !== PASSWORD) throw new GarminAuthError("SSO error: INVALID_CREDENTIALS");
      if (email.startsWith("mfa")) return { state: "mfa_required", mfaState: { flow: "mobile", fake: true } as unknown as MfaState };
      return { state: "success", tokens: SECRET_TOKENS };
    },
    async resume(_state, code) {
      if (code !== MFA_CODE) throw new GarminAuthError("SSO error: INVALID_MFA_CODE");
      return SECRET_TOKENS;
    },
    async profileId() {
      return "42";
    },
    async refresh(tokens) {
      auth.refreshes++;
      if (auth.failRefresh) throw auth.failRefresh;
      return { ...tokens, oauth2: { ...tokens.oauth2, access_token: `REFRESHED-${auth.refreshes}` } };
    },
  };
  return auth;
}

export function fakeRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: "",
    status(code: number) { res.statusCode = code; return res; },
    set(headers: Record<string, string>) { Object.assign(res.headers, headers); return res; },
    send(body: string) { res.body = body; return res; },
  };
  return res as typeof res & Response;
}

export const hidden = (page: string, name: string): string | undefined =>
  new RegExp(`name="${name}" value="([^"]*)"`).exec(page)?.[1];
