import { describe, expect, it } from "vitest";
import { GarminAuthError } from "garminconnect-js";
// eslint-disable-next-line no-restricted-imports
import { garminAuth, isDeadSession } from "../../src/http/garmin-auth.js";
import { fakeFetch, PROFILE_ROUTE, TOKENS } from "../helpers.js";

describe("garminAuth", () => {
  it("reads the profile id with the given tokens", async () => {
    const { fetchImpl } = fakeFetch(PROFILE_ROUTE);
    expect(await garminAuth({ fetchImpl, retries: 0 }).profileId(TOKENS)).toBe("1");
  });

  it("returns fresh tokens untouched when nothing is near expiry", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    expect(await garminAuth({ fetchImpl, retries: 0 }).refresh(TOKENS, 0)).toEqual(TOKENS);
    expect(calls).toEqual([]);
  });
});

describe("isDeadSession", () => {
  it("is true only for a 401 or a 'log in again' auth error", () => {
    expect(isDeadSession(new GarminAuthError("Not authorized for x (401)"))).toBe(true);
    expect(isDeadSession(new GarminAuthError("Refresh token expired; log in again"))).toBe(true);
    expect(isDeadSession(new GarminAuthError("Not authorized for x (403)"))).toBe(false);
    expect(isDeadSession(new Error("Not authorized for x (401)"))).toBe(false);
  });
});
