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
  http.get(`${API}/nutrition-service/food/logs/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ totalCalories: 1800 });
  }),

  http.get(`${API}/nutrition-service/meals/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ meals: [] });
  }),

  http.get(`${API}/nutrition-service/settings/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ calorieGoal: 2000 });
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

describe("getNutritionDailyFoodLog", () => {
  it("hits food/logs/{cdate}", async () => {
    const result = await makeGarmin().getNutritionDailyFoodLog("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/nutrition-service/food/logs/2026-09-22`);
    expect(result).toEqual({ totalCalories: 1800 });
  });

  it("routes a Date through formatDate", async () => {
    await makeGarmin().getNutritionDailyFoodLog(new Date("2026-09-22T00:00:00Z"));
    expect(seen[0]!.url).toBe(`${API}/nutrition-service/food/logs/2026-09-22`);
  });
});

describe("getNutritionDailyMeals", () => {
  it("hits meals/{cdate}", async () => {
    const result = await makeGarmin().getNutritionDailyMeals("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/nutrition-service/meals/2026-09-22`);
    expect(result).toEqual({ meals: [] });
  });
});

describe("getNutritionDailySettings", () => {
  it("hits settings/{cdate}", async () => {
    const result = await makeGarmin().getNutritionDailySettings("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/nutrition-service/settings/2026-09-22`);
    expect(result).toEqual({ calorieGoal: 2000 });
  });
});
