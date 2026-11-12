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

// setSleepWindow: read the night with getSleepData, then PUT the new window to
// /sleep-service/sleep/dailySleep/{id}. Request shape from Garmin's web client (2026-11-11);
// every value below is synthetic.
describe("wellness: setSleepWindow", () => {
  const SLEEP_PATH = `${API}/wellness-service/wellness/dailySleepData/abc-display`;
  const START = new Date("2026-03-09T22:00:00.000Z");
  const END = new Date("2026-03-10T06:30:00.000Z");

  // A stateful fake: the record's id is its start in epoch ms, and it changes on every PUT,
  // as Garmin's does.
  function useSleepRecord(initial: Record<string, unknown> | null): { stored: Record<string, unknown> | null } {
    const state = { stored: initial };
    server.use(
      http.get(SLEEP_PATH, ({ request }) => {
        record(request);
        return state.stored === null
          ? new HttpResponse(null, { status: 204 })
          : HttpResponse.json({ dailySleepDTO: state.stored, sleepLevels: [] });
      }),
      http.put(`${API}/sleep-service/sleep/dailySleep/:id`, async ({ request }) => {
        const body = (await request.clone().json()) as Record<string, unknown>;
        record(request, body);
        const next = {
          ...state.stored,
          ...body,
          id: body["sleepStartTimestampGMT"],
          sleepWindowConfirmationType: "manually_confirmed",
        };
        state.stored = next;
        return HttpResponse.json(next);
      }),
      // Creating a window on an empty night: Garmin stores it with an id, but the POST's own
      // response still says `id: null` (observed on the test account, 2026-11-12).
      http.post(`${API}/sleep-service/sleep/dailySleep`, async ({ request }) => {
        const body = (await request.clone().json()) as Record<string, unknown>;
        record(request, body);
        state.stored = {
          ...state.stored,
          ...body,
          id: body["sleepStartTimestampGMT"],
          sleepWindowConfirmationType: "manually_confirmed",
        };
        return HttpResponse.json({ ...state.stored, id: null, sleepWindowConfirmationType: null });
      }),
    );
    return state;
  }

  // What Garmin returns for a night no device recorded: a shell with a null id.
  const EMPTY_NIGHT = {
    id: null,
    userProfilePK: 12345,
    calendarDate: "2026-03-10",
    sleepStartTimestampGMT: null,
    sleepEndTimestampGMT: null,
    napTimeSeconds: null,
  };

  const RECORD = {
    id: 1773093600000,
    userProfilePK: 12345,
    calendarDate: "2026-03-10",
    sleepStartTimestampGMT: 1773093600000,
    sleepEndTimestampGMT: 1773124200000,
    napTimeSeconds: 600,
  };

  it("reads the night, then PUTs the new window to the record's current id", async () => {
    useSleepRecord({ ...RECORD });
    await makeGarmin().setSleepWindow("2026-03-10", START, END);
    expect(seen).toHaveLength(2);
    expect(seen[0]!.method).toBe("GET");
    const read = new URL(seen[0]!.url);
    expect(read.pathname).toBe("/wellness-service/wellness/dailySleepData/abc-display");
    expect(read.searchParams.get("date")).toBe("2026-03-10");
    expect(seen[1]!.method).toBe("PUT");
    expect(seen[1]!.url).toBe(`${API}/sleep-service/sleep/dailySleep/1773093600000`);
    expect(JSON.stringify(seen[1]!.body)).toBe(
      JSON.stringify({
        calendarDate: "2026-03-10",
        sleepStartTimestampGMT: START.getTime(),
        sleepEndTimestampGMT: END.getTime(),
        sleepTimeSeconds: 30600,
        napTimeSeconds: 600,
        sleepWindowConfirmed: true,
        userProfilePK: 12345,
        id: 1773093600000,
      }),
    );
  });

  it("returns the stored record Garmin answers with", async () => {
    useSleepRecord({ ...RECORD });
    const result = await makeGarmin().setSleepWindow("2026-03-10", START, END);
    expect(result?.id).toBe(START.getTime());
    expect(result?.sleepStartTimestampGMT).toBe(START.getTime());
    expect(result?.sleepEndTimestampGMT).toBe(END.getTime());
    expect(result?.sleepWindowConfirmationType).toBe("manually_confirmed");
  });

  it("takes the id fresh from a read before every PUT, since each edit changes it", async () => {
    useSleepRecord({ ...RECORD });
    const garmin = makeGarmin();
    await garmin.setSleepWindow("2026-03-10", START, END);
    const later = new Date(START.getTime() - 60_000);
    await garmin.setSleepWindow("2026-03-10", later, END);
    const puts = seen.filter((s) => s.method === "PUT");
    expect(puts.map((p) => new URL(p.url).pathname)).toEqual([
      "/sleep-service/sleep/dailySleep/1773093600000",
      `/sleep-service/sleep/dailySleep/${String(START.getTime())}`,
    ]);
    expect((puts[1]!.body as Record<string, unknown>)["id"]).toBe(START.getTime());
    expect(seen.map((s) => s.method)).toEqual(["GET", "PUT", "GET", "PUT"]);
  });

  it("sends napTimeSeconds 0 when the record has none", async () => {
    const { napTimeSeconds: _nap, ...withoutNap } = RECORD;
    useSleepRecord(withoutNap);
    await makeGarmin().setSleepWindow("2026-03-10", START, END);
    expect((seen[1]!.body as Record<string, unknown>)["napTimeSeconds"]).toBe(0);
  });

  it("rounds sleepTimeSeconds to whole seconds", async () => {
    useSleepRecord({ ...RECORD });
    await makeGarmin().setSleepWindow("2026-03-10", START, new Date(END.getTime() + 400));
    expect((seen[1]!.body as Record<string, unknown>)["sleepTimeSeconds"]).toBe(30600);
  });

  it.each([
    ["an invalid sleepStart", new Date(Number.NaN), END],
    ["an invalid sleepEnd", START, new Date("not a date")],
    ["sleepStart after sleepEnd", END, START],
    ["sleepStart equal to sleepEnd", START, new Date(START.getTime())],
  ])("rejects %s with GarminError before any request", async (_label, start, end) => {
    useSleepRecord({ ...RECORD });
    await expect(makeGarmin().setSleepWindow("2026-03-10", start, end)).rejects.toThrow(
      GarminError,
    );
    expect(seen).toHaveLength(0);
  });

  it("creates the window with a POST when the night has none, and returns the stored record", async () => {
    useSleepRecord({ ...EMPTY_NIGHT });
    const result = await makeGarmin().setSleepWindow("2026-03-10", START, END);
    expect(seen.map((s) => s.method)).toEqual(["GET", "POST", "GET"]);
    expect(seen[1]!.url).toBe(`${API}/sleep-service/sleep/dailySleep`);
    expect(JSON.stringify(seen[1]!.body)).toBe(
      JSON.stringify({
        calendarDate: "2026-03-10",
        sleepStartTimestampGMT: START.getTime(),
        sleepEndTimestampGMT: END.getTime(),
        sleepTimeSeconds: 30600,
        napTimeSeconds: 0,
        sleepWindowConfirmed: true,
        userProfilePK: 12345,
      }),
    );
    // The read-back, not the POST's `id: null` echo.
    expect(result?.id).toBe(START.getTime());
    expect(result?.sleepWindowConfirmationType).toBe("manually_confirmed");
  });

  it("edits a window it just created with a PUT to the new id", async () => {
    useSleepRecord({ ...EMPTY_NIGHT });
    const garmin = makeGarmin();
    await garmin.setSleepWindow("2026-03-10", START, END);
    await garmin.setSleepWindow("2026-03-10", new Date(START.getTime() - 60_000), END);
    expect(seen.map((s) => s.method)).toEqual(["GET", "POST", "GET", "GET", "PUT"]);
    expect(seen[4]!.url).toBe(`${API}/sleep-service/sleep/dailySleep/${String(START.getTime())}`);
  });

  it.each([
    ["Garmin returns nothing", null, /no sleep record for 2026-03-10/],
    ["the id is not a number", { ...RECORD, id: "abc" }, /unusable id/],
  ])("throws GarminError and writes nothing when %s", async (_label, stored, message) => {
    useSleepRecord(stored);
    await expect(makeGarmin().setSleepWindow("2026-03-10", START, END)).rejects.toThrow(message);
    expect(seen.every((s) => s.method === "GET")).toBe(true);
  });

  it("throws GarminError and sends no PUT when the record has no numeric userProfilePK", async () => {
    const { userProfilePK: _pk, ...withoutPk } = RECORD;
    useSleepRecord(withoutPk);
    await expect(makeGarmin().setSleepWindow("2026-03-10", START, END)).rejects.toThrow(
      /carries no userProfilePK/,
    );
    expect(seen.map((s) => s.method)).toEqual(["GET"]);
  });

  it("throws GarminError and sends no PUT when the response has no dailySleepDTO", async () => {
    server.use(
      http.get(SLEEP_PATH, ({ request }) => {
        record(request);
        return HttpResponse.json({ sleepLevels: [] });
      }),
    );
    await expect(makeGarmin().setSleepWindow("2026-03-10", START, END)).rejects.toThrow(
      GarminError,
    );
    expect(seen.filter((s) => s.method === "PUT")).toHaveLength(0);
  });
});
