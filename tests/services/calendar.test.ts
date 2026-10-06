import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminError } from "../../src/errors.js";
import type { Tokens } from "../../src/auth/tokens.js";
import type {
  CalendarEvent,
  CalendarEventDistanceUnit,
  CalendarEventInput,
} from "../../src/types/calendar.js";

// Shapes trimmed from the live round-trip on 2026-10-06 (smoke:gaps).
const API = "https://connectapi.garmin.com";
const seen: { url: string; method: string; body?: unknown }[] = [];

const STORED: CalendarEvent = {
  id: 30355817,
  eventName: "probe 10k",
  date: "2026-11-22",
  url: "https://example.com/race",
  completionTarget: { value: 10, unit: "kilometer", unitType: "distance" },
  eventTimeLocal: { startTimeHhMm: "09:30", timeZoneId: "Europe/Paris" },
  note: "probe note",
  location: "Zagreb",
  eventType: "running",
  eventPrivacy: { label: "PRIVATE", isShareable: false, isDiscoverable: false },
  shareableEventUuid: null,
  eventCustomization: {
    customGoal: { value: 2700, unit: "second", unitType: "time" },
    isPrimaryEvent: true,
    isTrainingEvent: true,
    enrollmentTime: "2026-10-06T04:11:19.33",
  },
  provider: "gc-discoverable-events",
  race: true,
};

const server = setupServer(
  http.get(`${API}/calendar-service/events`, ({ request }) => {
    seen.push({ url: request.url, method: request.method });
    return HttpResponse.json([STORED]);
  }),
  http.get(`${API}/calendar-service/event/:id`, ({ request }) => {
    seen.push({ url: request.url, method: request.method });
    return HttpResponse.json(STORED);
  }),
  http.post(`${API}/calendar-service/event`, async ({ request }) => {
    const body = await request.json();
    seen.push({ url: request.url, method: request.method, body });
    return HttpResponse.json({ ...STORED, ...(body as object) });
  }),
  http.put(`${API}/calendar-service/event/:id`, async ({ request }) => {
    seen.push({ url: request.url, method: request.method, body: await request.json() });
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete(`${API}/calendar-service/event/:id`, ({ request }) => {
    seen.push({ url: request.url, method: request.method });
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

describe("listCalendarEvents", () => {
  it("sends the date range as startDate/endDate", async () => {
    await expect(makeGarmin().listCalendarEvents("2026-11-01", new Date("2026-11-30T12:00:00Z"))).resolves.toEqual([
      STORED,
    ]);
    expect(seen[0]!.url).toBe(`${API}/calendar-service/events?startDate=2026-11-01&endDate=2026-11-30`);
  });

  it("sends no params at all for every event", async () => {
    await makeGarmin().listCalendarEvents();
    expect(seen[0]!.url).toBe(`${API}/calendar-service/events`);
  });

  it("refuses only one of the two dates", async () => {
    await expect(makeGarmin().listCalendarEvents("2026-11-01")).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("getCalendarEvent / deleteCalendarEvent", () => {
  it("GETs by id, encoding it", async () => {
    await makeGarmin().getCalendarEvent("../x");
    expect(seen[0]!.url).toBe(`${API}/calendar-service/event/..%2Fx`);
  });

  it("DELETEs by id and resolves to null", async () => {
    await expect(makeGarmin().deleteCalendarEvent(30355817)).resolves.toBeNull();
    expect(seen[0]).toEqual({ url: `${API}/calendar-service/event/30355817`, method: "DELETE" });
  });
});

describe("createCalendarEvent", () => {
  it("sends only name and date for a minimal event", async () => {
    await makeGarmin().createCalendarEvent({ name: "probe race", date: "2026-11-15" });
    expect(seen[0]!.body).toEqual({ eventName: "probe race", date: "2026-11-15" });
  });

  it("maps every option onto the body Garmin's calendar stores", async () => {
    await makeGarmin().createCalendarEvent({
      name: "probe 10k",
      date: "2026-11-22",
      startTime: "09:30",
      timeZoneId: "Europe/London",
      eventType: "running",
      race: true,
      primary: true,
      distance: { value: 10, unit: "kilometer" },
      goalTimeSeconds: 2700,
      location: "Zagreb",
      url: "https://example.com/race",
      note: "probe note",
    });
    expect(seen[0]!.body).toEqual({
      eventName: "probe 10k",
      date: "2026-11-22",
      eventTimeLocal: { startTimeHhMm: "09:30", timeZoneId: "Europe/London" },
      eventType: "running",
      race: true,
      completionTarget: { value: 10, unit: "kilometer", unitType: "distance" },
      eventCustomization: { customGoal: { value: 2700, unit: "second", unitType: "time" }, isPrimaryEvent: true },
      location: "Zagreb",
      url: "https://example.com/race",
      note: "probe note",
    });
  });

  it.each<[CalendarEventInput, string]>([
    [{ name: " ", date: "2026-11-15" }, "blank name"],
    [{ name: "x", date: "2026-11-15", startTime: "09:30" }, "time without zone"],
    [{ name: "x", date: "2026-11-15", timeZoneId: "Europe/London" }, "zone without time"],
    [{ name: "x", date: "2026-11-15", startTime: "9:30", timeZoneId: "Europe/London" }, "time not HH:MM"],
    [{ name: "x", date: "2026-11-15", distance: { value: 0, unit: "kilometer" } }, "zero distance"],
    [{ name: "x", date: "2026-11-15", distance: { value: 5, unit: "furlong" as CalendarEventDistanceUnit } }, "unknown unit"],
    [{ name: "x", date: "2026-11-15", goalTimeSeconds: -1 }, "negative goal"],
    [{ name: "x", date: "2026-02-30" }, "impossible date"],
  ])("rejects %j (%s) before any request", async (input) => {
    await expect(makeGarmin().createCalendarEvent(input)).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("updateCalendarEvent", () => {
  it("reads the event, overlays the changes, and PUTs the whole record back", async () => {
    await makeGarmin().updateCalendarEvent(30355817, {
      name: "renamed",
      note: null,
      race: false,
      goalTimeSeconds: 2600,
    });
    expect(seen.map((s) => s.method)).toEqual(["GET", "PUT"]);
    expect(seen[1]!.url).toBe(`${API}/calendar-service/event/30355817`);
    expect(seen[1]!.body).toEqual({
      ...STORED,
      eventName: "renamed",
      note: null,
      race: false,
      eventCustomization: { ...STORED.eventCustomization, customGoal: { value: 2600, unit: "second", unitType: "time" } },
    });
  });

  it("clears the goal with null and keeps the rest of eventCustomization", async () => {
    await makeGarmin().updateCalendarEvent(1, { goalTimeSeconds: null });
    expect((seen[1]!.body as CalendarEvent).eventCustomization).toEqual({
      ...STORED.eventCustomization,
      customGoal: null,
    });
  });

  it("refuses an empty change set or a blank name before any request", async () => {
    await expect(makeGarmin().updateCalendarEvent(1, {})).rejects.toThrow(GarminError);
    await expect(makeGarmin().updateCalendarEvent(1, { name: "" })).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});
