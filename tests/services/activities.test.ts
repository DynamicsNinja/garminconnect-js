import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminConnectionError, GarminError } from "../../src/errors.js";
import type { Tokens } from "../../src/auth/tokens.js";

const API = "https://connectapi.garmin.com";
const seen: { url: string; method: string; body?: unknown; headers?: Record<string, string> }[] =
  [];

function record(request: Request, body?: unknown) {
  seen.push({
    url: request.url,
    method: request.method,
    body,
    headers: Object.fromEntries(request.headers.entries()),
  });
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
  http.get(`${API}/activitylist-service/activities/count`, ({ request }) => {
    record(request);
    return HttpResponse.json({ totalCount: 42 });
  }),
  http.get(`${API}/mobile-gateway/heartRate/forDate/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ ok: true });
  }),
  http.get(`${API}/activitylist-service/activities/search/activities`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ activityId: 111, activityName: "Evening Run" }]);
  }),
  http.get(`${API}/activity-service/activity/activityTypes`, ({ request }) => {
    record(request);
    return HttpResponse.json({ types: [] });
  }),
  http.delete(`${API}/activity-service/activity/555`, ({ request }) => {
    record(request);
    return new HttpResponse(null, { status: 204 });
  }),
  http.put(`${API}/activity-service/activity/555`, async ({ request }) => {
    record(request, await request.clone().json());
    return HttpResponse.json({ activityId: 555 });
  }),
  http.post(`${API}/activity-service/activity`, async ({ request }) => {
    record(request, await request.clone().json());
    return HttpResponse.json({ activityId: 777 });
  }),
  http.post(`${API}/upload-service/upload/gpx`, async ({ request }) => {
    record(request);
    const form = await request.formData();
    const file = form.get("file") as File;
    return HttpResponse.json({ fileName: file.name, status: "uploaded" });
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

describe("countActivities", () => {
  it("hits the count endpoint and returns totalCount, not the envelope", async () => {
    await expect(makeGarmin().countActivities()).resolves.toBe(42);
    expect(seen[0]!.url).toBe(`${API}/activitylist-service/activities/count`);
    expect(seen[0]!.method).toBe("GET");
  });

  it("throws GarminError when totalCount is missing", async () => {
    server.use(
      http.get(`${API}/activitylist-service/activities/count`, () => HttpResponse.json({})),
    );
    await expect(makeGarmin().countActivities()).rejects.toThrow(
      /No activities count data received/,
    );
  });

  it("throws GarminError on a 204", async () => {
    server.use(
      http.get(
        `${API}/activitylist-service/activities/count`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(makeGarmin().countActivities()).rejects.toThrow(GarminError);
  });
});

describe("getActivitiesForDate", () => {
  it("formats the date into the path", async () => {
    await expect(makeGarmin().getActivitiesForDate("2026-09-22")).resolves.toEqual({ ok: true });
    expect(seen[0]!.url).toBe(`${API}/mobile-gateway/heartRate/forDate/2026-09-22`);
  });

  it("rejects a malformed date before making a request", async () => {
    await expect(makeGarmin().getActivitiesForDate("22/09/2026")).rejects.toThrow(/YYYY-MM-DD/);
    expect(seen).toHaveLength(0);
  });
});

describe("getLastActivity", () => {
  it("requests start=0, limit=1 and returns the last element", async () => {
    await expect(makeGarmin().getLastActivity()).resolves.toEqual({
      activityId: 111,
      activityName: "Evening Run",
    });
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe("/activitylist-service/activities/search/activities");
    expect(url.searchParams.get("start")).toBe("0");
    expect(url.searchParams.get("limit")).toBe("1");
  });

  it("returns null when there are no activities", async () => {
    server.use(
      http.get(`${API}/activitylist-service/activities/search/activities`, () =>
        HttpResponse.json([]),
      ),
    );
    await expect(makeGarmin().getLastActivity()).resolves.toBeNull();
  });
});

describe("getActivityTypes", () => {
  it("hits the activityTypes endpoint", async () => {
    await expect(makeGarmin().getActivityTypes()).resolves.toEqual({ types: [] });
    expect(seen[0]!.url).toBe(`${API}/activity-service/activity/activityTypes`);
  });

  it("passes through null unchecked on a 204", async () => {
    server.use(
      http.get(
        `${API}/activity-service/activity/activityTypes`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(makeGarmin().getActivityTypes()).resolves.toBeNull();
  });
});

describe("deleteActivity", () => {
  it("issues a DELETE to the activity path", async () => {
    await expect(makeGarmin().deleteActivity(555)).resolves.toBeNull();
    expect(seen[0]!.url).toBe(`${API}/activity-service/activity/555`);
    expect(seen[0]!.method).toBe("DELETE");
  });
});

describe("setActivityName", () => {
  it("PUTs activityId and activityName", async () => {
    await expect(makeGarmin().setActivityName(555, "New Title")).resolves.toEqual({
      activityId: 555,
    });
    expect(seen[0]!.url).toBe(`${API}/activity-service/activity/555`);
    expect(seen[0]!.method).toBe("PUT");
    expect(seen[0]!.body).toEqual({ activityId: 555, activityName: "New Title" });
  });
});

describe("setActivityType", () => {
  it("PUTs activityTypeDTO", async () => {
    await makeGarmin().setActivityType(555, 3, "cycling", 17);
    expect(seen[0]!.url).toBe(`${API}/activity-service/activity/555`);
    expect(seen[0]!.method).toBe("PUT");
    expect(seen[0]!.body).toEqual({
      activityId: 555,
      activityTypeDTO: { typeId: 3, typeKey: "cycling", parentTypeId: 17 },
    });
  });
});

describe("setActivityDescription", () => {
  it("PUTs activityId and description", async () => {
    await makeGarmin().setActivityDescription(555, "Great run");
    expect(seen[0]!.url).toBe(`${API}/activity-service/activity/555`);
    expect(seen[0]!.method).toBe("PUT");
    expect(seen[0]!.body).toEqual({ activityId: 555, description: "Great run" });
  });
});

describe("createManualActivityFromJson", () => {
  it("POSTs the caller-supplied payload verbatim", async () => {
    const payload = { activityName: "Manual", summaryDTO: { distance: 1000 } };
    await expect(makeGarmin().createManualActivityFromJson(payload)).resolves.toEqual({
      activityId: 777,
    });
    expect(seen[0]!.url).toBe(`${API}/activity-service/activity`);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toEqual(payload);
  });
});

describe("createManualActivity", () => {
  it("converts distance km -> meters and duration min -> seconds", async () => {
    await makeGarmin().createManualActivity(
      "2026-09-22T09:00:00",
      "America/Los_Angeles",
      "resort_skiing",
      5.2,
      45,
      "Morning Ski",
    );
    expect(seen[0]!.url).toBe(`${API}/activity-service/activity`);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toEqual({
      activityTypeDTO: { typeKey: "resort_skiing" },
      accessControlRuleDTO: { typeId: 2, typeKey: "private" },
      timeZoneUnitDTO: { unitKey: "America/Los_Angeles" },
      activityName: "Morning Ski",
      metadataDTO: { autoCalcCalories: true },
      summaryDTO: {
        startTimeLocal: "2026-09-22T09:00:00",
        distance: 5200, // 5.2 km -> 5200 m
        duration: 2700, // 45 min -> 2700 s
      },
    });
  });

  it("does not double-convert an already-large distance/duration", async () => {
    // Regression guard for the "opposite direction from the weigh-in bug"
    // footgun: a caller passing 1 km / 1 min must land as 1000 m / 60 s,
    // not something else.
    await makeGarmin().createManualActivity(
      "2026-09-22T09:00:00",
      "UTC",
      "running",
      1,
      1,
      "Test",
    );
    const body = seen[0]!.body as { summaryDTO: { distance: number; duration: number } };
    expect(body.summaryDTO.distance).toBe(1000);
    expect(body.summaryDTO.duration).toBe(60);
  });
});

describe("getActivitiesByDate", () => {
  it("paginates in fixed pages of 20 until an empty page, concatenating results", async () => {
    const seenStarts: number[] = [];
    server.use(
      http.get(`${API}/activitylist-service/activities/search/activities`, ({ request }) => {
        record(request);
        const url = new URL(request.url);
        const start = Number(url.searchParams.get("start"));
        seenStarts.push(start);
        if (start === 0) {
          return HttpResponse.json(
            Array.from({ length: 20 }, (_, i) => ({ activityId: i, activityName: `A${i}` })),
          );
        }
        if (start === 20) {
          return HttpResponse.json([{ activityId: 20, activityName: "A20" }]);
        }
        return HttpResponse.json([]);
      }),
    );

    const result = await makeGarmin().getActivitiesByDate("2026-09-01", "2026-09-22");
    expect(result).toHaveLength(21);
    expect(seenStarts).toEqual([0, 20, 40]);
    const firstUrl = new URL(
      seen.find((s) => s.url.includes("start=0"))?.url ?? seen[0]!.url,
    );
    expect(firstUrl.pathname).toBe("/activitylist-service/activities/search/activities");
    expect(firstUrl.searchParams.get("startDate")).toBe("2026-09-01");
    expect(firstUrl.searchParams.get("endDate")).toBe("2026-09-22");
    expect(firstUrl.searchParams.get("limit")).toBe("20");
  });

  it("stops immediately on an empty first page", async () => {
    server.use(
      http.get(`${API}/activitylist-service/activities/search/activities`, () =>
        HttpResponse.json([]),
      ),
    );
    await expect(makeGarmin().getActivitiesByDate("2026-09-01")).resolves.toEqual([]);
  });

  it("omits endDate/activityType/sortOrder from the query when not provided", async () => {
    server.use(
      http.get(`${API}/activitylist-service/activities/search/activities`, ({ request }) => {
        record(request);
        return HttpResponse.json([]);
      }),
    );
    await makeGarmin().getActivitiesByDate("2026-09-01");
    const url = new URL(seen[0]!.url);
    expect(url.searchParams.has("endDate")).toBe(false);
    expect(url.searchParams.has("activityType")).toBe(false);
    expect(url.searchParams.has("sortOrder")).toBe(false);
  });

  it("rejects a malformed startdate before making a request", async () => {
    await expect(makeGarmin().getActivitiesByDate("22/09/2026")).rejects.toThrow(/YYYY-MM-DD/);
    expect(seen).toHaveLength(0);
  });
});

describe("importActivity", () => {
  it("uploads to /upload-service/upload/{ext} with the load-bearing import headers", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const result = await makeGarmin().importActivity(blob, "ride.gpx");
    expect(result).toEqual({ fileName: "ride.gpx", status: "uploaded" });
    expect(seen[0]!.url).toBe(`${API}/upload-service/upload/gpx`);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.headers!["nk"]).toBe("NT");
    expect(seen[0]!.headers!["origin"]).toBe("https://sso.garmin.com");
    expect(seen[0]!.headers!["user-agent"]).toBe("GCM-iOS-5.7.2.1");
  });

  it("lower-cases the extension used in the path", async () => {
    server.use(
      http.post(`${API}/upload-service/upload/gpx`, async ({ request }) => {
        record(request);
        return HttpResponse.json({ status: "uploaded", fileName: "RIDE.GPX" });
      }),
    );
    const blob = new Blob([new Uint8Array([1])]);
    await makeGarmin().importActivity(blob, "RIDE.GPX");
    expect(seen[0]!.url).toBe(`${API}/upload-service/upload/gpx`);
  });

  it("throws GarminError for an unsupported extension without making a request", async () => {
    const blob = new Blob([new Uint8Array([1])]);
    await expect(makeGarmin().importActivity(blob, "ride.exe")).rejects.toThrow(
      /Unsupported activity file format/,
    );
    expect(seen).toHaveLength(0);
  });

  it("throws GarminError when the filename has no extension", async () => {
    const blob = new Blob([new Uint8Array([1])]);
    await expect(makeGarmin().importActivity(blob, "ride")).rejects.toThrow(
      /Cannot determine file extension/,
    );
    expect(seen).toHaveLength(0);
  });

  it("re-raises a 409 as GarminConnectionError with a duplicate-activity message", async () => {
    server.use(
      http.post(
        `${API}/upload-service/upload/gpx`,
        () => new HttpResponse("conflict", { status: 409 }),
      ),
    );
    const blob = new Blob([new Uint8Array([1])]);
    await expect(makeGarmin().importActivity(blob, "ride.gpx")).rejects.toThrow(
      GarminConnectionError,
    );
    await expect(makeGarmin().importActivity(blob, "ride.gpx")).rejects.toThrow(
      /already exists \(duplicate\): ride\.gpx/,
    );
  });

  it("synthesizes a fallback result when Garmin returns an empty body", async () => {
    server.use(
      http.post(
        `${API}/upload-service/upload/gpx`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const blob = new Blob([new Uint8Array([1])]);
    await expect(makeGarmin().importActivity(blob, "ride.gpx")).resolves.toEqual({
      status: "uploaded",
      fileName: "ride.gpx",
    });
  });
});
