import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminError } from "../../src/errors.js";
import type { Tokens } from "../../src/auth/tokens.js";

const API = "https://connectapi.garmin.com";
const seen: { url: string; method: string; body?: unknown }[] = [];

function record(request: Request, body?: unknown) {
  seen.push({ url: request.url, method: request.method, body });
}

const server = setupServer(
  http.get(`${API}/userprofile-service/socialProfile`, () =>
    HttpResponse.json({
      displayName: "abc-display",
      userName: "testuser",
      fullName: "Test User",
      profileId: 1,
    }),
  ),

  http.get(`${API}/gcs-golfcommunity/api/v2/scorecard/summary`, ({ request }) => {
    record(request);
    return HttpResponse.json({ pageNumber: 1, rowsPerPage: 10, totalRows: 0 });
  }),

  http.get(`${API}/gcs-golfcommunity/api/v2/scorecard/detail`, ({ request }) => {
    record(request);
    return HttpResponse.json({ scorecardId: 1, holes: [] });
  }),

  http.get(`${API}/gcs-golfcommunity/api/v2/shot/scorecard/:scorecardId/hole`, ({ request }) => {
    record(request);
    return HttpResponse.json({ shots: [] });
  }),

  http.get(`${API}/gcs-golfcommunity/api/v2/club/player`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ id: 6, clubTypeId: 6 }]);
  }),

  http.get(`${API}/gcs-golfcommunity/api/v2/player/stats`, ({ request }) => {
    record(request);
    return HttpResponse.json({ handicap: 12 });
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

describe("getGolfSummary", () => {
  it("hits scorecard/summary with hyphenated per-page/start params, defaults start=0 limit=100", async () => {
    const result = await makeGarmin().getGolfSummary();
    expect(seen[0]!.url).toBe(
      `${API}/gcs-golfcommunity/api/v2/scorecard/summary?per-page=100&start=0`,
    );
    expect(result).toEqual({ pageNumber: 1, rowsPerPage: 10, totalRows: 0 });
  });

  it("passes explicit start/limit through", async () => {
    await makeGarmin().getGolfSummary(5, 20);
    expect(seen[0]!.url).toBe(
      `${API}/gcs-golfcommunity/api/v2/scorecard/summary?per-page=20&start=5`,
    );
  });

  it("rejects a negative start before making a request", async () => {
    await expect(makeGarmin().getGolfSummary(-1)).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });

  it("rejects a non-positive limit before making a request", async () => {
    await expect(makeGarmin().getGolfSummary(0, 0)).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("getGolfScorecard", () => {
  it("hits scorecard/detail with hyphenated scorecard-ids and include-longest-shot-distance=true", async () => {
    const result = await makeGarmin().getGolfScorecard(123);
    expect(seen[0]!.url).toBe(
      `${API}/gcs-golfcommunity/api/v2/scorecard/detail?scorecard-ids=123&include-longest-shot-distance=true`,
    );
    expect(result).toEqual({ scorecardId: 1, holes: [] });
  });
});

describe("getGolfShotData", () => {
  it("omits hole-numbers when not given (fetches all 18)", async () => {
    await makeGarmin().getGolfShotData(123);
    expect(seen[0]!.url).toBe(`${API}/gcs-golfcommunity/api/v2/shot/scorecard/123/hole`);
  });

  it("normalizes comma-separated hole numbers to a hyphenated hole-numbers param", async () => {
    await makeGarmin().getGolfShotData(123, "1,2,3");
    expect(seen[0]!.url).toBe(
      `${API}/gcs-golfcommunity/api/v2/shot/scorecard/123/hole?hole-numbers=1-2-3`,
    );
  });

  it("strips spaces and accepts hyphen separators", async () => {
    await makeGarmin().getGolfShotData(123, "1 - 2, 3");
    expect(seen[0]!.url).toBe(
      `${API}/gcs-golfcommunity/api/v2/shot/scorecard/123/hole?hole-numbers=1-2-3`,
    );
  });

  it("drops the filter entirely (fetches all 18) when any hole number is >9", async () => {
    await makeGarmin().getGolfShotData(123, "9,10");
    expect(seen[0]!.url).toBe(`${API}/gcs-golfcommunity/api/v2/shot/scorecard/123/hole`);
  });

  it("throws on a malformed hole_numbers string before making a request", async () => {
    await expect(makeGarmin().getGolfShotData(123, "abc")).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("getGolfClubStats", () => {
  it("hits club/player with hyphenated per-page/include-stats params, default limit=1000", async () => {
    const result = await makeGarmin().getGolfClubStats();
    expect(seen[0]!.url).toBe(
      `${API}/gcs-golfcommunity/api/v2/club/player?per-page=1000&include-stats=true`,
    );
    expect(result).toEqual([{ id: 6, clubTypeId: 6 }]);
  });

  it("rejects a non-positive limit before making a request", async () => {
    await expect(makeGarmin().getGolfClubStats(0)).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("getGolfUserStats", () => {
  it("hits player/stats with no query params", async () => {
    const result = await makeGarmin().getGolfUserStats();
    expect(seen[0]!.url).toBe(`${API}/gcs-golfcommunity/api/v2/player/stats`);
    expect(result).toEqual({ handicap: 12 });
  });
});
