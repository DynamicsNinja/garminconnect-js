import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminError } from "../../src/errors.js";
import type { Tokens } from "../../src/auth/tokens.js";
import type { FoodLogInput, MealName } from "../../src/types/nutrition.js";

// Food logging. Shapes from the live round-trip on a Connect+ account, 2026-10-06
// (scripts/smoke-nutrition-real.ts).
const API = "https://connectapi.garmin.com";
const seen: { url: string; method: string; body?: unknown }[] = [];
let meals: Record<string, unknown> = {
  meals: [
    { mealId: 1, mealName: "BREAKFAST", startTime: "05:00:00", endTime: "10:59:00" },
    { mealId: 2, mealName: "LUNCH", startTime: "11:00:00", endTime: "15:59:00" },
    { mealId: 3, mealName: "DINNER", startTime: "16:00:00", endTime: "21:59:00" },
    { mealId: 4, mealName: "SNACKS", startTime: "00:00:00", endTime: "23:59:00" },
  ],
};

const record = async (request: Request) => {
  const text = await request.text();
  seen.push({ url: request.url, method: request.method, body: text ? JSON.parse(text) : undefined });
};

const server = setupServer(
  http.get(`${API}/nutrition-service/food/search`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ results: [], moreDataAvailable: false });
  }),
  http.get(`${API}/nutrition-service/food/logs/range`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ dailyNutritionSummaries: [] });
  }),
  http.get(`${API}/nutrition-service/customFood`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ customFoods: [], moreDataAvailable: false });
  }),
  http.get(`${API}/nutrition-service/metadata/customFoodServingUnits`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ servingUnits: [{ name: "G" }] });
  }),
  http.put(`${API}/nutrition-service/customFood`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ foodMetaData: { foodId: "f1" }, nutritionContents: [{ servingId: "s1" }] });
  }),
  http.delete(`${API}/nutrition-service/customFood/:id`, async ({ request }) => {
    await record(request);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(`${API}/nutrition-service/meals/:date`, async ({ request }) => {
    await record(request);
    return HttpResponse.json(meals);
  }),
  http.put(`${API}/nutrition-service/food/logs`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ mealDate: "2026-10-06" });
  }),
  http.put(`${API}/nutrition-service/food/logs/quickAdd`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ mealDate: "2026-10-06" });
  }),
  http.delete(`${API}/nutrition-service/food/logs/:date`, async ({ request }) => {
    await record(request);
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

const last = () => seen[seen.length - 1]!;
const logItem = () => (last().body as { foodLogItems: Record<string, unknown>[] }).foodLogItems[0]!;
const quickItem = () => (last().body as { quickAddItems: Record<string, unknown>[] }).quickAddItems[0]!;

beforeEach(() => {
  seen.length = 0;
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("reads", () => {
  it("searchFoods sends searchExpression/start/limit", async () => {
    await makeGarmin().searchFoods("banana", 0, 3);
    expect(last().url).toBe(`${API}/nutrition-service/food/search?searchExpression=banana&start=0&limit=3`);
  });

  it("searchFoods refuses an empty query", async () => {
    await expect(makeGarmin().searchFoods("  ")).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });

  it("getNutritionFoodLogRange sends the two dates", async () => {
    await makeGarmin().getNutritionFoodLogRange("2026-10-01", "2026-10-06");
    expect(last().url).toBe(`${API}/nutrition-service/food/logs/range?startDate=2026-10-01&endDate=2026-10-06`);
  });

  it("getCustomFoods asks for content and caps limit at Garmin's 20", async () => {
    await makeGarmin().getCustomFoods("gcjs");
    expect(last().url).toBe(
      `${API}/nutrition-service/customFood?searchExpression=gcjs&start=0&limit=20&includeContent=true`,
    );
    await expect(makeGarmin().getCustomFoods("", 0, 21)).rejects.toThrow(/at most 20/);
  });

  it("getCustomFoodServingUnits GETs the metadata list", async () => {
    await expect(makeGarmin().getCustomFoodServingUnits()).resolves.toEqual({ servingUnits: [{ name: "G" }] });
  });
});

describe("custom foods", () => {
  it("createCustomFood PUTs (not POSTs) the food, numbers as strings, per serving", async () => {
    await makeGarmin().createCustomFood({ name: "oats", calories: 160, carbs: 27, protein: 5.5, brand: "x" });
    expect(last().method).toBe("PUT");
    expect(last().body).toEqual({
      foodMetaData: { foodName: "oats", foodType: "GENERIC", source: "GARMIN", regionCode: "US", languageCode: "en", brandName: "x" },
      nutritionContents: [{ servingUnit: "G", numberOfUnits: "100", calories: "160", carbs: "27", protein: "5.5" }],
    });
  });

  it("updateCustomFood is the same PUT carrying foodId and servingId", async () => {
    await makeGarmin().updateCustomFood("f1", "s1", { name: "oats", calories: 170 });
    expect(last().body).toEqual({
      foodMetaData: { foodId: "f1", foodName: "oats", foodType: "GENERIC", source: "GARMIN", regionCode: "US", languageCode: "en" },
      nutritionContents: [{ servingId: "s1", servingUnit: "G", numberOfUnits: "100", calories: "170" }],
    });
  });

  it("rejects a blank name or a negative nutrient before any request", async () => {
    await expect(makeGarmin().createCustomFood({ name: "", calories: 1 })).rejects.toThrow(GarminError);
    await expect(makeGarmin().createCustomFood({ name: "x", calories: 1, fat: -1 })).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });

  it("deleteCustomFood DELETEs by id, encoded", async () => {
    await makeGarmin().deleteCustomFood("../x");
    expect(last()).toMatchObject({ url: `${API}/nutrition-service/customFood/..%2Fx`, method: "DELETE" });
  });
});

describe("logFood / quickAddFood meal resolution", () => {
  it("puts an explicit time into the meal whose window holds it", async () => {
    await makeGarmin().logFood({ date: "2026-10-06", time: "12:30", foodId: "f1", servingId: "s1", servings: 1.5 });
    expect(last().url).toBe(`${API}/nutrition-service/food/logs`);
    expect(logItem()).toMatchObject({
      mealId: 2,
      mealTime: "12:30:00",
      foodId: "f1",
      servingId: "s1",
      servingQty: 1.5,
      source: "GARMIN",
      logCategory: "REGULAR_LOG",
      action: "ADD",
    });
    expect((last().body as { mealDate: string }).mealDate).toBe("2026-10-06");
  });

  it("falls back to SNACKS for a time in no other meal's window", async () => {
    await makeGarmin().logFood({ date: "2026-10-06", time: "23:00", foodId: "f1", servingId: "s1" });
    expect(logItem()).toMatchObject({ mealId: 4, mealTime: "23:00:00" });
  });

  it.each<[MealName, number, string]>([
    ["BREAKFAST", 1, "05:00:00"],
    ["DINNER", 3, "16:00:00"],
    // SNACKS' window holds everyone else's, and Garmin 400s a snack inside LUNCH ("overlap"):
    // so the first minute after another meal ends, inside no other window, is chosen.
    ["SNACKS", 4, "22:00:00"],
  ])("a named meal with no time (%s) gets a time Garmin accepts", async (meal, mealId, time) => {
    await makeGarmin().quickAddFood({ date: "2026-10-06", meal, name: "bar", calories: 200, carbs: 20, protein: 10, fat: 8 });
    expect(quickItem()).toMatchObject({ mealId, mealTime: time, logCategory: "QUICK_ADD", calories: "200", logId: null });
  });

  it("with neither meal nor time, logs into LUNCH at its start", async () => {
    await makeGarmin().logFood({ date: "2026-10-06", foodId: "f1", servingId: "s1" });
    expect(logItem()).toMatchObject({ mealId: 2, mealTime: "11:00:00" });
  });

  it("explains a missing nutrition setup instead of sending a request Garmin will 400", async () => {
    const original = meals;
    meals = { meals: [] };
    try {
      await expect(makeGarmin().logFood({ date: "2026-10-06", foodId: "f1", servingId: "s1" })).rejects.toThrow(
        /No meals are set up/,
      );
      expect(seen.filter((s) => s.method === "PUT")).toHaveLength(0);
    } finally {
      meals = original;
    }
  });

  it.each<[Partial<FoodLogInput>, string]>([
    [{ time: "25:00" }, "bad time"],
    [{ servings: 0 }, "zero servings"],
    [{ meal: "BRUNCH" as MealName }, "unknown meal"],
  ])("rejects %j (%s)", async (extra) => {
    await expect(
      makeGarmin().logFood({ date: "2026-10-06", foodId: "f1", servingId: "s1", ...extra }),
    ).rejects.toThrow(GarminError);
    expect(seen.filter((s) => s.method === "PUT")).toHaveLength(0);
  });
});

describe("deleteFoodLogs", () => {
  it("DELETEs the day with every logId in one body", async () => {
    await makeGarmin().deleteFoodLogs("2026-10-06", ["a", "b"]);
    expect(last()).toEqual({
      url: `${API}/nutrition-service/food/logs/2026-10-06`,
      method: "DELETE",
      body: { logIds: ["a", "b"] },
    });
  });

  it("refuses an empty list", async () => {
    await expect(makeGarmin().deleteFoodLogs("2026-10-06", [])).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});
