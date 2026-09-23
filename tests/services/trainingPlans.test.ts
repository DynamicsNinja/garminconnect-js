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

  http.get(`${API}/trainingplan-service/trainingplan/plans`, ({ request }) => {
    record(request);
    return HttpResponse.json({ plans: [] });
  }),

  http.get(`${API}/trainingplan-service/trainingplan/phased/:planId`, ({ request }) => {
    record(request);
    return HttpResponse.json({ planId: 123, phases: [] });
  }),

  http.get(`${API}/trainingplan-service/trainingplan/fbt-adaptive/:planId`, ({ request }) => {
    record(request);
    return HttpResponse.json({ planId: 456, adaptive: true });
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

describe("getTrainingPlans", () => {
  it("hits trainingplan/plans with no params", async () => {
    const result = await makeGarmin().getTrainingPlans();
    expect(seen[0]!.url).toBe(`${API}/trainingplan-service/trainingplan/plans`);
    expect(result).toEqual({ plans: [] });
  });
});

describe("getTrainingPlanById", () => {
  it("hits trainingplan/phased/{planId}", async () => {
    const result = await makeGarmin().getTrainingPlanById(123);
    expect(seen[0]!.url).toBe(`${API}/trainingplan-service/trainingplan/phased/123`);
    expect(result).toEqual({ planId: 123, phases: [] });
  });

  it("accepts a string planId", async () => {
    await makeGarmin().getTrainingPlanById("123");
    expect(seen[0]!.url).toBe(`${API}/trainingplan-service/trainingplan/phased/123`);
  });
});

describe("getAdaptiveTrainingPlanById", () => {
  it("hits trainingplan/fbt-adaptive/{planId} — distinct sub-path from the phased endpoint", async () => {
    const result = await makeGarmin().getAdaptiveTrainingPlanById(456);
    expect(seen[0]!.url).toBe(
      `${API}/trainingplan-service/trainingplan/fbt-adaptive/456`,
    );
    expect(result).toEqual({ planId: 456, adaptive: true });
  });
});
