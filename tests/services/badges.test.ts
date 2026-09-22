import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminError } from "../../src/errors.js";
import type { Tokens } from "../../src/auth/tokens.js";

const API = "https://connectapi.garmin.com";
const seen: { url: string; method: string }[] = [];

function record(request: Request) {
  seen.push({ url: request.url, method: request.method });
}

const server = setupServer(
  http.get(`${API}/userprofile-service/socialProfile`, () =>
    HttpResponse.json({ displayName: "abc-display", userName: "testuser", fullName: "Test User", profileId: 1 }),
  ),
  http.get(`${API}/badge-service/badge/earned`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ badgeId: 1, badgeName: "earned-1" }]);
  }),
  http.get(`${API}/badge-service/badge/available`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ badgeId: 2, badgeName: "available-1" }]);
  }),
  // These four "dict-labelled" endpoints are live-verified (Task 9 smoke run against the test
  // account) to return a JSON ARRAY, not an object — see the file-level comment in
  // src/types/badges.ts. Mocked as arrays here so the mock cannot mask that same "dict but
  // actually an array" mistake seen previously in the gear service.
  http.get(`${API}/adhocchallenge-service/adHocChallenge/historical`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ challengeId: 1 }]);
  }),
  http.get(`${API}/badgechallenge-service/badgeChallenge/completed`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ badgeChallengeId: 2 }]);
  }),
  http.get(`${API}/badgechallenge-service/badgeChallenge/available`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ badgeChallengeId: 3 }]);
  }),
  http.get(`${API}/badgechallenge-service/badgeChallenge/non-completed`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ badgeChallengeId: 4 }]);
  }),
  http.get(`${API}/badgechallenge-service/virtualChallenge/inProgress`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ virtualChallengeId: 5 }]);
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
  seen.length = 0;
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("badges", () => {
  it("getEarnedBadges composes the exact URL and passes the array through", async () => {
    const g = makeGarmin();
    const result = await g.getEarnedBadges();
    expect(seen[0]!.url).toBe(`${API}/badge-service/badge/earned`);
    expect(seen[0]!.method).toBe("GET");
    expect(result).toEqual([{ badgeId: 1, badgeName: "earned-1" }]);
  });

  it("getEarnedBadges stays null (not coalesced to []) on an empty body", async () => {
    server.use(
      http.get(`${API}/badge-service/badge/earned`, () => new HttpResponse(null, { status: 204 })),
    );
    const g = makeGarmin();
    const result = await g.getEarnedBadges();
    expect(result).toBeNull();
  });

  it("getAvailableBadges composes the exact URL with showExclusiveBadge=true", async () => {
    const g = makeGarmin();
    const result = await g.getAvailableBadges();
    expect(seen[0]!.url).toBe(`${API}/badge-service/badge/available?showExclusiveBadge=true`);
    expect(result).toEqual([{ badgeId: 2, badgeName: "available-1" }]);
  });

  it("getAvailableBadges stays null (not coalesced to []) on an empty body", async () => {
    server.use(
      http.get(`${API}/badge-service/badge/available`, () => new HttpResponse(null, { status: 204 })),
    );
    const g = makeGarmin();
    const result = await g.getAvailableBadges();
    expect(result).toBeNull();
  });

  describe("getInProgressBadges (client-side composition, no HTTP path of its own)", () => {
    it("calls both getEarnedBadges and getAvailableBadges", async () => {
      server.use(
        http.get(`${API}/badge-service/badge/earned`, ({ request }) => {
          record(request);
          return HttpResponse.json([]);
        }),
        http.get(`${API}/badge-service/badge/available`, ({ request }) => {
          record(request);
          return HttpResponse.json([]);
        }),
      );
      const g = makeGarmin();
      await g.getInProgressBadges();
      const urls = seen.map((s) => s.url).sort();
      expect(urls).toEqual(
        [
          `${API}/badge-service/badge/earned`,
          `${API}/badge-service/badge/available?showExclusiveBadge=true`,
        ].sort(),
      );
    });

    it("filters out badges with no progress (falsy badgeProgressValue)", async () => {
      server.use(
        http.get(`${API}/badge-service/badge/earned`, () =>
          HttpResponse.json([{ badgeId: 1, badgeProgressValue: 0, badgeTargetValue: 10 }]),
        ),
        http.get(`${API}/badge-service/badge/available`, () => HttpResponse.json([])),
      );
      const g = makeGarmin();
      const result = await g.getInProgressBadges();
      expect(result).toEqual([]);
    });

    it("includes a badge whose progress has not yet reached its target", async () => {
      server.use(
        http.get(`${API}/badge-service/badge/earned`, () =>
          HttpResponse.json([{ badgeId: 1, badgeProgressValue: 5, badgeTargetValue: 10 }]),
        ),
        http.get(`${API}/badge-service/badge/available`, () => HttpResponse.json([])),
      );
      const g = makeGarmin();
      const result = await g.getInProgressBadges();
      expect(result).toEqual([{ badgeId: 1, badgeProgressValue: 5, badgeTargetValue: 10 }]);
    });

    it("excludes a badge that reached its target with no badgeLimitCount", async () => {
      server.use(
        http.get(`${API}/badge-service/badge/earned`, () =>
          HttpResponse.json([{ badgeId: 1, badgeProgressValue: 10, badgeTargetValue: 10 }]),
        ),
        http.get(`${API}/badge-service/badge/available`, () => HttpResponse.json([])),
      );
      const g = makeGarmin();
      const result = await g.getInProgressBadges();
      expect(result).toEqual([]);
    });

    it("includes a repeatable badge that reached its target but not its badgeLimitCount", async () => {
      server.use(
        http.get(`${API}/badge-service/badge/earned`, () =>
          HttpResponse.json([
            {
              badgeId: 1,
              badgeProgressValue: 10,
              badgeTargetValue: 10,
              badgeLimitCount: 3,
              badgeEarnedNumber: 1,
            },
          ]),
        ),
        http.get(`${API}/badge-service/badge/available`, () => HttpResponse.json([])),
      );
      const g = makeGarmin();
      const result = await g.getInProgressBadges();
      expect(result).toEqual([
        { badgeId: 1, badgeProgressValue: 10, badgeTargetValue: 10, badgeLimitCount: 3, badgeEarnedNumber: 1 },
      ]);
    });

    it("excludes a repeatable badge that has fully exhausted its badgeLimitCount", async () => {
      server.use(
        http.get(`${API}/badge-service/badge/earned`, () =>
          HttpResponse.json([
            {
              badgeId: 1,
              badgeProgressValue: 10,
              badgeTargetValue: 10,
              badgeLimitCount: 3,
              badgeEarnedNumber: 3,
            },
          ]),
        ),
        http.get(`${API}/badge-service/badge/available`, () => HttpResponse.json([])),
      );
      const g = makeGarmin();
      const result = await g.getInProgressBadges();
      expect(result).toEqual([]);
    });

    it("merges earned and available keyed by badgeId, available overwriting earned on collision", async () => {
      server.use(
        http.get(`${API}/badge-service/badge/earned`, () =>
          HttpResponse.json([
            { badgeId: 1, badgeProgressValue: 5, badgeTargetValue: 10, source: "earned" },
            { badgeId: 2, badgeProgressValue: 3, badgeTargetValue: 10, source: "earned" },
          ]),
        ),
        http.get(`${API}/badge-service/badge/available`, () =>
          HttpResponse.json([{ badgeId: 1, badgeProgressValue: 8, badgeTargetValue: 10, source: "available" }]),
        ),
      );
      const g = makeGarmin();
      const result = await g.getInProgressBadges();
      // Map (like Python's dict) keeps a key's original insertion position when the key is
      // re-set, so badgeId 1 stays first (with its value updated to the "available" entry) and
      // badgeId 2 stays second — matching upstream's `combined.update(...)` dict semantics.
      expect(result).toEqual([
        { badgeId: 1, badgeProgressValue: 8, badgeTargetValue: 10, source: "available" },
        { badgeId: 2, badgeProgressValue: 3, badgeTargetValue: 10, source: "earned" },
      ]);
    });

    it("never raises when both upstream calls return null (204)", async () => {
      server.use(
        http.get(`${API}/badge-service/badge/earned`, () => new HttpResponse(null, { status: 204 })),
        http.get(`${API}/badge-service/badge/available`, () => new HttpResponse(null, { status: 204 })),
      );
      const g = makeGarmin();
      const result = await g.getInProgressBadges();
      expect(result).toEqual([]);
    });
  });

  it("getAdhocChallenges composes the exact URL with stringified start/limit", async () => {
    const g = makeGarmin();
    const result = await g.getAdhocChallenges(0, 10);
    expect(seen[0]!.url).toBe(`${API}/adhocchallenge-service/adHocChallenge/historical?start=0&limit=10`);
    expect(result).toEqual([{ challengeId: 1 }]);
  });

  it("getAdhocChallenges throws on a negative start", async () => {
    const g = makeGarmin();
    await expect(g.getAdhocChallenges(-1, 10)).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });

  it("getAdhocChallenges throws on a non-positive limit", async () => {
    const g = makeGarmin();
    await expect(g.getAdhocChallenges(0, 0)).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });

  it("getBadgeChallenges composes the exact URL with stringified start/limit", async () => {
    const g = makeGarmin();
    const result = await g.getBadgeChallenges(0, 10);
    expect(seen[0]!.url).toBe(`${API}/badgechallenge-service/badgeChallenge/completed?start=0&limit=10`);
    expect(result).toEqual([{ badgeChallengeId: 2 }]);
  });

  it("getAvailableBadgeChallenges composes the exact URL with stringified start/limit", async () => {
    const g = makeGarmin();
    const result = await g.getAvailableBadgeChallenges(0, 10);
    expect(seen[0]!.url).toBe(`${API}/badgechallenge-service/badgeChallenge/available?start=0&limit=10`);
    expect(result).toEqual([{ badgeChallengeId: 3 }]);
  });

  it("getNonCompletedBadgeChallenges composes the exact URL with stringified start/limit", async () => {
    const g = makeGarmin();
    const result = await g.getNonCompletedBadgeChallenges(0, 10);
    expect(seen[0]!.url).toBe(`${API}/badgechallenge-service/badgeChallenge/non-completed?start=0&limit=10`);
    expect(result).toEqual([{ badgeChallengeId: 4 }]);
  });

  it("getInprogressVirtualChallenges composes the exact URL with stringified start/limit", async () => {
    const g = makeGarmin();
    const result = await g.getInprogressVirtualChallenges(1, 10);
    expect(seen[0]!.url).toBe(`${API}/badgechallenge-service/virtualChallenge/inProgress?start=1&limit=10`);
    expect(result).toEqual([{ virtualChallengeId: 5 }]);
  });

  it("getInprogressVirtualChallenges rejects start=0 (asymmetric: positive, not just non-negative)", async () => {
    const g = makeGarmin();
    await expect(g.getInprogressVirtualChallenges(0, 10)).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });

  it("getInprogressVirtualChallenges throws on a non-positive limit", async () => {
    const g = makeGarmin();
    await expect(g.getInprogressVirtualChallenges(1, 0)).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});
