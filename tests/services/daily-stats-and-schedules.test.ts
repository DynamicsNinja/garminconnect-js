import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminError } from "../../src/errors.js";
import type { Tokens } from "../../src/auth/tokens.js";
import type { DailyStatsType } from "../../src/types/wellness.js";

// getDailyStats, getScheduledWorkoutSummaries and getTrainingPlanWorkouts. Shapes from the live
// probes on 2026-10-06: the stats rows from a real account (read-only), the GraphQL payloads from
// the test account.
const API = "https://connectapi.garmin.com";
const seen: { url: string; method: string; body?: unknown }[] = [];
let graphql: Record<string, unknown> | null = null;

const day = (calendarDate: string) => ({
  calendarDate,
  values: { totalSteps: 1000, totalDistance: 800, stepGoal: 5000 },
});

const SUMMARY = {
  scheduledWorkoutId: 1787582002,
  workoutUuid: null,
  workoutId: 1708305054,
  workoutName: "10 Min. Tempo Intervals",
  workoutType: "cycling",
  scheduleDate: "2026-10-06",
  itpPlanId: 47816711,
  trainingPlanId: 47816711,
  tpType: "ITP",
  race: false,
};

const server = setupServer(
  http.get(`${API}/usersummary-service/stats/daily/:start/:end`, ({ request, params }) => {
    seen.push({ url: request.url, method: request.method });
    return HttpResponse.json({
      values: [day(String(params["start"])), day(String(params["end"]))],
      aggregations: { totalStepsAverage: 1000 },
    });
  }),
  http.post(`${API}/graphql-gateway/graphql`, async ({ request }) => {
    seen.push({ url: request.url, method: request.method, body: await request.json() });
    return HttpResponse.json(graphql);
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
  graphql = null;
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("getDailyStats", () => {
  it("sends statsType and returns the day rows, without Garmin's per-request aggregations", async () => {
    const rows = await makeGarmin().getDailyStats("2026-09-01", "2026-09-10", "STEPS");
    expect(seen.map((s) => s.url)).toEqual([
      `${API}/usersummary-service/stats/daily/2026-09-01/2026-09-10?statsType=STEPS`,
    ]);
    expect(rows).toEqual([day("2026-09-01"), day("2026-09-10")]);
  });

  it("keeps a 28-day range in one request and splits a 29-day one (Garmin 400s on end-start > 27)", async () => {
    await makeGarmin().getDailyStats("2026-09-01", "2026-09-28", "CALORIES");
    expect(seen).toHaveLength(1);
    seen.length = 0;
    await makeGarmin().getDailyStats("2026-09-01", "2026-09-29", "CALORIES");
    expect(seen.map((s) => new URL(s.url).pathname)).toEqual([
      "/usersummary-service/stats/daily/2026-09-01/2026-09-28",
      "/usersummary-service/stats/daily/2026-09-29/2026-09-29",
    ]);
  });

  it("returns [] when Garmin has no data (it answers null)", async () => {
    server.use(http.get(`${API}/usersummary-service/stats/daily/:start/:end`, () => HttpResponse.json(null)));
    await expect(makeGarmin().getDailyStats("2026-09-01", "2026-09-02", "STEPS")).resolves.toEqual([]);
  });

  it("rejects a reversed range or another statsType before any request", async () => {
    await expect(makeGarmin().getDailyStats("2026-09-02", "2026-09-01", "STEPS")).rejects.toThrow(GarminError);
    await expect(
      makeGarmin().getDailyStats("2026-09-01", "2026-09-02", "steps" as DailyStatsType),
    ).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("getScheduledWorkoutSummaries", () => {
  it("POSTs the fixed workoutScheduleSummariesScalar query and returns its rows", async () => {
    graphql = { data: { workoutScheduleSummariesScalar: [SUMMARY] } };
    await expect(makeGarmin().getScheduledWorkoutSummaries("2026-10-01", "2026-10-31")).resolves.toEqual([SUMMARY]);
    expect(seen[0]!.body).toEqual({
      query: 'query{workoutScheduleSummariesScalar(startDate:"2026-10-01", endDate:"2026-10-31")}',
    });
  });

  it("returns [] when data is null", async () => {
    graphql = { data: null };
    await expect(makeGarmin().getScheduledWorkoutSummaries("2026-10-01", "2026-10-31")).resolves.toEqual([]);
  });

  it("turns a GraphQL error (HTTP 200 with errors) into a throw", async () => {
    graphql = { errors: [{ message: "Validation error of type WrongType" }] };
    await expect(makeGarmin().getScheduledWorkoutSummaries("2026-10-01", "2026-10-31")).rejects.toThrow(
      /WrongType/,
    );
  });

  it("validates the dates, so nothing a caller passes reaches the query text unchecked", async () => {
    await expect(
      makeGarmin().getScheduledWorkoutSummaries('2026-10-01"){x}', "2026-10-31"),
    ).rejects.toThrow(GarminError);
    await expect(makeGarmin().getScheduledWorkoutSummaries("2026-10-31", "2026-10-01")).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("getTrainingPlanWorkouts", () => {
  const PLAN = {
    trainingPlanId: 47816711,
    planName: "Century Plan",
    trainingPlanClassification: "ITP",
    trainingPlanDetailsDTO: { trainingType: "CYCLING" },
    workoutScheduleSummaries: [SUMMARY],
  };

  it("POSTs trainingPlanScalar with Garmin's three required arguments and unwraps the plan list", async () => {
    graphql = { data: { trainingPlanScalar: { trainingPlanWorkoutScheduleDTOS: [PLAN] } } };
    await expect(makeGarmin().getTrainingPlanWorkouts("2026-10-06")).resolves.toEqual([PLAN]);
    expect(seen[0]!.body).toEqual({
      query: 'query{trainingPlanScalar(calendarDate:"2026-10-06", lang:"en-US", firstDayOfWeek:"monday")}',
    });
  });

  it("passes firstDayOfWeek and lang through", async () => {
    graphql = { data: { trainingPlanScalar: { trainingPlanWorkoutScheduleDTOS: [] } } };
    await expect(
      makeGarmin().getTrainingPlanWorkouts("2026-10-06", { firstDayOfWeek: "sunday", lang: "de-DE" }),
    ).resolves.toEqual([]);
    expect((seen[0]!.body as { query: string }).query).toContain('lang:"de-DE", firstDayOfWeek:"sunday"');
  });

  it("rejects a malformed lang or firstDayOfWeek before any request", async () => {
    await expect(makeGarmin().getTrainingPlanWorkouts("2026-10-06", { lang: 'en"){x}' })).rejects.toThrow(GarminError);
    await expect(
      makeGarmin().getTrainingPlanWorkouts("2026-10-06", { firstDayOfWeek: "friday" as "monday" }),
    ).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});
