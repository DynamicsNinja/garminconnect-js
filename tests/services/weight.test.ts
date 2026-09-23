import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
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
  http.get(`${API}/weight-service/weight/range/2026-09-15/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ dailyWeightSummaries: [], totalAverage: {} });
  }),
  http.post(`${API}/weight-service/user-weight`, async ({ request }) => {
    record(request, await request.clone().json());
    return HttpResponse.json({ value: 93 });
  }),
  http.delete(`${API}/weight-service/weight/2026-09-22/byversion/123`, ({ request }) => {
    record(request);
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete(`${API}/weight-service/weight/2026-09-22/byversion/111`, ({ request }) => {
    record(request);
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete(`${API}/weight-service/weight/2026-09-22/byversion/222`, ({ request }) => {
    record(request);
    return new HttpResponse(null, { status: 204 });
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

describe("weight service", () => {
  it("getWeighIns composes the range URL with includeAll", async () => {
    await makeGarmin().getWeighIns("2026-09-15", "2026-09-22");
    expect(seen[0]!.url).toBe(
      `${API}/weight-service/weight/range/2026-09-15/2026-09-22?includeAll=true`,
    );
  });

  it("addWeighInWithTimestamps sends the RAW value under 'value', not grams", async () => {
    // This is the same rule as `addWeighIn`: Garmin converts server-side from
    // `unitKey`. Sending 93 must NOT become 93000.
    await makeGarmin().addWeighInWithTimestamps(93, "kg", "2026-09-22T08:00:00.00", "2026-09-22T06:00:00.00");
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url).toBe(`${API}/weight-service/user-weight`);
    const body = seen[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      value: 93,
      unitKey: "kg",
      sourceType: "MANUAL",
      dateTimestamp: "2026-09-22T08:00:00.00",
      gmtTimestamp: "2026-09-22T06:00:00.00",
    });
  });

  it("addWeighInWithTimestamps derives timestamps from `when` when omitted", async () => {
    const when = new Date("2026-09-22T10:00:00.000Z");
    await makeGarmin().addWeighInWithTimestamps(160, "lbs", undefined, undefined, when);
    const body = seen[0]!.body as Record<string, unknown>;
    expect(body.value).toBe(160);
    expect(body.unitKey).toBe("lbs");
    expect(body.gmtTimestamp).toBe("2026-09-22T10:00:00.00");
  });

  it("deleteWeighIn composes the byversion DELETE URL", async () => {
    await makeGarmin().deleteWeighIn("2026-09-22", 123);
    expect(seen[0]!.method).toBe("DELETE");
    expect(seen[0]!.url).toBe(`${API}/weight-service/weight/2026-09-22/byversion/123`);
  });

  describe("getDailyWeighIns", () => {
    it("composes the dayview URL with includeAll", async () => {
      server.use(
        http.get(`${API}/weight-service/weight/dayview/2026-09-22`, ({ request }) => {
          record(request);
          return HttpResponse.json({ dateWeightList: [{ samplePk: 1, weight: 70000 }] });
        }),
      );
      const result = await makeGarmin().getDailyWeighIns("2026-09-22");
      expect(seen[0]!.url).toBe(`${API}/weight-service/weight/dayview/2026-09-22?includeAll=true`);
      expect(result).toEqual({ dateWeightList: [{ samplePk: 1, weight: 70000 }] });
    });

    it("returns null on a 204 (no data that day)", async () => {
      server.use(
        http.get(`${API}/weight-service/weight/dayview/2026-09-22`, () => new HttpResponse(null, { status: 204 })),
      );
      const result = await makeGarmin().getDailyWeighIns("2026-09-22");
      expect(result).toBeNull();
    });
  });

  describe("deleteWeighIns", () => {
    it("returns null and deletes nothing when there are no entries that day", async () => {
      server.use(
        http.get(`${API}/weight-service/weight/dayview/2026-09-22`, () =>
          HttpResponse.json({ dateWeightList: [] }),
        ),
      );
      const result = await makeGarmin().deleteWeighIns("2026-09-22");
      expect(result).toBeNull();
      expect(seen.some((s) => s.method === "DELETE")).toBe(false);
    });

    it("returns null and deletes nothing when multiple entries exist and deleteAll is not set", async () => {
      server.use(
        http.get(`${API}/weight-service/weight/dayview/2026-09-22`, () =>
          HttpResponse.json({
            dateWeightList: [
              { samplePk: 111, weight: 70000 },
              { samplePk: 222, weight: 71000 },
            ],
          }),
        ),
      );
      const result = await makeGarmin().deleteWeighIns("2026-09-22");
      expect(result).toBeNull();
      expect(seen.some((s) => s.method === "DELETE")).toBe(false);
    });

    it("deletes every entry and returns the count when deleteAll is true", async () => {
      server.use(
        http.get(`${API}/weight-service/weight/dayview/2026-09-22`, () =>
          HttpResponse.json({
            dateWeightList: [
              { samplePk: 111, weight: 70000 },
              { samplePk: 222, weight: 71000 },
            ],
          }),
        ),
      );
      const result = await makeGarmin().deleteWeighIns("2026-09-22", true);
      expect(result).toBe(2);
      const deleteUrls = seen.filter((s) => s.method === "DELETE").map((s) => s.url);
      expect(deleteUrls).toEqual(
        expect.arrayContaining([
          `${API}/weight-service/weight/2026-09-22/byversion/111`,
          `${API}/weight-service/weight/2026-09-22/byversion/222`,
        ]),
      );
    });

    it("deletes a single entry outright without requiring deleteAll", async () => {
      server.use(
        http.get(`${API}/weight-service/weight/dayview/2026-09-22`, () =>
          HttpResponse.json({ dateWeightList: [{ samplePk: 123, weight: 93000 }] }),
        ),
      );
      const result = await makeGarmin().deleteWeighIns("2026-09-22");
      expect(result).toBe(1);
      expect(seen.find((s) => s.method === "DELETE")?.url).toBe(
        `${API}/weight-service/weight/2026-09-22/byversion/123`,
      );
    });
  });
});
