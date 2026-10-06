import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../src/client.js";
import { Garmin } from "../src/garmin.js";
import { GarminAuthError, GarminConnectPlusRequiredError, GarminError } from "../src/errors.js";
import { CONNECT_PLUS_METHODS } from "../src/connect-plus.js";
import { GARMIN_METHODS } from "../src/manifest.js";
import type { Tokens } from "../src/auth/tokens.js";

// The two profile shapes, trimmed from the live comparison on 2026-10-06: an account without
// Connect+ and one with it.
const API = "https://connectapi.garmin.com";
const FREE = { displayName: "free", profileId: 1, hasPremiumSocialIcon: false, userRoles: ["SCOPE_CONNECT_READ"] };
const PLUS = {
  displayName: "plus",
  profileId: 2,
  hasPremiumSocialIcon: true,
  userRoles: ["SCOPE_CONNECT_READ", "ROLE_SP_FEATURE_1", "ROLE_SP_FEATURE_2"],
};
let profile: Record<string, unknown> = FREE;
let meals: Record<string, unknown> = { meals: [] };

const forbidden = () => HttpResponse.json({ message: "HTTP 403 Forbidden", error: "ForbiddenException" }, { status: 403 });
const server = setupServer(
  http.get(`${API}/userprofile-service/socialProfile`, () => HttpResponse.json(profile)),
  http.get(`${API}/nutrition-service/food/search`, forbidden),
  http.get(`${API}/nutrition-service/customFood`, forbidden),
  http.put(`${API}/nutrition-service/customFood`, forbidden),
  http.put(`${API}/nutrition-service/food/logs/quickAdd`, forbidden),
  http.delete(`${API}/nutrition-service/food/logs/:date`, forbidden),
  http.get(`${API}/nutrition-service/meals/:date`, () => HttpResponse.json(meals)),
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
  const client = new GarminClient({ retries: 0 });
  client.setTokens(tokens);
  return new Garmin(client);
}

beforeEach(() => {
  profile = FREE;
  meals = { meals: [] };
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("hasConnectPlus", () => {
  it("is false for a profile with no premium icon and no subscription-feature roles", async () => {
    await expect(makeGarmin().hasConnectPlus()).resolves.toBe(false);
  });

  it("is true for the Connect+ profile", async () => {
    profile = PLUS;
    await expect(makeGarmin().hasConnectPlus()).resolves.toBe(true);
  });

  it("counts either signal on its own", async () => {
    profile = { ...FREE, hasPremiumSocialIcon: true };
    await expect(makeGarmin().hasConnectPlus()).resolves.toBe(true);
    profile = { ...FREE, userRoles: ["ROLE_SP_FEATURE_7"] };
    await expect(makeGarmin().hasConnectPlus()).resolves.toBe(true);
  });
});

describe("Connect+ methods without Connect+", () => {
  it.each<[string, (g: Garmin) => Promise<unknown>]>([
    ["searchFoods", (g) => g.searchFoods("banana")],
    ["getCustomFoods", (g) => g.getCustomFoods()],
    ["createCustomFood", (g) => g.createCustomFood({ name: "x", calories: 1 })],
    ["deleteFoodLogs", (g) => g.deleteFoodLogs("2026-10-06", ["a"])],
  ])("%s turns Garmin's 403 into GarminConnectPlusRequiredError", async (method, call) => {
    const error = await call(makeGarmin()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GarminConnectPlusRequiredError);
    // Deliberately NOT an auth error: a caller (or the MCP server) that re-signs-in on
    // GarminAuthError must not do so for a missing subscription.
    expect(error).not.toBeInstanceOf(GarminAuthError);
    expect((error as GarminConnectPlusRequiredError).method).toBe(method);
    expect((error as Error).message).toMatch(/Connect\+/);
    expect((error as Error).cause).toBeInstanceOf(GarminAuthError);
  });

  it("keeps a 403 as GarminAuthError when the account DOES have Connect+", async () => {
    profile = PLUS;
    const error = await makeGarmin().searchFoods("banana").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GarminAuthError);
    expect(error).not.toBeInstanceOf(GarminConnectPlusRequiredError);
  });

  it("logFood / quickAddFood name the missing subscription instead of 'no meals set up'", async () => {
    await expect(
      makeGarmin().quickAddFood({ date: "2026-10-06", name: "x", calories: 1, carbs: 0, protein: 0, fat: 0 }),
    ).rejects.toBeInstanceOf(GarminConnectPlusRequiredError);
    profile = PLUS;
    const error = await makeGarmin()
      .logFood({ date: "2026-10-06", foodId: "f", servingId: "s" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GarminError);
    expect(error).not.toBeInstanceOf(GarminConnectPlusRequiredError);
    expect((error as Error).message).toMatch(/No meals are set up/);
  });
});

describe("CONNECT_PLUS_METHODS stays in step", () => {
  it("names only real Garmin methods", () => {
    for (const name of CONNECT_PLUS_METHODS) {
      expect(typeof (Garmin.prototype as unknown as Record<string, unknown>)[name], name).toBe("function");
    }
  });

  it("is exactly the set the manifest marks requiresConnectPlus", () => {
    const flagged = GARMIN_METHODS.filter((m) => m.requiresConnectPlus).map((m) => m.name).sort();
    expect(flagged).toEqual([...CONNECT_PLUS_METHODS].sort());
  });

  it("is said in each method's AGENTS.md row", () => {
    const agents = readFileSync(fileURLToPath(new URL("../AGENTS.md", import.meta.url)), "utf8");
    for (const name of CONNECT_PLUS_METHODS) {
      const row = agents.split(/\r?\n/).find((l) => l.startsWith(`| \`${name}\``)) ?? "";
      expect(row, name).toMatch(/Connect\+/);
    }
  });
});
