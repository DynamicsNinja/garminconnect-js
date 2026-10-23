import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminError } from "../../src/errors.js";
import type { Tokens } from "../../src/auth/tokens.js";

// The methods added from Garmin's Personal API spec: searchActivities, getActivityWorkouts,
// getDailyStress, getDailyHydration, getSpo2Acclimation, getWeightGoals. Behaviour (limits, which
// filters work, how lists are sent) is from read-only probes of a real account on 2026-10-23.
const API = "https://connectapi.garmin.com";
const seen: URL[] = [];
let body: JsonBodyType = [];

const server = setupServer(
  http.get(`${API}/*`, ({ request }) => {
    seen.push(new URL(request.url));
    return HttpResponse.json(body);
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
  body = [];
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("searchActivities", () => {
  it("defaults to the first 20 and sends nothing else", async () => {
    await makeGarmin().searchActivities();
    expect(seen[0]!.pathname).toBe("/activitylist-service/activities/search/activities");
    expect([...seen[0]!.searchParams]).toEqual([
      ["start", "0"],
      ["limit", "20"],
    ]);
  });

  it("maps every filter onto Garmin's parameter names", async () => {
    await makeGarmin().searchActivities({
      start: 40,
      limit: 10,
      search: "tempo",
      activityType: "running",
      activitySubType: "trail_running",
      eventType: "race",
      startDate: "2026-09-01",
      endDate: new Date("2026-09-30T12:00:00Z"),
      minDistance: 5000,
      maxDistance: 10000,
      minDuration: 600,
      maxDuration: 3600,
      minElapsedDuration: 700,
      maxElapsedDuration: 4000,
      minElevation: 10,
      maxElevation: 500,
      minAvgPower: 200,
      excludeChildren: false,
      sortBy: "distance",
      sortOrder: "asc",
      boundingBox: { north: 45.9, south: 45.7, east: 16.1, west: 15.9 },
      minMaxDepth: 500,
      maxMaxDepth: 3000,
      decoDive: true,
      minBottomTime: 60,
      maxBottomTime: 600,
    });
    expect(Object.fromEntries(seen[0]!.searchParams)).toEqual({
      start: "40",
      limit: "10",
      search: "tempo",
      activityType: "running",
      activitySubType: "trail_running",
      eventType: "race",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      minDistance: "5000",
      maxDistance: "10000",
      minDuration: "600",
      maxDuration: "3600",
      minElapsedDuration: "700",
      maxElapsedDuration: "4000",
      minElevation: "10",
      maxElevation: "500",
      minAvgPower: "200",
      excludeChildren: "false",
      sortBy: "distance",
      sortOrder: "asc",
      upperLatitude: "45.9",
      lowerLatitude: "45.7",
      rightLongitude: "16.1",
      leftLongitude: "15.9",
      lowerMaxDepth: "500",
      upperMaxDepth: "3000",
      decoDive: "true",
      minBottomTime: "60",
      maxBottomTime: "600",
    });
  });

  it("sends lists as REPEATED parameters: Garmin returns nothing for a comma-joined one", async () => {
    await makeGarmin().searchActivities({
      requiredFields: ["maxPower", "avgPower"],
      excludedActivitySubTypes: ["treadmill_running", "indoor_cycling"],
    });
    expect(seen[0]!.searchParams.getAll("requiredField")).toEqual(["maxPower", "avgPower"]);
    expect(seen[0]!.searchParams.getAll("excludedActivitySubType")).toEqual(["treadmill_running", "indoor_cycling"]);
  });

  it("sends favorite as Garmin's 1/0", async () => {
    await makeGarmin().searchActivities({ favorite: true });
    await makeGarmin().searchActivities({ favorite: false });
    expect(seen.map((u) => u.searchParams.get("favorite"))).toEqual(["1", "0"]);
  });

  it("returns the rows, and [] for an empty body", async () => {
    body = [{ activityId: 1 }, { activityId: 2 }];
    await expect(makeGarmin().searchActivities({ limit: 2 })).resolves.toEqual([{ activityId: 1 }, { activityId: 2 }]);
    body = null;
    await expect(makeGarmin().searchActivities()).resolves.toEqual([]);
  });

  it("refuses what Garmin would silently get wrong, before any request", async () => {
    const g = makeGarmin();
    await expect(g.searchActivities({ startDate: "2026-09-02", endDate: "2026-09-01" })).rejects.toThrow(GarminError);
    await expect(
      g.searchActivities({ boundingBox: { north: 45.7, south: 45.9, east: 16.1, west: 15.9 } }),
    ).rejects.toThrow(/boundingBox/);
    await expect(
      g.searchActivities({ boundingBox: { north: 45.9, south: 45.7, east: 16.1 } as never }),
    ).rejects.toThrow(/boundingBox/);
    await expect(g.searchActivities({ limit: 0 })).rejects.toThrow(GarminError);
    await expect(g.searchActivities({ start: -1 })).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("getActivityWorkouts", () => {
  it("GETs the activity's workouts, [] when Garmin sends nothing", async () => {
    body = [{ index: 0, workoutName: "Tempo", steps: [] }];
    await expect(makeGarmin().getActivityWorkouts(123)).resolves.toEqual(body);
    expect(seen[0]!.pathname).toBe("/activity-service/activity/123/workouts");
    body = null;
    await expect(makeGarmin().getActivityWorkouts(123)).resolves.toEqual([]);
  });
});

describe("getDailyStress", () => {
  it("keeps 28 days in one request and splits 29 (Garmin 400s end - start > 27)", async () => {
    await makeGarmin().getDailyStress("2026-09-01", "2026-09-28");
    expect(seen.map((u) => u.pathname)).toEqual(["/usersummary-service/stats/stress/daily/2026-09-01/2026-09-28"]);
    seen.length = 0;
    await makeGarmin().getDailyStress("2026-09-01", "2026-09-29");
    expect(seen.map((u) => u.pathname)).toEqual([
      "/usersummary-service/stats/stress/daily/2026-09-01/2026-09-28",
      "/usersummary-service/stats/stress/daily/2026-09-29/2026-09-29",
    ]);
  });

  it("concatenates the windows' rows and rejects a reversed range", async () => {
    body = [{ calendarDate: "x", values: { overallStressLevel: 30 } }];
    await expect(makeGarmin().getDailyStress("2026-09-01", "2026-09-29")).resolves.toHaveLength(2);
    seen.length = 0;
    await expect(makeGarmin().getDailyStress("2026-09-02", "2026-09-01")).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("getDailyHydration", () => {
  it("keeps 31 days in one request and splits 32 (Garmin 400s end - start > 30)", async () => {
    await makeGarmin().getDailyHydration("2026-08-01", "2026-08-31");
    expect(seen).toHaveLength(1);
    seen.length = 0;
    await makeGarmin().getDailyHydration("2026-08-01", "2026-09-01");
    expect(seen.map((u) => u.pathname)).toEqual([
      "/usersummary-service/stats/hydration/daily/2026-08-01/2026-08-31",
      "/usersummary-service/stats/hydration/daily/2026-09-01/2026-09-01",
    ]);
  });
});

describe("getSpo2Acclimation", () => {
  it("GETs the day's spo2acclimation record", async () => {
    body = { calendarDate: "2026-10-22", averageSpO2: 96 };
    await expect(makeGarmin().getSpo2Acclimation("2026-10-22")).resolves.toEqual(body);
    expect(seen[0]!.pathname).toBe("/wellness-service/wellness/daily/spo2acclimation/2026-10-22");
  });
});

describe("getWeightGoals", () => {
  it("GETs the effective weight goals for the range, rejecting a reversed one first", async () => {
    body = { userGoals: [], userGoalRanges: null };
    await expect(makeGarmin().getWeightGoals("2026-01-01", "2026-10-22")).resolves.toEqual(body);
    expect(seen[0]!.pathname).toBe("/goal-service/goal/user/effective/weightgoal/2026-01-01/2026-10-22");
    await expect(makeGarmin().getWeightGoals("2026-10-22", "2026-01-01")).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(1);
  });
});

describe("repeated query parameters", () => {
  it("an array value repeats the key and replaces one already in the path", async () => {
    const client = new GarminClient();
    client.setTokens(tokens);
    await client.connectapi("/x?tag=old&keep=1", { params: { tag: ["a", "b"], n: [1, 2] } });
    expect(seen[0]!.searchParams.getAll("tag")).toEqual(["a", "b"]);
    expect(seen[0]!.searchParams.getAll("n")).toEqual(["1", "2"]);
    expect(seen[0]!.searchParams.get("keep")).toBe("1");
  });
});
