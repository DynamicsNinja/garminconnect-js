import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../src/client.js";
import { Garmin } from "../src/garmin.js";
import type { Tokens } from "../src/auth/tokens.js";

let profileCalls = 0;

const server = setupServer(
  http.get("https://connectapi.garmin.com/userprofile-service/socialProfile", () => {
    profileCalls++;
    return HttpResponse.json({
      displayName: "abc-display-name",
      userName: "testuser",
      fullName: "Test User",
      profileId: 1234,
      measurementSystem: "metric",
    });
  }),
);

const tokens: Tokens = {
  oauth1: { oauth_token: "o1", oauth_token_secret: "s1", domain: "garmin.com" },
  oauth2: {
    scope: "CONNECT_READ",
    jti: "j",
    token_type: "Bearer",
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token_expires_in: 7200,
    refresh_token_expires_at: Math.floor(Date.now() / 1000) + 7200,
  },
};

function makeGarmin(): Garmin {
  const client = new GarminClient();
  client.setTokens(tokens);
  return new Garmin(client);
}

beforeEach(() => {
  profileCalls = 0;
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => server.close());

describe("Garmin profile resolution", () => {
  it("returns the display name", async () => {
    await expect(makeGarmin().displayName()).resolves.toBe("abc-display-name");
  });

  it("returns full name, user name and unit system", async () => {
    const g = makeGarmin();
    await expect(g.fullName()).resolves.toBe("Test User");
    await expect(g.userName()).resolves.toBe("testuser");
    await expect(g.unitSystem()).resolves.toBe("metric");
  });

  it("fetches the profile only once", async () => {
    const g = makeGarmin();
    await g.displayName();
    await g.fullName();
    await g.userName();
    expect(profileCalls).toBe(1);
  });

  it("deduplicates concurrent profile lookups", async () => {
    const g = makeGarmin();
    await Promise.all([g.displayName(), g.displayName(), g.fullName()]);
    expect(profileCalls).toBe(1);
  });
});
