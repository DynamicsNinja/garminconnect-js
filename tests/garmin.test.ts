import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../src/client.js";
import { Garmin } from "../src/garmin.js";
import type { Tokens } from "../src/auth/tokens.js";

const SOCIAL_PROFILE_URL = "https://connectapi.garmin.com/userprofile-service/socialProfile";
const USER_SETTINGS_URL =
  "https://connectapi.garmin.com/userprofile-service/userprofile/user-settings";

let profileCalls = 0;
let settingsCalls = 0;

const server = setupServer(
  http.get(SOCIAL_PROFILE_URL, () => {
    profileCalls++;
    return HttpResponse.json({
      displayName: "abc-display-name",
      userName: "testuser",
      fullName: "Test User",
      profileId: 1234,
    });
  }),
  http.get(USER_SETTINGS_URL, () => {
    settingsCalls++;
    return HttpResponse.json({
      id: 1234,
      userData: { measurementSystem: "metric" },
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
  settingsCalls = 0;
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("Garmin profile resolution", () => {
  it("returns the display name", async () => {
    await expect(makeGarmin().displayName()).resolves.toBe("abc-display-name");
  });

  it("returns full name and user name", async () => {
    const g = makeGarmin();
    await expect(g.fullName()).resolves.toBe("Test User");
    await expect(g.userName()).resolves.toBe("testuser");
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

  it("resets the cache after a failed fetch, allowing a retry on the same instance", async () => {
    // 400 is not a retried status, so this fails the logical call after
    // exactly one HTTP request; { once: true } means the SECOND call falls
    // through to the healthy default handler registered above.
    server.use(
      http.get(
        SOCIAL_PROFILE_URL,
        () => {
          profileCalls++;
          return HttpResponse.json({ message: "bad request" }, { status: 400 });
        },
        { once: true },
      ),
    );
    const g = makeGarmin();

    await expect(g.displayName()).rejects.toThrow();
    // Proves the failed promise was NOT cached forever: a second call on the
    // same instance retries the fetch and succeeds.
    await expect(g.displayName()).resolves.toBe("abc-display-name");
    expect(profileCalls).toBe(2);
  });

  it("rejects every concurrent caller when the shared profile fetch fails", async () => {
    server.use(
      http.get(
        SOCIAL_PROFILE_URL,
        () => {
          profileCalls++;
          return HttpResponse.json({ message: "bad request" }, { status: 400 });
        },
        { once: true },
      ),
    );
    const g = makeGarmin();

    const results = await Promise.allSettled([g.displayName(), g.fullName()]);
    expect(results[0]?.status).toBe("rejected");
    expect(results[1]?.status).toBe("rejected");
    // Both callers shared the one in-flight fetch, not one hanging behind it.
    expect(profileCalls).toBe(1);
  });

  it("throws when Garmin returns no profile body", async () => {
    server.use(
      http.get(SOCIAL_PROFILE_URL, () => new HttpResponse(null, { status: 204 }), {
        once: true,
      }),
    );
    const g = makeGarmin();

    await expect(g.getUserProfile()).rejects.toThrow(/no user profile/);
  });
});

describe("Garmin unit system", () => {
  it("returns the measurement system from user-settings, not socialProfile", async () => {
    const g = makeGarmin();
    await expect(g.unitSystem()).resolves.toBe("metric");
    expect(settingsCalls).toBe(1);
    expect(profileCalls).toBe(0); // unitSystem() must not touch /socialProfile
  });

  it("returns undefined when userData is absent from the payload", async () => {
    server.use(
      http.get(
        USER_SETTINGS_URL,
        () => {
          settingsCalls++;
          return HttpResponse.json({ id: 1234 });
        },
        { once: true },
      ),
    );
    const g = makeGarmin();

    await expect(g.unitSystem()).resolves.toBeUndefined();
  });

  it("fetches user-settings only once across repeated and concurrent calls", async () => {
    const g = makeGarmin();
    await Promise.all([g.unitSystem(), g.unitSystem()]);
    await g.unitSystem();
    expect(settingsCalls).toBe(1);
  });

  it("resets the cache after a failed user-settings fetch, allowing a retry", async () => {
    server.use(
      http.get(
        USER_SETTINGS_URL,
        () => {
          settingsCalls++;
          return HttpResponse.json({ message: "bad request" }, { status: 400 });
        },
        { once: true },
      ),
    );
    const g = makeGarmin();

    await expect(g.unitSystem()).rejects.toThrow();
    await expect(g.unitSystem()).resolves.toBe("metric");
    expect(settingsCalls).toBe(2);
  });
});
