import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminError } from "../../src/errors.js";
import type { Tokens } from "../../src/auth/tokens.js";
import type {
  HeartRateZoneEntry,
  HeartRateZoneMethod,
  HeartRateZoneUpdate,
} from "../../src/types/metrics.js";

// setHeartRateZones / deleteHeartRateZones against a stateful fake of
// /biometric-service/heartRateZones that behaves the way the live endpoint did on 2026-10-06:
// PUT takes an array of changed profiles, answers 204, and "DELETED" removes a profile.
const API = "https://connectapi.garmin.com";
const PATH = `${API}/biometric-service/heartRateZones`;
const DEFAULT: HeartRateZoneEntry = {
  trainingMethod: "HR_MAX",
  restingHeartRateUsed: null,
  lactateThresholdHeartRateUsed: null,
  zone1Floor: 92,
  zone2Floor: 110,
  zone3Floor: 129,
  zone4Floor: 147,
  zone5Floor: 166,
  maxHeartRateUsed: 184,
  restingHrAutoUpdateUsed: false,
  sport: "DEFAULT",
  changeState: "UNCHANGED",
};
let stored: HeartRateZoneEntry[] = [];
const puts: HeartRateZoneEntry[][] = [];

const server = setupServer(
  http.get(PATH, () => HttpResponse.json(stored)),
  http.put(PATH, async ({ request }) => {
    const body = (await request.json()) as HeartRateZoneEntry[];
    puts.push(body);
    for (const p of body) {
      stored = stored.filter((s) => s.sport !== p.sport);
      if (p.changeState !== "DELETED") stored.push({ ...p, changeState: "UNCHANGED" });
    }
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
  stored = [{ ...DEFAULT }];
  puts.length = 0;
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("setHeartRateZones", () => {
  it("overlays the change onto DEFAULT, marks it CHANGED, and returns the read-back", async () => {
    const result = await makeGarmin().setHeartRateZones({ zoneFloors: [95, 112, 130, 148, 167] });
    expect(puts[0]).toEqual([
      { ...DEFAULT, zone1Floor: 95, zone2Floor: 112, zone3Floor: 130, zone4Floor: 148, zone5Floor: 167, changeState: "CHANGED" },
    ]);
    expect(result).toMatchObject({ sport: "DEFAULT", zone1Floor: 95, changeState: "UNCHANGED" });
  });

  it("starts a sport with no profile from DEFAULT, upper-casing the sport key", async () => {
    const result = await makeGarmin().setHeartRateZones({
      sport: "running",
      trainingMethod: "HR_RESERVE",
      restingHeartRate: 55,
    });
    expect(puts[0]![0]).toMatchObject({
      sport: "RUNNING",
      trainingMethod: "HR_RESERVE",
      restingHeartRateUsed: 55,
      restingHrAutoUpdateUsed: false,
      zone1Floor: 92,
    });
    expect(result?.sport).toBe("RUNNING");
  });

  it("maps every field onto Garmin's names", async () => {
    await makeGarmin().setHeartRateZones({ maxHeartRate: 190, lactateThresholdHeartRate: 170 });
    expect(puts[0]![0]).toMatchObject({ maxHeartRateUsed: 190, lactateThresholdHeartRateUsed: 170 });
  });

  it.each<[HeartRateZoneUpdate, string]>([
    [{}, "no field"],
    [{ zoneFloors: [95, 94, 130, 148, 167] }, "floors not ascending"],
    [{ zoneFloors: [95, 112, 130, 148] as unknown as HeartRateZoneUpdate["zoneFloors"] }, "four floors"],
    [{ maxHeartRate: 0 }, "zero bpm"],
    [{ restingHeartRate: 55.5 }, "fractional bpm"],
    [{ trainingMethod: "PERCENT" as HeartRateZoneMethod }, "unknown method"],
    [{ sport: "run1", maxHeartRate: 180 }, "invalid sport key"],
  ])("rejects %j (%s) before any request", async (update) => {
    await expect(makeGarmin().setHeartRateZones(update)).rejects.toThrow(GarminError);
    expect(puts).toHaveLength(0);
  });
});

describe("deleteHeartRateZones", () => {
  it("sends the stored profile back with changeState DELETED", async () => {
    stored.push({ ...DEFAULT, sport: "RUNNING" });
    await makeGarmin().deleteHeartRateZones("running");
    expect(puts[0]).toEqual([{ ...DEFAULT, sport: "RUNNING", changeState: "DELETED" }]);
    expect(stored.map((s) => s.sport)).toEqual(["DEFAULT"]);
  });

  it("refuses DEFAULT", async () => {
    await expect(makeGarmin().deleteHeartRateZones("default")).rejects.toThrow(/cannot be deleted/);
    expect(puts).toHaveLength(0);
  });

  it("throws for a sport with no profile instead of doing nothing", async () => {
    await expect(makeGarmin().deleteHeartRateZones("CYCLING")).rejects.toThrow(/no CYCLING/);
    expect(puts).toHaveLength(0);
  });
});
