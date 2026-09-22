import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminError } from "../../src/errors.js";
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

  http.get(`${API}/periodichealth-service/menstrualcycle/dayview/2026-09-20`, ({ request }) => {
    record(request);
    return HttpResponse.json({ calendarDate: "2026-09-20" });
  }),

  http.get(
    `${API}/periodichealth-service/menstrualcycle/calendar/2026-09-01/2026-09-20`,
    ({ request }) => {
      record(request);
      return HttpResponse.json({ days: [] });
    },
  ),

  http.get(`${API}/periodichealth-service/menstrualcycle/lastconfirmed/2026-09-20`, ({ request }) => {
    record(request);
    return HttpResponse.json({ periodStartDate: null });
  }),

  http.get(`${API}/periodichealth-service/menstrualcycle/summary/2026-09-20`, ({ request }) => {
    record(request);
    return HttpResponse.json({ cycleLength: 28 });
  }),

  http.get(`${API}/periodichealth-service/reports/menstrualcycle/6/2026-09-20`, ({ request }) => {
    record(request);
    return HttpResponse.json({ cycles: [] });
  }),
  http.get(`${API}/periodichealth-service/reports/menstrualcycle/1/2026-09-20`, ({ request }) => {
    record(request);
    return HttpResponse.json({ cycles: [] });
  }),

  http.get(`${API}/periodichealth-service/menstrualcycle/pregnancysnapshot`, ({ request }) => {
    record(request);
    return HttpResponse.json({ pregnant: false });
  }),

  http.post(
    `${API}/periodichealth-service/menstrualcycle/dailylog/2026-09-20`,
    async ({ request }) => {
      record(request, await request.clone().json());
      return HttpResponse.json({ ok: true });
    },
  ),

  http.post(`${API}/periodichealth-service/menstrualcycle/calendarupdates`, async ({ request }) => {
    record(request, await request.clone().json());
    return HttpResponse.json({ ok: true });
  }),

  http.post(`${API}/periodichealth-service/menstrualcycle/initCycleSetup`, async ({ request }) => {
    record(request, await request.clone().json());
    return HttpResponse.json({ ok: true });
  }),

  http.post(`${API}/periodichealth-service/menstrualcycle/2026-09-20`, async ({ request }) => {
    record(request, await request.clone().json());
    return HttpResponse.json({ ok: true });
  }),

  http.get(`${API}/userprofile-service/userprofile/user-settings`, ({ request }) => {
    record(request);
    return HttpResponse.json({
      id: 555,
      userMenstrualCycleSettings: { trackPregnancy: false, trackPeriod: true },
    });
  }),
  http.put(`${API}/userprofile-service/userprofile/user-settings`, async ({ request }) => {
    record(request, await request.clone().json());
    return HttpResponse.json({ ok: true });
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
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-22T12:00:00Z"));
});
afterEach(() => {
  server.resetHandlers();
  server.close();
  vi.useRealTimers();
});

describe("getMenstrualDataForDate", () => {
  it("hits dayview/{fordate}", async () => {
    await expect(makeGarmin().getMenstrualDataForDate("2026-09-20")).resolves.toEqual({
      calendarDate: "2026-09-20",
    });
    expect(seen[0]!.url).toBe(`${API}/periodichealth-service/menstrualcycle/dayview/2026-09-20`);
  });

  it("routes fordate through formatDate and throws before any request on an invalid date", async () => {
    await expect(makeGarmin().getMenstrualDataForDate("not-a-date")).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("getMenstrualCalendarData", () => {
  it("hits calendar/{startdate}/{enddate}", async () => {
    await expect(
      makeGarmin().getMenstrualCalendarData("2026-09-01", "2026-09-20"),
    ).resolves.toEqual({ days: [] });
    expect(seen[0]!.url).toBe(
      `${API}/periodichealth-service/menstrualcycle/calendar/2026-09-01/2026-09-20`,
    );
  });
});

describe("getMenstrualLastConfirmed", () => {
  it("hits lastconfirmed/{fordate}", async () => {
    await expect(makeGarmin().getMenstrualLastConfirmed("2026-09-20")).resolves.toEqual({
      periodStartDate: null,
    });
    expect(seen[0]!.url).toBe(
      `${API}/periodichealth-service/menstrualcycle/lastconfirmed/2026-09-20`,
    );
  });
});

describe("getMenstrualCycleSummary", () => {
  it("hits summary/{fordate}", async () => {
    await expect(makeGarmin().getMenstrualCycleSummary("2026-09-20")).resolves.toEqual({
      cycleLength: 28,
    });
    expect(seen[0]!.url).toBe(`${API}/periodichealth-service/menstrualcycle/summary/2026-09-20`);
  });
});

describe("getMenstrualReports", () => {
  it("hits reports/menstrualcycle/{number}/{fordate} with default params", async () => {
    await expect(makeGarmin().getMenstrualReports("2026-09-20")).resolves.toEqual({ cycles: [] });
    expect(seen[0]!.url).toBe(
      `${API}/periodichealth-service/reports/menstrualcycle/6/2026-09-20` +
        `?next=false&reportType=CYCLE&todayCalendarDate=2026-09-22`,
    );
  });

  it("accepts numberOfCycles 1 and 12, and sends explicit options verbatim (trimmed)", async () => {
    await makeGarmin().getMenstrualReports("2026-09-20", 1, {
      nextReport: true,
      reportType: "  DAILY  ",
      todayCalendarDate: "2026-09-21",
    });
    expect(seen[0]!.url).toBe(
      `${API}/periodichealth-service/reports/menstrualcycle/1/2026-09-20` +
        `?next=true&reportType=DAILY&todayCalendarDate=2026-09-21`,
    );
  });

  it("rejects a numberOfCycles outside {1,6,12} before any request", async () => {
    await expect(makeGarmin().getMenstrualReports("2026-09-20", 3)).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("getPregnancySummary", () => {
  it("hits pregnancysnapshot with no args", async () => {
    await expect(makeGarmin().getPregnancySummary()).resolves.toEqual({ pregnant: false });
    expect(seen[0]!.url).toBe(`${API}/periodichealth-service/menstrualcycle/pregnancysnapshot`);
  });
});

// --- writes: unit-tested only, NEVER executed live. See the file-level comment in
// src/services/womensHealth.ts. ---

describe("updateMenstrualDailyLog", () => {
  it("POSTs dailylog/{calendarDate} with the composed body, cleaned and uppercased", async () => {
    await makeGarmin().updateMenstrualDailyLog("2026-09-20", {
      symptoms: ["cramps", "headache"],
      moods: ["happy"],
      flow: "medium",
      sexDrive: "high",
      notes: "felt fine",
      ovulationDay: true,
    });
    expect(seen[0]!.url).toBe(
      `${API}/periodichealth-service/menstrualcycle/dailylog/2026-09-20`,
    );
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toEqual({
      calendarDate: "2026-09-20",
      symptoms: ["CRAMPS", "HEADACHE"],
      moods: ["HAPPY"],
      flow: "MEDIUM",
      sexDrive: "HIGH",
      notes: "felt fine",
      ovulationDay: true,
      reportTimestamp: "2026-09-22T12:00:00.00",
      userProfilePk: 1,
    });
  });

  it("drops undefined fields and empty arrays, but keeps an explicit empty notes string", async () => {
    await makeGarmin().updateMenstrualDailyLog("2026-09-20", {
      symptoms: [],
      notes: "",
    });
    expect(seen[0]!.body).toEqual({
      calendarDate: "2026-09-20",
      notes: "",
      ovulationDay: false,
      reportTimestamp: "2026-09-22T12:00:00.00",
      userProfilePk: 1,
    });
  });

  it("omits notes entirely when not provided (preserves existing note server-side)", async () => {
    await makeGarmin().updateMenstrualDailyLog("2026-09-20", { flow: "light" });
    const body = seen[0]!.body as Record<string, unknown>;
    expect("notes" in body).toBe(false);
    expect(body["flow"]).toBe("LIGHT");
  });

  it("throws before any request when no optional field is provided", async () => {
    await expect(makeGarmin().updateMenstrualDailyLog("2026-09-20")).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });

  it("throws when discharge combines NO_DISCHARGE with another value", async () => {
    await expect(
      makeGarmin().updateMenstrualDailyLog("2026-09-20", {
        discharge: ["no_discharge", "watery"],
      }),
    ).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });

  it("allows NO_DISCHARGE alone", async () => {
    await makeGarmin().updateMenstrualDailyLog("2026-09-20", { discharge: ["no_discharge"] });
    const body = seen[0]!.body as Record<string, unknown>;
    expect(body["discharge"]).toEqual(["NO_DISCHARGE"]);
  });

  it("routes calendarDate through formatDate and throws before any request on an invalid date", async () => {
    await expect(
      makeGarmin().updateMenstrualDailyLog("not-a-date", { flow: "light" }),
    ).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("updateMenstrualCalendar", () => {
  it("POSTs calendarupdates with the composed body", async () => {
    await makeGarmin().updateMenstrualCalendar(
      "2026-09-01",
      "2026-09-20",
      [["2026-09-05", "2026-09-06", "2026-09-07"]],
    );
    expect(seen[0]!.url).toBe(`${API}/periodichealth-service/menstrualcycle/calendarupdates`);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toEqual({
      todayCalendarDate: "2026-09-22",
      startDate: "2026-09-01",
      endDate: "2026-09-20",
      reportTimestamp: "2026-09-22T12:00:00.00",
      cycleDatesLists: [["2026-09-05", "2026-09-06", "2026-09-07"]],
      futureEditsByFE: true,
      userProfilePk: 1,
    });
  });

  it("accepts an explicit todayCalendarDate override", async () => {
    await makeGarmin().updateMenstrualCalendar(
      "2026-09-01",
      "2026-09-20",
      [["2026-09-05"]],
      { todayCalendarDate: "2026-09-10" },
    );
    const body = seen[0]!.body as Record<string, unknown>;
    expect(body["todayCalendarDate"]).toBe("2026-09-10");
  });

  it("throws on an empty group before any request", async () => {
    await expect(
      makeGarmin().updateMenstrualCalendar("2026-09-01", "2026-09-20", [[]]),
    ).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });

  it("throws on non-consecutive dates within a group", async () => {
    await expect(
      makeGarmin().updateMenstrualCalendar(
        "2026-09-01",
        "2026-09-20",
        [["2026-09-05", "2026-09-07"]],
      ),
    ).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });

  it("throws when a date falls outside [startdate, enddate]", async () => {
    await expect(
      makeGarmin().updateMenstrualCalendar(
        "2026-09-01",
        "2026-09-20",
        [["2026-09-25"]],
      ),
    ).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("initMenstrualCycleSetup", () => {
  it("POSTs initCycleSetup with the composed body", async () => {
    await makeGarmin().initMenstrualCycleSetup("2026-09-20", 5, 28);
    expect(seen[0]!.url).toBe(`${API}/periodichealth-service/menstrualcycle/initCycleSetup`);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toEqual({
      periodStartDate: "2026-09-20",
      periodLength: 5,
      cycleLength: 28,
      reportTimestamp: "2026-09-22T12:00:00.00",
      userProfilePk: 1,
    });
  });
});

describe("confirmMenstrualPeriodStart", () => {
  it("POSTs /menstrualcycle/{period_start_date} (not the dayview/calendar/etc. base) with the composed body", async () => {
    await makeGarmin().confirmMenstrualPeriodStart("2026-09-20", 5, 28);
    expect(seen[0]!.url).toBe(`${API}/periodichealth-service/menstrualcycle/2026-09-20`);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toEqual({
      periodStartDate: "2026-09-20",
      periodLength: 5,
      cycleLength: 28,
      predictedCycle: false,
      hasSpecifiedCycleLength: true,
      hasSpecifiedPeriodLength: true,
      reportTimestamp: "2026-09-22T12:00:00.00",
      userProfilePk: 1,
    });
  });

  it("sends predictedCycle: true when given", async () => {
    await makeGarmin().confirmMenstrualPeriodStart("2026-09-20", 5, 28, { predictedCycle: true });
    const body = seen[0]!.body as Record<string, unknown>;
    expect(body["predictedCycle"]).toBe(true);
  });
});

describe("updateMenstrualSettings", () => {
  it("GETs user-settings, merges settings over the current userMenstrualCycleSettings, and PUTs", async () => {
    await makeGarmin().updateMenstrualSettings({ trackPregnancy: true });
    expect(seen).toHaveLength(2);
    expect(seen[0]!.method).toBe("GET");
    expect(seen[0]!.url).toBe(`${API}/userprofile-service/userprofile/user-settings`);
    expect(seen[1]!.method).toBe("PUT");
    expect(seen[1]!.url).toBe(`${API}/userprofile-service/userprofile/user-settings`);
    expect(seen[1]!.body).toEqual({
      userMenstrualCycleSettings: { trackPregnancy: true, trackPeriod: true },
      id: 555,
    });
  });

  it("uses an explicit userSettingsId over the one resolved from the GET", async () => {
    await makeGarmin().updateMenstrualSettings({ trackPregnancy: true }, { userSettingsId: 999 });
    const body = seen[1]!.body as Record<string, unknown>;
    expect(body["id"]).toBe(999);
  });

  it("throws on an empty settings object before any request", async () => {
    await expect(makeGarmin().updateMenstrualSettings({})).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});
