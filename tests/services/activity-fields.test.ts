import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminError } from "../../src/errors.js";
import type { Tokens } from "../../src/auth/tokens.js";
import type { ActivityEventTypeKey, ActivityFeel } from "../../src/types/activities.js";

// getActivityEventTypes / setActivityEventType / setActivityPerceivedEffort / setActivityFeel.
// Shapes from the live round-trip on 2026-10-06 (smoke:gaps).
const API = "https://connectapi.garmin.com";
const seen: { url: string; method: string; body?: unknown }[] = [];

const EVENT_TYPES = [
  { typeId: 1, typeKey: "race", sortOrder: 5 },
  { typeId: 4, typeKey: "training", sortOrder: 7 },
];

const server = setupServer(
  http.get(`${API}/activity-service/activity/eventTypes`, ({ request }) => {
    seen.push({ url: request.url, method: request.method });
    return HttpResponse.json(EVENT_TYPES);
  }),
  http.put(`${API}/activity-service/activity/:id`, async ({ request }) => {
    seen.push({ url: request.url, method: request.method, body: await request.json() });
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

describe("getActivityEventTypes", () => {
  it("GETs the event-type list", async () => {
    await expect(makeGarmin().getActivityEventTypes()).resolves.toEqual(EVENT_TYPES);
    expect(seen[0]!.url).toBe(`${API}/activity-service/activity/eventTypes`);
  });
});

describe("setActivityEventType", () => {
  it("PUTs a partial update carrying only the typeKey", async () => {
    await makeGarmin().setActivityEventType(123, "race");
    expect(seen[0]).toEqual({
      url: `${API}/activity-service/activity/123`,
      method: "PUT",
      body: { activityId: 123, eventTypeDTO: { typeKey: "race" } },
    });
  });

  it("rejects an unknown key before sending anything", async () => {
    await expect(makeGarmin().setActivityEventType(123, "marathon" as ActivityEventTypeKey)).rejects.toThrow(
      GarminError,
    );
    expect(seen).toHaveLength(0);
  });

  it("encodes the activity id", async () => {
    await makeGarmin().setActivityEventType("../x", "training");
    expect(seen[0]!.url).toBe(`${API}/activity-service/activity/..%2Fx`);
  });
});

describe("setActivityPerceivedEffort", () => {
  it("sends the RPE times ten, nested in summaryDTO", async () => {
    await makeGarmin().setActivityPerceivedEffort(123, 7);
    expect(seen[0]!.body).toEqual({ activityId: 123, summaryDTO: { directWorkoutRpe: 70 } });
  });

  it("sends null to clear it", async () => {
    await makeGarmin().setActivityPerceivedEffort(123, null);
    expect(seen[0]!.body).toEqual({ activityId: 123, summaryDTO: { directWorkoutRpe: null } });
  });

  it.each([0, 11, 7.5, Number.NaN])("rejects %s before sending anything", async (rpe) => {
    await expect(makeGarmin().setActivityPerceivedEffort(123, rpe)).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("setActivityFeel", () => {
  it.each([0, 25, 50, 75, 100] as const)("sends feel %s as directWorkoutFeel", async (feel) => {
    await makeGarmin().setActivityFeel(123, feel);
    expect(seen[0]!.body).toEqual({ activityId: 123, summaryDTO: { directWorkoutFeel: feel } });
  });

  it("sends null to clear it", async () => {
    await makeGarmin().setActivityFeel(123, null);
    expect(seen[0]!.body).toEqual({ activityId: 123, summaryDTO: { directWorkoutFeel: null } });
  });

  it("rejects a value Garmin Connect cannot display, though Garmin would store it", async () => {
    await expect(makeGarmin().setActivityFeel(123, 30 as ActivityFeel)).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});
