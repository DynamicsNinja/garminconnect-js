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
  http.get(`${API}/wellness-service/wellness/bodyBattery/events/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ eventType: "sleep" }]);
  }),
  http.get(`${API}/wellness-service/wellness/floorsChartData/daily/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ floorValuesArray: [] });
  }),
  http.get(
    `${API}/usersummary-service/stats/steps/daily/2026-09-01/2026-09-22`,
    ({ request }) => {
      record(request);
      return HttpResponse.json([{ calendarDate: "2026-09-01", totalSteps: 1000 }]);
    },
  ),
  http.get(`${API}/usersummary-service/stats/steps/weekly/2026-09-22/52`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ calendarDate: "2026-09-15", totalSteps: 7000 }]);
  }),
  http.get(`${API}/usersummary-service/stats/stress/weekly/2026-09-22/52`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ calendarDate: "2026-09-15" }]);
  }),
  http.get(
    `${API}/usersummary-service/stats/im/weekly/2026-09-01/2026-09-22`,
    ({ request }) => {
      record(request);
      return HttpResponse.json([{ calendarDate: "2026-09-15" }]);
    },
  ),
  http.get(`${API}/weight-service/weight/dateRange`, ({ request }) => {
    record(request);
    return HttpResponse.json({ totalAverage: { weight: 70000 } });
  }),
  http.post(`${API}/bloodpressure-service/bloodpressure`, async ({ request }) => {
    record(request, await request.clone().json());
    return HttpResponse.json({ systolic: 120 });
  }),
  http.get(`${API}/bloodpressure-service/bloodpressure/range/2026-09-01/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ measurementSummaries: [] });
  }),
  http.delete(`${API}/bloodpressure-service/bloodpressure/2026-09-22/5`, ({ request }) => {
    record(request);
    return HttpResponse.json({ deleted: true });
  }),
  http.put(`${API}/usersummary-service/usersummary/hydration/log`, async ({ request }) => {
    record(request, await request.clone().json());
    return HttpResponse.json({ valueInML: 500 });
  }),
  http.get(`${API}/usersummary-service/usersummary/hydration/daily/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ valueInML: 1500 });
  }),
  http.get(`${API}/wellness-service/wellness/daily/respiration/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ avgWakingRespirationValue: 15 });
  }),
  http.get(`${API}/wellness-service/wellness/daily/spo2/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ lastSevenDaysAvgSpO2: "96.5" });
  }),
  http.get(`${API}/wellness-service/wellness/daily/im/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ moderateIntensityMinutes: 20 });
  }),
  http.get(`${API}/wellness-service/wellness/dailyStress/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ avgStressLevel: 25 });
  }),
  http.get(`${API}/wellness-service/wellness/dailyEvents`, ({ request }) => {
    record(request);
    return HttpResponse.json({ events: [] });
  }),
  http.get(`${API}/sleep-service/stats/sleep/daily/2026-09-01/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({
      individualStats: [
        { calendarDate: "2026-09-02", sleepSeconds: 100 },
        { calendarDate: "2026-09-01", sleepSeconds: 200 },
      ],
    });
  }),
  http.get(`${API}/userstats-service/wellness/daily/abc-display`, ({ request }) => {
    record(request);
    const url = new URL(request.url);
    const metricId = url.searchParams.get("metricId");
    if (metricId === "60") {
      if (url.searchParams.get("fromDate") === url.searchParams.get("untilDate")) {
        return HttpResponse.json({
          allMetrics: {
            metricsMap: {
              WELLNESS_RESTING_HEART_RATE: [{ calendarDate: "2026-09-22", value: 55 }],
            },
          },
        });
      }
      return HttpResponse.json({
        allMetrics: {
          metricsMap: {
            WELLNESS_RESTING_HEART_RATE: [
              { calendarDate: "2026-09-01", value: 55 },
              { calendarDate: "2026-09-02", value: null },
            ],
          },
        },
      });
    }
    // repeated metricId=22&metricId=23 for calories
    return HttpResponse.json({
      allMetrics: {
        metricsMap: {
          WELLNESS_ACTIVE_CALORIES: [
            { calendarDate: "2026-09-01", value: 500 },
            { calendarDate: "2026-09-02", value: null },
          ],
          WELLNESS_BMR_CALORIES: [{ calendarDate: "2026-09-01", value: 1600 }],
        },
      },
    });
  }),
  http.get(`${API}/hrv-service/hrv/daily/2026-09-01/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ hrvSummaries: [] });
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

describe("wellness: new endpoints", () => {
  it("getBodyBatteryEvents puts the date in the path", async () => {
    await expect(makeGarmin().getBodyBatteryEvents("2026-09-22")).resolves.toEqual([
      { eventType: "sleep" },
    ]);
    expect(seen[0]!.url).toBe(`${API}/wellness-service/wellness/bodyBattery/events/2026-09-22`);
  });

  it("getFloors puts the date in the path and returns the data", async () => {
    await expect(makeGarmin().getFloors("2026-09-22")).resolves.toEqual({ floorValuesArray: [] });
    expect(seen[0]!.url).toBe(`${API}/wellness-service/wellness/floorsChartData/daily/2026-09-22`);
  });

  it("getFloors throws GarminError when Garmin returns null", async () => {
    server.use(
      http.get(
        `${API}/wellness-service/wellness/floorsChartData/daily/2026-09-22`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(makeGarmin().getFloors("2026-09-22")).rejects.toThrow(/floors/i);
  });

  it("getDailySteps issues a single request for a range within 28 days", async () => {
    await makeGarmin().getDailySteps("2026-09-01", "2026-09-22");
    expect(seen[0]!.url).toBe(
      `${API}/usersummary-service/stats/steps/daily/2026-09-01/2026-09-22`,
    );
    expect(seen).toHaveLength(1);
  });

  it("getDailySteps chunks a range over 28 days into <=28-day windows", async () => {
    server.use(
      http.get(
        `${API}/usersummary-service/stats/steps/daily/:start/:end`,
        ({ request, params }) => {
          record(request);
          return HttpResponse.json([{ calendarDate: params.start as string, totalSteps: 1 }]);
        },
      ),
    );
    const result = await makeGarmin().getDailySteps("2026-01-01", "2026-03-15");
    // 2026-01-01 .. 2026-03-15 is 73 days -> 3 chunks of <=28 days.
    expect(seen.length).toBe(3);
    expect(seen[0]!.url).toBe(`${API}/usersummary-service/stats/steps/daily/2026-01-01/2026-01-28`);
    expect(seen[1]!.url).toBe(`${API}/usersummary-service/stats/steps/daily/2026-01-29/2026-02-25`);
    expect(seen[2]!.url).toBe(`${API}/usersummary-service/stats/steps/daily/2026-02-26/2026-03-15`);
    expect(result).toHaveLength(3);
  });

  it("getDailySteps throws when start is after end", async () => {
    await expect(makeGarmin().getDailySteps("2026-09-22", "2026-09-01")).rejects.toThrow(
      /start date must not be after end date/,
    );
    expect(seen).toHaveLength(0);
  });

  it("getWeeklySteps defaults weeks to 52", async () => {
    await makeGarmin().getWeeklySteps("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/usersummary-service/stats/steps/weekly/2026-09-22/52`);
  });

  it("getWeeklySteps rejects a non-positive weeks value before making a request", async () => {
    await expect(makeGarmin().getWeeklySteps("2026-09-22", 0)).rejects.toThrow(/positive integer/);
    expect(seen).toHaveLength(0);
  });

  it("getWeeklyStress sends weeks in the path", async () => {
    await makeGarmin().getWeeklyStress("2026-09-22", 52);
    expect(seen[0]!.url).toBe(`${API}/usersummary-service/stats/stress/weekly/2026-09-22/52`);
  });

  it("getWeeklyIntensityMinutes builds a start/end path", async () => {
    await makeGarmin().getWeeklyIntensityMinutes("2026-09-01", "2026-09-22");
    expect(seen[0]!.url).toBe(
      `${API}/usersummary-service/stats/im/weekly/2026-09-01/2026-09-22`,
    );
  });

  it("getStatsAndBody merges getUserSummary with the body composition totalAverage", async () => {
    server.use(
      http.get(`${API}/usersummary-service/usersummary/daily/abc-display`, () =>
        HttpResponse.json({ totalSteps: 8000 }),
      ),
    );
    const result = await makeGarmin().getStatsAndBody("2026-09-22");
    expect(result).toMatchObject({ totalSteps: 8000, weight: 70000 });
    const bodyCall = seen.find((s) => s.url.includes("weight-service/weight/dateRange"));
    expect(bodyCall).toBeDefined();
    const url = new URL(bodyCall!.url);
    expect(url.searchParams.get("startDate")).toBe("2026-09-22");
    expect(url.searchParams.get("endDate")).toBe("2026-09-22");
  });

  it("setBloodPressure sends timestamps, ranges and omits pulse when not given", async () => {
    const when = new Date("2026-09-22T10:00:00.000Z");
    await makeGarmin().setBloodPressure(120, 80, undefined, when, "felt fine");
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url).toBe(`${API}/bloodpressure-service/bloodpressure`);
    const body = seen[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ systolic: 120, diastolic: 80, sourceType: "MANUAL", notes: "felt fine" });
    expect(body.pulse).toBeUndefined();
    expect(body.measurementTimestampGMT).toBe("2026-09-22T10:00:00.00");
  });

  it("setBloodPressure includes pulse when given", async () => {
    await makeGarmin().setBloodPressure(120, 80, 65);
    expect(seen[0]!.url).toBe(`${API}/bloodpressure-service/bloodpressure`);
    const body = seen[0]!.body as Record<string, unknown>;
    expect(body.pulse).toBe(65);
  });

  it("setBloodPressure rejects out-of-range systolic before making a request", async () => {
    await expect(makeGarmin().setBloodPressure(500, 80)).rejects.toThrow(/systolic/);
    expect(seen).toHaveLength(0);
  });

  it("getBloodPressure defaults enddate to startdate and sends includeAll", async () => {
    server.use(
      http.get(`${API}/bloodpressure-service/bloodpressure/range/2026-09-22/2026-09-22`, ({ request }) => {
        record(request);
        return HttpResponse.json({ measurementSummaries: [] });
      }),
    );
    await makeGarmin().getBloodPressure("2026-09-22");
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe("/bloodpressure-service/bloodpressure/range/2026-09-22/2026-09-22");
    expect(url.searchParams.get("includeAll")).toBe("true");
  });

  it("getBloodPressure uses a range when enddate is given", async () => {
    await makeGarmin().getBloodPressure("2026-09-01", "2026-09-22");
    expect(seen[0]!.url).toBe(
      `${API}/bloodpressure-service/bloodpressure/range/2026-09-01/2026-09-22?includeAll=true`,
    );
  });

  it("deleteBloodPressure issues a DELETE with cdate and version in the path", async () => {
    await expect(makeGarmin().deleteBloodPressure(5, "2026-09-22")).resolves.toEqual({
      deleted: true,
    });
    expect(seen[0]!.method).toBe("DELETE");
    expect(seen[0]!.url).toBe(`${API}/bloodpressure-service/bloodpressure/2026-09-22/5`);
  });

  it("deleteBloodPressure rejects a non-positive version before making a request", async () => {
    await expect(makeGarmin().deleteBloodPressure(0, "2026-09-22")).rejects.toThrow(
      /positive integer/,
    );
    expect(seen).toHaveLength(0);
  });

  it("addHydrationData sends valueInML raw and derives cdate from now when both omitted", async () => {
    await makeGarmin().addHydrationData(500);
    expect(seen[0]!.method).toBe("PUT");
    expect(seen[0]!.url).toBe(`${API}/usersummary-service/usersummary/hydration/log`);
    const body = seen[0]!.body as Record<string, unknown>;
    expect(body.valueInML).toBe(500);
    expect(typeof body.calendarDate).toBe("string");
  });

  it("addHydrationData uses local midnight when only cdate is given", async () => {
    await makeGarmin().addHydrationData(250, undefined, "2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/usersummary-service/usersummary/hydration/log`);
    const body = seen[0]!.body as Record<string, unknown>;
    expect(body.calendarDate).toBe("2026-09-22");
    expect(body.timestampLocal).toBe("2026-09-22T00:00:00.00");
  });

  it("addHydrationData throws when timestamp's date does not match cdate", async () => {
    await expect(
      makeGarmin().addHydrationData(250, new Date("2026-09-01T00:00:00Z"), "2026-09-22"),
    ).rejects.toThrow(/does not match/);
    expect(seen).toHaveLength(0);
  });

  it("addHydrationData rejects a magnitude over 10000", async () => {
    await expect(makeGarmin().addHydrationData(20_000)).rejects.toThrow(/10000/);
    expect(seen).toHaveLength(0);
  });

  it("addHydrationData allows negative values", async () => {
    await makeGarmin().addHydrationData(-200, undefined, "2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/usersummary-service/usersummary/hydration/log`);
    const body = seen[0]!.body as Record<string, unknown>;
    expect(body.valueInML).toBe(-200);
  });

  it("getHydrationData puts the date in the path", async () => {
    await expect(makeGarmin().getHydrationData("2026-09-22")).resolves.toEqual({
      valueInML: 1500,
    });
    expect(seen[0]!.url).toBe(
      `${API}/usersummary-service/usersummary/hydration/daily/2026-09-22`,
    );
  });

  it("getRespirationData puts the date in the path", async () => {
    await makeGarmin().getRespirationData("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/wellness-service/wellness/daily/respiration/2026-09-22`);
  });

  it("getSpo2Data coerces a string lastSevenDaysAvgSpO2 to a number", async () => {
    const result = await makeGarmin().getSpo2Data("2026-09-22");
    expect(result).toEqual({ lastSevenDaysAvgSpO2: 96.5 });
    expect(typeof result?.lastSevenDaysAvgSpO2).toBe("number");
  });

  it("getIntensityMinutesData puts the date in the path", async () => {
    await makeGarmin().getIntensityMinutesData("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/wellness-service/wellness/daily/im/2026-09-22`);
  });

  it("getAllDayStress and getStressData hit the identical URL", async () => {
    await makeGarmin().getAllDayStress("2026-09-22");
    const first = seen[0]!.url;
    seen.length = 0;
    await makeGarmin().getStressData("2026-09-22");
    expect(seen[0]!.url).toBe(first);
    expect(first).toBe(`${API}/wellness-service/wellness/dailyStress/2026-09-22`);
  });

  it("getAllDayEvents sends calendarDate as a query param", async () => {
    await makeGarmin().getAllDayEvents("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/wellness-service/wellness/dailyEvents?calendarDate=2026-09-22`);
  });

  it("getSleepDaily de-duplicates and sorts by calendarDate", async () => {
    const result = await makeGarmin().getSleepDaily("2026-09-01", "2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/sleep-service/stats/sleep/daily/2026-09-01/2026-09-22`);
    expect(result.map((r) => r.calendarDate)).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("getSleepDaily throws when start is after end", async () => {
    await expect(makeGarmin().getSleepDaily("2026-09-22", "2026-09-01")).rejects.toThrow(
      /start date must not be after end date/,
    );
    expect(seen).toHaveLength(0);
  });

  it("getRhrDay sends fromDate/untilDate/metricId=60 for a single date", async () => {
    await makeGarmin().getRhrDay("2026-09-22");
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe("/userstats-service/wellness/daily/abc-display");
    expect(url.searchParams.get("fromDate")).toBe("2026-09-22");
    expect(url.searchParams.get("untilDate")).toBe("2026-09-22");
    expect(url.searchParams.get("metricId")).toBe("60");
  });

  it("getRhrDaily reshapes metricsMap into [{calendarDate, value}] and drops null values", async () => {
    const result = await makeGarmin().getRhrDaily("2026-09-01", "2026-09-02");
    expect(result).toEqual([{ calendarDate: "2026-09-01", value: 55 }]);
  });

  it("getCaloriesDaily sends a repeated metricId=22&metricId=23 query param and merges active/resting into {calendarDate, active, resting, total}", async () => {
    const result = await makeGarmin().getCaloriesDaily("2026-09-01", "2026-09-02");
    expect(result).toEqual([
      { calendarDate: "2026-09-01", active: 500, resting: 1600, total: 2100 },
    ]);
    const url = new URL(seen[0]!.url);
    expect(url.searchParams.getAll("metricId")).toEqual(["22", "23"]);
  });

  it("getHrvDataRange builds a start/end path", async () => {
    await makeGarmin().getHrvDataRange("2026-09-01", "2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/hrv-service/hrv/daily/2026-09-01/2026-09-22`);
  });
});
