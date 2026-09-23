import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminConnectionError, GarminError } from "../../src/errors.js";
import type { Tokens } from "../../src/auth/tokens.js";

const API = "https://connectapi.garmin.com";
const seen: { url: string; method: string; body?: unknown }[] = [];

function record(request: Request) {
  seen.push({ url: request.url, method: request.method });
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

  http.get(
    `${API}/device-service/deviceregistration/devices`,
    ({ request }) => {
      record(request);
      return HttpResponse.json([
        { deviceId: 111, deviceName: "Fenix" },
        { deviceId: 222, deviceName: "Vivoactive" },
      ]);
    },
  ),

  http.get(
    `${API}/device-service/deviceservice/device-info/settings/111`,
    ({ request }) => {
      record(request);
      return HttpResponse.json({ alarms: [{ alarmId: 1 }] });
    },
  ),
  http.get(
    `${API}/device-service/deviceservice/device-info/settings/222`,
    ({ request }) => {
      record(request);
      return HttpResponse.json({ alarms: null });
    },
  ),

  http.get(
    `${API}/web-gateway/device-info/primary-training-device`,
    ({ request }) => {
      record(request);
      return HttpResponse.json({ deviceId: 111 });
    },
  ),

  http.get(
    `${API}/web-gateway/solar/111/2026-09-15/2026-09-15`,
    ({ request }) => {
      record(request);
      return HttpResponse.json({
        deviceSolarInput: [
          { calendarDate: "2026-09-15", solarUtilization: 12 },
        ],
      });
    },
  ),
  http.get(
    `${API}/web-gateway/solar/111/2026-09-10/2026-09-15`,
    ({ request }) => {
      record(request);
      return HttpResponse.json({
        deviceSolarInput: [{ calendarDate: "2026-09-10" }],
      });
    },
  ),
  http.get(
    `${API}/web-gateway/solar/111/2026-09-16/2026-09-16`,
    ({ request }) => {
      record(request);
      return HttpResponse.json({ somethingElse: true });
    },
  ),
  http.get(
    `${API}/web-gateway/solar/111/2026-09-17/2026-09-17`,
    ({ request }) => {
      record(request);
      return new HttpResponse(null, { status: 204 });
    },
  ),

  http.get(`${API}/device-service/deviceservice/mylastused`, ({ request }) => {
    record(request);
    return HttpResponse.json({ userDeviceId: 999 });
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

describe("getDevices", () => {
  it("hits /device-service/deviceregistration/devices and returns an array", async () => {
    const result = await makeGarmin().getDevices();
    expect(seen[0]!.url).toBe(
      `${API}/device-service/deviceregistration/devices`,
    );
    expect(result).toEqual([
      { deviceId: 111, deviceName: "Fenix" },
      { deviceId: 222, deviceName: "Vivoactive" },
    ]);
  });
});

describe("getDeviceSettings", () => {
  it("hits the device-info/settings/{device_id} path with a re-stringified id", async () => {
    const result = await makeGarmin().getDeviceSettings(111);
    expect(seen[0]!.url).toBe(
      `${API}/device-service/deviceservice/device-info/settings/111`,
    );
    expect(result).toEqual({ alarms: [{ alarmId: 1 }] });
  });

  it("coerces a numeric string id and strips it down to the plain integer", async () => {
    await makeGarmin().getDeviceSettings("111");
    expect(seen[0]!.url).toBe(
      `${API}/device-service/deviceservice/device-info/settings/111`,
    );
  });

  it("throws before any request for a non-positive device id", async () => {
    await expect(makeGarmin().getDeviceSettings(0)).rejects.toThrow(
      GarminError,
    );
    await expect(makeGarmin().getDeviceSettings(-5)).rejects.toThrow(
      GarminError,
    );
    expect(seen).toHaveLength(0);
  });

  it("throws before any request for a non-numeric device id", async () => {
    await expect(makeGarmin().getDeviceSettings("abc123")).rejects.toThrow(
      GarminError,
    );
    expect(seen).toHaveLength(0);
  });
});

describe("getPrimaryTrainingDevice", () => {
  it("hits /web-gateway/device-info/primary-training-device", async () => {
    const result = await makeGarmin().getPrimaryTrainingDevice();
    expect(seen[0]!.url).toBe(
      `${API}/web-gateway/device-info/primary-training-device`,
    );
    expect(result).toEqual({ deviceId: 111 });
  });
});

describe("getDeviceSolarData", () => {
  it("defaults enddate to startdate and sends singleDayView=true when enddate is omitted", async () => {
    const result = await makeGarmin().getDeviceSolarData(111, "2026-09-15");
    expect(seen[0]!.url).toBe(
      `${API}/web-gateway/solar/111/2026-09-15/2026-09-15?singleDayView=true`,
    );
    expect(result).toEqual([
      { calendarDate: "2026-09-15", solarUtilization: 12 },
    ]);
  });

  it("sends singleDayView=false when enddate is explicitly supplied", async () => {
    const result = await makeGarmin().getDeviceSolarData(
      111,
      "2026-09-10",
      "2026-09-15",
    );
    expect(seen[0]!.url).toBe(
      `${API}/web-gateway/solar/111/2026-09-10/2026-09-15?singleDayView=false`,
    );
    expect(result).toEqual([{ calendarDate: "2026-09-10" }]);
  });

  it("returns resp.deviceSolarInput, not the whole envelope", async () => {
    const result = await makeGarmin().getDeviceSolarData(111, "2026-09-15");
    expect(result).not.toHaveProperty("deviceSolarInput");
  });

  it("throws GarminConnectionError when deviceSolarInput is missing from the response", async () => {
    await expect(
      makeGarmin().getDeviceSolarData(111, "2026-09-16"),
    ).rejects.toThrow(GarminConnectionError);
    await expect(
      makeGarmin().getDeviceSolarData(111, "2026-09-16"),
    ).rejects.toThrow(/No device solar input data received/);
  });

  it("throws GarminConnectionError on a falsy (204/null) response", async () => {
    await expect(
      makeGarmin().getDeviceSolarData(111, "2026-09-17"),
    ).rejects.toThrow(GarminConnectionError);
  });

  it("routes startdate/enddate through formatDate and throws before any request on an invalid date", async () => {
    await expect(
      makeGarmin().getDeviceSolarData(111, "not-a-date"),
    ).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("getDeviceLastUsed", () => {
  it("hits /device-service/deviceservice/mylastused", async () => {
    const result = await makeGarmin().getDeviceLastUsed();
    expect(seen[0]!.url).toBe(`${API}/device-service/deviceservice/mylastused`);
    expect(result).toEqual({ userDeviceId: 999 });
  });
});

describe("getDeviceSolarData empty-but-present payload", () => {
  it("returns [] for an empty deviceSolarInput rather than raising", async () => {
    // This is the whole reason the implementation tests `"deviceSolarInput" in resp` instead of
    // truthiness: an empty array is a legitimate "no solar data that day", not a missing key.
    server.use(
      http.get(
        `${API}/web-gateway/solar/111/2026-09-18/2026-09-18`,
        ({ request }) => {
          record(request);
          return HttpResponse.json({ deviceSolarInput: [] });
        },
      ),
    );
    await expect(
      makeGarmin().getDeviceSolarData(111, "2026-09-18"),
    ).resolves.toEqual([]);
  });

  it("returns [] for a present-but-null deviceSolarInput (documented deviation from upstream)", async () => {
    server.use(
      http.get(
        `${API}/web-gateway/solar/111/2026-09-19/2026-09-19`,
        ({ request }) => {
          record(request);
          return HttpResponse.json({ deviceSolarInput: null });
        },
      ),
    );
    await expect(
      makeGarmin().getDeviceSolarData(111, "2026-09-19"),
    ).resolves.toEqual([]);
  });
});

describe("getDeviceAlarms", () => {
  it("fans out over every device and concatenates alarms, skipping a device with none", async () => {
    const result = await makeGarmin().getDeviceAlarms();
    expect(seen.map((s) => s.url)).toEqual([
      `${API}/device-service/deviceregistration/devices`,
      `${API}/device-service/deviceservice/device-info/settings/111`,
      `${API}/device-service/deviceservice/device-info/settings/222`,
    ]);
    expect(result).toEqual([{ alarmId: 1 }]);
  });

  it("concatenates alarms from MULTIPLE contributing devices in device order", async () => {
    // The single-contributor test above cannot show merge ORDER, because only one device
    // has alarms. Both devices contribute here, so a reversed or interleaved concatenation
    // fails this and passes that one.
    server.use(
      http.get(
        `${API}/device-service/deviceservice/device-info/settings/222`,
        ({ request }) => {
          record(request);
          return HttpResponse.json({
            alarms: [{ alarmId: 2 }, { alarmId: 3 }],
          });
        },
      ),
    );
    const result = await makeGarmin().getDeviceAlarms();
    expect(result).toEqual([{ alarmId: 1 }, { alarmId: 2 }, { alarmId: 3 }]);
  });

  it("throws GarminError on a device entry missing deviceId, before fetching its settings", async () => {
    server.use(
      http.get(
        `${API}/device-service/deviceregistration/devices`,
        ({ request }) => {
          record(request);
          return HttpResponse.json([{ deviceName: "Nameless" }]);
        },
      ),
    );
    await expect(makeGarmin().getDeviceAlarms()).rejects.toThrow(GarminError);
    // Only the devices call was issued — no settings request went out for the bad entry.
    expect(seen.map((s) => s.url)).toEqual([
      `${API}/device-service/deviceregistration/devices`,
    ]);
  });

  it("returns [] when getDevices resolves null (204), instead of crashing", async () => {
    server.use(
      http.get(
        `${API}/device-service/deviceregistration/devices`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(makeGarmin().getDeviceAlarms()).resolves.toEqual([]);
  });

  it("skips a device whose settings resolve null (204), without throwing", async () => {
    server.use(
      http.get(
        `${API}/device-service/deviceservice/device-info/settings/111`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(makeGarmin().getDeviceAlarms()).resolves.toEqual([]);
  });
});
