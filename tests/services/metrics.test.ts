import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
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

  // getMaxMetrics
  http.get(`${API}/metrics-service/metrics/maxmet/daily/2026-09-20/2026-09-20`, ({ request }) => {
    record(request);
    return HttpResponse.json({ generic: { vo2MaxPreciseValue: 50 } });
  }),

  // getMaxMetricsRange
  http.get(`${API}/metrics-service/metrics/maxmet/daily/2026-09-01/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ range: true });
  }),

  // getFunctionalThresholdPowerRange
  http.get(
    `${API}/biometric-service/stats/functionalThresholdPower/range/2026-09-01/2026-09-22`,
    ({ request }) => {
      record(request);
      return HttpResponse.json([{ value: 250 }]);
    },
  ),

  // getLactateThreshold: latest=true branch
  http.get(`${API}/biometric-service/biometric/latestLactateThreshold`, ({ request }) => {
    record(request);
    return HttpResponse.json([
      { speed: 3.5, hearRate: 165 },
      { speed: 3.7 },
    ]);
  }),
  http.get(`${API}/biometric-service/biometric/powerToWeight/latest/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ power: 4.1 }]);
  }),

  // getLactateThreshold: latest=false branch
  http.get(
    `${API}/biometric-service/stats/lactateThresholdSpeed/range/2026-09-01/2026-09-10`,
    ({ request }) => {
      record(request);
      return HttpResponse.json([{ value: 3.6 }]);
    },
  ),
  http.get(
    `${API}/biometric-service/stats/lactateThresholdHeartRate/range/2026-09-01/2026-09-10`,
    ({ request }) => {
      record(request);
      return HttpResponse.json([{ value: 168 }]);
    },
  ),
  http.get(
    `${API}/biometric-service/stats/functionalThresholdPower/range/2026-09-01/2026-09-10`,
    ({ request }) => {
      record(request);
      return HttpResponse.json([{ value: 255 }]);
    },
  ),

  // getTrainingReadiness / getMorningTrainingReadiness
  http.get(`${API}/metrics-service/metrics/trainingreadiness/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json([
      { inputContext: "OTHER", score: 1 },
      { inputContext: "AFTER_WAKEUP_RESET", score: 77 },
    ]);
  }),
  http.get(`${API}/metrics-service/metrics/trainingreadiness/2026-09-01`, ({ request }) => {
    record(request);
    return HttpResponse.json([]);
  }),
  http.get(`${API}/metrics-service/metrics/trainingreadiness/2026-09-02`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ inputContext: "OTHER", score: 5 }]);
  }),

  // getEnduranceScore
  http.get(`${API}/metrics-service/metrics/endurancescore`, ({ request }) => {
    record(request);
    return HttpResponse.json({ overallScore: 42 });
  }),
  http.get(`${API}/metrics-service/metrics/endurancescore/stats`, ({ request }) => {
    record(request);
    return HttpResponse.json({ weeklyScores: [] });
  }),

  // getRunningTolerance
  http.get(`${API}/metrics-service/metrics/runningtolerance/stats`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ value: 1 }]);
  }),

  // getRacePredictions
  http.get(`${API}/metrics-service/metrics/racepredictions/latest/abc-display`, ({ request }) => {
    record(request);
    return HttpResponse.json({ time5K: 1200 });
  }),
  http.get(`${API}/metrics-service/metrics/racepredictions/daily/abc-display`, ({ request }) => {
    record(request);
    return HttpResponse.json({ daily: [] });
  }),

  // getTrainingStatus
  http.get(`${API}/metrics-service/metrics/trainingstatus/aggregated/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ mostRecentTrainingStatus: {} });
  }),

  // getFitnessAgeData
  http.get(`${API}/fitnessage-service/fitnessage/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ fitnessAge: 30 });
  }),

  // getHillScore
  http.get(`${API}/metrics-service/metrics/hillscore`, ({ request }) => {
    record(request);
    return HttpResponse.json({ overallScore: 10 });
  }),
  http.get(`${API}/metrics-service/metrics/hillscore/stats`, ({ request }) => {
    record(request);
    return HttpResponse.json({ dailyScores: [] });
  }),

  // getCyclingFtp
  http.get(
    `${API}/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING`,
    ({ request }) => {
      record(request);
      return HttpResponse.json({ value: 260 });
    },
  ),

  // getHeartRateZones
  http.get(`${API}/biometric-service/heartRateZones`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ zoneNumber: 1 }]);
  }),

  // getPowerZones
  http.get(`${API}/biometric-service/powerZones/sports/all`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ zoneNumber: 1 }]);
  }),

  // getPowerZonesForSport
  http.get(`${API}/biometric-service/powerZones/sport/CYCLING`, ({ request }) => {
    record(request);
    return HttpResponse.json({ zones: [] });
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
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-22T12:00:00Z"));
});
afterEach(() => {
  server.resetHandlers();
  server.close();
  vi.useRealTimers();
});

describe("metrics: max metrics / FTP", () => {
  it("getMaxMetrics repeats cdate as both start and end", async () => {
    await expect(makeGarmin().getMaxMetrics("2026-09-20")).resolves.toEqual({
      generic: { vo2MaxPreciseValue: 50 },
    });
    expect(seen[0]!.url).toBe(`${API}/metrics-service/metrics/maxmet/daily/2026-09-20/2026-09-20`);
  });

  it("getMaxMetricsRange builds a start/end path", async () => {
    await expect(makeGarmin().getMaxMetricsRange("2026-09-01", "2026-09-22")).resolves.toEqual({
      range: true,
    });
    expect(seen[0]!.url).toBe(`${API}/metrics-service/metrics/maxmet/daily/2026-09-01/2026-09-22`);
  });

  it("getMaxMetricsRange throws when start is after end, before any request", async () => {
    await expect(makeGarmin().getMaxMetricsRange("2026-09-22", "2026-09-01")).rejects.toThrow(
      /start date must not be after end date/,
    );
    expect(seen).toHaveLength(0);
  });

  it("getFunctionalThresholdPowerRange defaults sport=RUNNING, aggregation=daily", async () => {
    await makeGarmin().getFunctionalThresholdPowerRange("2026-09-01", "2026-09-22");
    expect(seen[0]!.url).toBe(
      `${API}/biometric-service/stats/functionalThresholdPower/range/2026-09-01/2026-09-22` +
        `?sport=RUNNING&aggregation=daily&aggregationStrategy=LATEST`,
    );
  });

  it("getFunctionalThresholdPowerRange normalizes a lowercase sport and accepts a custom aggregation", async () => {
    await makeGarmin().getFunctionalThresholdPowerRange("2026-09-01", "2026-09-22", "cycling", "weekly");
    expect(seen[0]!.url).toBe(
      `${API}/biometric-service/stats/functionalThresholdPower/range/2026-09-01/2026-09-22` +
        `?sport=CYCLING&aggregation=weekly&aggregationStrategy=LATEST`,
    );
  });

  it("getFunctionalThresholdPowerRange rejects an invalid aggregation before any request", async () => {
    await expect(
      makeGarmin().getFunctionalThresholdPowerRange("2026-09-01", "2026-09-22", "RUNNING", "hourly"),
    ).rejects.toThrow(/aggregation must be one of/);
    expect(seen).toHaveLength(0);
  });

  it("getFunctionalThresholdPowerRange rejects an invalid sport key before any request", async () => {
    await expect(
      makeGarmin().getFunctionalThresholdPowerRange("2026-09-01", "2026-09-22", "running1"),
    ).rejects.toThrow(/Invalid sport key/);
    expect(seen).toHaveLength(0);
  });
});

describe("metrics: getLactateThreshold — both branches", () => {
  it("latest=true (default) branch: hits latestLactateThreshold + powerToWeight/latest/{today}, merges speed/HR", async () => {
    const result = await makeGarmin().getLactateThreshold();
    expect(seen[0]!.url).toBe(`${API}/biometric-service/biometric/latestLactateThreshold`);
    expect(seen[1]!.url).toBe(
      `${API}/biometric-service/biometric/powerToWeight/latest/2026-09-22?sport=Running`,
    );
    expect(seen).toHaveLength(2);
    expect(result).toEqual({
      speed_and_heart_rate: { speed: 3.7, heartRate: 165 },
      power: { power: 4.1 },
    });
  });

  it("latest=false branch: requires startDate, hits speed/HR/FTP range endpoints with sport=RUNNING", async () => {
    const result = await makeGarmin().getLactateThreshold(false, "2026-09-01", "2026-09-10");
    expect(seen[0]!.url).toBe(
      `${API}/biometric-service/stats/lactateThresholdSpeed/range/2026-09-01/2026-09-10` +
        `?sport=RUNNING&aggregation=daily&aggregationStrategy=LATEST`,
    );
    expect(seen[1]!.url).toBe(
      `${API}/biometric-service/stats/lactateThresholdHeartRate/range/2026-09-01/2026-09-10` +
        `?sport=RUNNING&aggregation=daily&aggregationStrategy=LATEST`,
    );
    expect(seen[2]!.url).toBe(
      `${API}/biometric-service/stats/functionalThresholdPower/range/2026-09-01/2026-09-10` +
        `?sport=RUNNING&aggregation=daily&aggregationStrategy=LATEST`,
    );
    expect(result).toEqual({
      speed: [{ value: 3.6 }],
      heart_rate: [{ value: 168 }],
      power: [{ value: 255 }],
    });
  });

  it("latest=false throws when startDate is omitted, before any request", async () => {
    await expect(makeGarmin().getLactateThreshold(false)).rejects.toThrow(
      /startDate is required when latest is false/,
    );
    expect(seen).toHaveLength(0);
  });
});

describe("metrics: training readiness", () => {
  it("getTrainingReadiness puts cdate in the path", async () => {
    const result = await makeGarmin().getTrainingReadiness("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/metrics-service/metrics/trainingreadiness/2026-09-22`);
    expect(result).toHaveLength(2);
  });

  it("getMorningTrainingReadiness picks the AFTER_WAKEUP_RESET entry", async () => {
    const result = await makeGarmin().getMorningTrainingReadiness("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/metrics-service/metrics/trainingreadiness/2026-09-22`);
    expect(result).toEqual({ inputContext: "AFTER_WAKEUP_RESET", score: 77 });
  });

  it("getMorningTrainingReadiness returns null for an empty array (falsy in upstream Python)", async () => {
    const result = await makeGarmin().getMorningTrainingReadiness("2026-09-01");
    expect(result).toBeNull();
  });

  it("getMorningTrainingReadiness falls back to the first entry when none has AFTER_WAKEUP_RESET", async () => {
    const result = await makeGarmin().getMorningTrainingReadiness("2026-09-02");
    expect(result).toEqual({ inputContext: "OTHER", score: 5 });
  });
});

describe("metrics: getEnduranceScore — both branches", () => {
  it("no enddate: single-day endpoint with calendarDate", async () => {
    await makeGarmin().getEnduranceScore("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/metrics-service/metrics/endurancescore?calendarDate=2026-09-22`);
  });

  it("with enddate: range endpoint, hard-coded aggregation=weekly", async () => {
    await makeGarmin().getEnduranceScore("2026-09-01", "2026-09-22");
    expect(seen[0]!.url).toBe(
      `${API}/metrics-service/metrics/endurancescore/stats?startDate=2026-09-01&endDate=2026-09-22&aggregation=weekly`,
    );
  });
});

describe("metrics: getRunningTolerance", () => {
  it("builds startDate/endDate/aggregation query, defaulting aggregation=weekly", async () => {
    await makeGarmin().getRunningTolerance("2026-09-01", "2026-09-22");
    expect(seen[0]!.url).toBe(
      `${API}/metrics-service/metrics/runningtolerance/stats?startDate=2026-09-01&endDate=2026-09-22&aggregation=weekly`,
    );
  });

  it("rejects an aggregation outside {daily, weekly} before any request", async () => {
    await expect(
      makeGarmin().getRunningTolerance("2026-09-01", "2026-09-22", "monthly"),
    ).rejects.toThrow(/aggregation must be one of daily, weekly/);
    expect(seen).toHaveLength(0);
  });
});

describe("metrics: getRacePredictions — both branches", () => {
  it("no params: latest/{displayName}", async () => {
    await makeGarmin().getRacePredictions();
    expect(seen[0]!.url).toBe(`${API}/metrics-service/metrics/racepredictions/latest/abc-display`);
  });

  it("all three params: {type}/{displayName} with fromCalendarDate/toCalendarDate", async () => {
    await makeGarmin().getRacePredictions("2026-09-01", "2026-09-22", "daily");
    expect(seen[0]!.url).toBe(
      `${API}/metrics-service/metrics/racepredictions/daily/abc-display` +
        `?fromCalendarDate=2026-09-01&toCalendarDate=2026-09-22`,
    );
  });

  it("rejects a partial combination of params before any request", async () => {
    await expect(makeGarmin().getRacePredictions("2026-09-01")).rejects.toThrow(
      /you must either provide all parameters or no parameters/,
    );
    expect(seen).toHaveLength(0);
  });

  it("rejects a type other than daily/monthly", async () => {
    await expect(
      makeGarmin().getRacePredictions(
        "2026-09-01",
        "2026-09-22",
        "yearly" as unknown as "daily" | "monthly",
      ),
    ).rejects.toThrow(/type must be "daily" or "monthly"/);
    expect(seen).toHaveLength(0);
  });

  it("rejects a range spanning more than 366 days", async () => {
    await expect(
      makeGarmin().getRacePredictions("2024-01-01", "2026-09-22", "daily"),
    ).rejects.toThrow(/must not exceed 366 days/);
    expect(seen).toHaveLength(0);
  });
});

describe("metrics: training status / fitness age / hill score / cycling FTP / zones", () => {
  it("getTrainingStatus puts cdate in the path", async () => {
    await makeGarmin().getTrainingStatus("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/metrics-service/metrics/trainingstatus/aggregated/2026-09-22`);
  });

  it("getFitnessAgeData puts cdate in the path", async () => {
    await makeGarmin().getFitnessAgeData("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/fitnessage-service/fitnessage/2026-09-22`);
  });

  it("getHillScore no enddate: single-day endpoint with calendarDate", async () => {
    await makeGarmin().getHillScore("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/metrics-service/metrics/hillscore?calendarDate=2026-09-22`);
  });

  it("getHillScore with enddate: range endpoint, hard-coded aggregation=daily (NOT weekly)", async () => {
    await makeGarmin().getHillScore("2026-09-01", "2026-09-22");
    expect(seen[0]!.url).toBe(
      `${API}/metrics-service/metrics/hillscore/stats?startDate=2026-09-01&endDate=2026-09-22&aggregation=daily`,
    );
  });

  it("getCyclingFtp hits the latestFunctionalThresholdPower/CYCLING endpoint", async () => {
    await makeGarmin().getCyclingFtp();
    expect(seen[0]!.url).toBe(
      `${API}/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING`,
    );
  });

  it("getHeartRateZones hits the zero-arg endpoint", async () => {
    const result = await makeGarmin().getHeartRateZones();
    expect(seen[0]!.url).toBe(`${API}/biometric-service/heartRateZones`);
    expect(result).toEqual([{ zoneNumber: 1 }]);
  });

  it("getPowerZones hits the sports/all endpoint", async () => {
    await makeGarmin().getPowerZones();
    expect(seen[0]!.url).toBe(`${API}/biometric-service/powerZones/sports/all`);
  });

  it("getPowerZonesForSport normalizes the sport key into the path", async () => {
    await makeGarmin().getPowerZonesForSport("cycling");
    expect(seen[0]!.url).toBe(`${API}/biometric-service/powerZones/sport/CYCLING`);
  });

  it("getPowerZonesForSport rejects an invalid sport key before any request", async () => {
    await expect(makeGarmin().getPowerZonesForSport("cycling1")).rejects.toThrow(/Invalid sport key/);
    expect(seen).toHaveLength(0);
  });
});
