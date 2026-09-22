import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import type { Tokens } from "../../src/auth/tokens.js";

const seen: { url: string; method: string; body?: unknown }[] = [];

function record(request: Request, body?: unknown) {
  seen.push({ url: request.url, method: request.method, body });
}

const API = "https://connectapi.garmin.com";

const server = setupServer(
  http.get(`${API}/userprofile-service/socialProfile`, () =>
    HttpResponse.json({
      displayName: "abc-display",
      userName: "testuser",
      fullName: "Test User",
      profileId: 1,
    }),
  ),
  http.get(`${API}/usersummary-service/usersummary/daily/abc-display`, ({ request }) => {
    record(request);
    return HttpResponse.json({ totalSteps: 8000, privacyProtected: false });
  }),
  http.get(`${API}/wellness-service/wellness/dailySummaryChart/abc-display`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ startGMT: "2026-09-22T00:00:00", steps: 100 }]);
  }),
  http.get(`${API}/wellness-service/wellness/dailyHeartRate/abc-display`, ({ request }) => {
    record(request);
    return HttpResponse.json({ restingHeartRate: 52 });
  }),
  http.get(`${API}/wellness-service/wellness/dailySleepData/abc-display`, ({ request }) => {
    record(request);
    return HttpResponse.json({ dailySleepDTO: { sleepTimeSeconds: 27000 } });
  }),
  http.get(`${API}/hrv-service/hrv/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ hrvSummary: { weeklyAvg: 45 } });
  }),
  http.get(`${API}/wellness-service/wellness/bodyBattery/reports/daily`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ date: "2026-09-22", charged: 70 }]);
  }),
  http.get(`${API}/activitylist-service/activities/search/activities`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ activityId: 999, activityName: "Morning Run" }]);
  }),
  http.get(`${API}/activity-service/activity/999`, ({ request }) => {
    record(request);
    return HttpResponse.json({ activityId: 999, activityName: "Morning Run" });
  }),
  http.get(`${API}/download-service/files/activity/999`, ({ request }) => {
    record(request);
    return HttpResponse.arrayBuffer(new Uint8Array([70, 73, 84]).buffer);
  }),
  http.get(`${API}/download-service/export/tcx/activity/999`, ({ request }) => {
    record(request);
    return HttpResponse.arrayBuffer(new Uint8Array([84, 67, 88]).buffer);
  }),
  http.get(`${API}/download-service/export/gpx/activity/999`, ({ request }) => {
    record(request);
    return HttpResponse.arrayBuffer(new Uint8Array([60, 63]).buffer);
  }),
  http.get(`${API}/download-service/export/kml/activity/999`, ({ request }) => {
    record(request);
    return HttpResponse.arrayBuffer(new Uint8Array([75, 77, 76]).buffer);
  }),
  http.get(`${API}/download-service/export/csv/activity/999`, ({ request }) => {
    record(request);
    return HttpResponse.arrayBuffer(new Uint8Array([67, 83, 86]).buffer);
  }),
  http.get(`${API}/weight-service/weight/range/2026-09-01/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ dailyWeightSummaries: [] });
  }),
  http.post(`${API}/weight-service/user-weight`, async ({ request }) => {
    record(request, await request.clone().json());
    return HttpResponse.json({ ok: true });
  }),
  http.delete(
    `${API}/weight-service/weight/2026-09-22/byversion/1700000000`,
    ({ request }) => {
      record(request);
      return new HttpResponse(null, { status: 204 });
    },
  ),
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
  // `server.use()` overrides installed by an individual test (e.g. the
  // privacy-protected handler below) persist across tests until explicitly
  // reset — `close()` alone does not clear them, so a later test that hits
  // the same route would otherwise see the wrong handler.
  server.resetHandlers();
  server.close();
});

describe("wellness endpoints", () => {
  it("getUserSummary interpolates the display name and sends calendarDate", async () => {
    const g = makeGarmin();
    await expect(g.getUserSummary("2026-09-22")).resolves.toEqual({
      totalSteps: 8000,
      privacyProtected: false,
    });
    expect(seen[0]!.url).toBe(
      `${API}/usersummary-service/usersummary/daily/abc-display?calendarDate=2026-09-22`,
    );
  });

  it("getStats is an alias of getUserSummary", async () => {
    const g = makeGarmin();
    await expect(g.getStats("2026-09-22")).resolves.toEqual(
      await g.getUserSummary("2026-09-22"),
    );
  });

  it("getUserSummary throws when Garmin marks the response privacy-protected", async () => {
    server.use(
      http.get(`${API}/usersummary-service/usersummary/daily/abc-display`, () =>
        HttpResponse.json({ privacyProtected: true }),
      ),
    );
    await expect(makeGarmin().getUserSummary("2026-09-22")).rejects.toThrow(
      /privacy|Authentication/i,
    );
  });

  it("getStepsData sends date and returns the array", async () => {
    const g = makeGarmin();
    await expect(g.getStepsData("2026-09-22")).resolves.toHaveLength(1);
    expect(seen[0]!.url).toBe(
      `${API}/wellness-service/wellness/dailySummaryChart/abc-display?date=2026-09-22`,
    );
  });

  it("getStepsData returns [] when Garmin sends 204", async () => {
    server.use(
      http.get(
        `${API}/wellness-service/wellness/dailySummaryChart/abc-display`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(makeGarmin().getStepsData("2026-09-22")).resolves.toEqual([]);
  });

  it("getHeartRates sends date", async () => {
    await makeGarmin().getHeartRates("2026-09-22");
    expect(seen[0]!.url).toBe(
      `${API}/wellness-service/wellness/dailyHeartRate/abc-display?date=2026-09-22`,
    );
  });

  it("getSleepData sends date and nonSleepBufferMinutes", async () => {
    await makeGarmin().getSleepData("2026-09-22");
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe("/wellness-service/wellness/dailySleepData/abc-display");
    expect(url.searchParams.get("date")).toBe("2026-09-22");
    expect(url.searchParams.get("nonSleepBufferMinutes")).toBe("60");
  });

  it("getSleepData resolves to null when Garmin sends 204 (no data for an unworn night)", async () => {
    server.use(
      http.get(
        `${API}/wellness-service/wellness/dailySleepData/abc-display`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(makeGarmin().getSleepData("2026-09-22")).resolves.toBeNull();
  });

  it("getHrvData puts the date in the path", async () => {
    await makeGarmin().getHrvData("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/hrv-service/hrv/2026-09-22`);
  });

  it("getBodyBattery defaults the end date to the start date", async () => {
    await makeGarmin().getBodyBattery("2026-09-22");
    const url = new URL(seen[0]!.url);
    expect(url.searchParams.get("startDate")).toBe("2026-09-22");
    expect(url.searchParams.get("endDate")).toBe("2026-09-22");
  });

  it("accepts a Date object anywhere a date string is accepted", async () => {
    await makeGarmin().getUserSummary(new Date("2026-09-22T10:00:00Z"));
    expect(seen[0]!.url).toContain("calendarDate=2026-09-22");
  });

  it("rejects a malformed date before making a request", async () => {
    await expect(makeGarmin().getUserSummary("22/09/2026")).rejects.toThrow(/YYYY-MM-DD/);
    expect(seen).toHaveLength(0);
  });
});

describe("activity endpoints", () => {
  it("getActivities sends start and limit with defaults", async () => {
    await makeGarmin().getActivities();
    const url = new URL(seen[0]!.url);
    expect(url.searchParams.get("start")).toBe("0");
    expect(url.searchParams.get("limit")).toBe("20");
  });

  it("getActivity fetches by id", async () => {
    await expect(makeGarmin().getActivity(999)).resolves.toMatchObject({ activityId: 999 });
  });

  it("downloadActivity defaults to FIT and returns a Buffer", async () => {
    const buf = await makeGarmin().downloadActivity(999);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(seen[0]!.url).toBe(`${API}/download-service/files/activity/999`);
  });

  it.each([
    ["ORIGINAL", `${API}/download-service/files/activity/999`],
    ["TCX", `${API}/download-service/export/tcx/activity/999`],
    ["GPX", `${API}/download-service/export/gpx/activity/999`],
    ["KML", `${API}/download-service/export/kml/activity/999`],
    ["CSV", `${API}/download-service/export/csv/activity/999`],
  ] as const)("downloadActivity uses the correct path for %s", async (format, url) => {
    const buf = await makeGarmin().downloadActivity(999, format);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(seen[0]!.url).toBe(url);
  });

  it("downloadActivity throws GarminError for an unrecognised format", async () => {
    await expect(
      makeGarmin().downloadActivity(999, "BOGUS" as unknown as never),
    ).rejects.toThrow(/Unknown download format/);
    expect(seen).toHaveLength(0);
  });
});

describe("weight endpoints", () => {
  it("getWeighIns builds a range path", async () => {
    await makeGarmin().getWeighIns("2026-09-01", "2026-09-22");
    expect(new URL(seen[0]!.url).pathname).toBe(
      "/weight-service/weight/range/2026-09-01/2026-09-22",
    );
  });

  it("addWeighIn posts grams for a kg value", async () => {
    await makeGarmin().addWeighIn(72.5, "kg");
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toMatchObject({ value: 72500, unitKey: "kg" });
  });

  it("addWeighIn converts lbs to grams", async () => {
    await makeGarmin().addWeighIn(160, "lbs");
    const body = seen[0]!.body as { value: number };
    expect(body.value).toBe(Math.round(160 * 453.592));
  });

  it("deleteWeighIn issues a DELETE and returns null on 204", async () => {
    await expect(makeGarmin().deleteWeighIn("2026-09-22", 1_700_000_000)).resolves.toBeNull();
    expect(seen[0]!.method).toBe("DELETE");
  });
});
