import { describe, expect, it, vi } from "vitest";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { MemoryTokenStore } from "../../src/auth/token-store.js";
import { GarminError, GarminAuthError } from "../../src/errors.js";
import type { Tokens } from "../../src/auth/tokens.js";
import { createReadOnlyFetch } from "../../scripts/readonly-fetch.js";

// Read response structure observed on 2026-11-12. Every value below is synthetic.
const summary = {
  id: 101, connectActivityId: 202, name: "Fixture dive", number: 1,
  excludedFromDLN: false, startTime: "2026-01-01T12:00:00Z", timezone: "UTC",
  diveType: "SINGLE_GAS", bottomTime: 600, maxDepth: 10, diveTags: [],
};
const page = { totalCount: 1, pageSize: 5, pageNumber: 0, diveActivities: [summary] };
const gearSummary = {
  gearId: 301, name: "Fixture computer", type: "DIVE_COMPUTER", status: "fixture",
  creationTs: "2026-01-01T12:00:00Z", serialNumber: "fixture-serial",
  stats: { numAssociatedDives: 1, totalAssociatedDiveTime: 600 },
};
const gear = {
  ...gearSummary, desc: "Fixture equipment", brand: "Fixture brand", model: "Fixture model",
  gearField: { type: "DIVE_COMPUTER", fields: { airIntegrated: true } },
  media: { images: [], videos: [] },
};
const certification = {
  gearId: 302, name: "Fixture certification", type: "CERTIFICATION", brand: "Fixture agency",
  status: "fixture", creationTs: "2026-01-01T12:00:00Z", stats: {},
  gearField: {
    type: "CERTIFICATION",
    fields: {
      diverName: "Fixture diver", diverId: "fixture-diver", certificationDate: "2026-01-01",
      certificationType: "fixture", category: "fixture", certificationAgency: "Fixture agency",
      instructorName: "Fixture instructor", instructorId: "fixture-instructor",
      diveShopName: "Fixture shop", addToAllDives: false,
    },
  },
  media: { images: [], videos: [] },
};
const detail = {
  ...summary,
  profile: { maxDepth: 10, averageDepth: 5, surfaceInterval: 3600, bottomTime: 600 },
  environment: { maxTemperature: 25, minTemperature: 20, avgTemperature: 23, waterType: "fixture", waterDensity: 1000 },
  location: { location: "Fixture location", entryLoc: { latitude: 0, longitude: 0 }, exitLoc: { latitude: 0, longitude: 0 } },
  media: { images: [], videos: [] },
  gears: [{ ...gearSummary, stats: {} }],
};

function tokens(isCn = false): Tokens {
  return {
    oauth1: {
      oauth_token: "one",
      oauth_token_secret: "secret",
      domain: isCn ? "garmin.cn" : "garmin.com",
    },
    oauth2: {
      scope: "CONNECT_READ",
      jti: "test",
      token_type: "Bearer",
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
      expires_at: Date.now() / 1000 + 3600,
      refresh_token_expires_in: 7200,
      refresh_token_expires_at: Date.now() / 1000 + 7200,
    },
  };
}

function setup(isCn = false) {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json(page));
  const client = new GarminClient({ fetchImpl, isCn, retries: 0 });
  client.setTokens(tokens(isCn));
  return { client, dive: new Garmin(client), fetchImpl };
}

describe("Dive reads", () => {
  it.each([false, true])(
    "routes Dive requests to the regional Connect host (China: %s)",
    async (isCn) => {
      const { client, dive, fetchImpl } = setup(isCn);
      const domain = isCn ? "garmin.cn" : "garmin.com";
      await expect(
        dive.getDiveLogs({ requestedPage: 0, resultsPerPage: 5 }),
      ).resolves.toEqual(page);
      expect(fetchImpl.mock.calls[0]?.[0]).toBe(
        `https://connectapi.${domain}/diving/v1/dive/summary?requestedPage=0&resultsPerPage=5`,
      );
      fetchImpl.mockResolvedValueOnce(new Response("17"));
      await expect(dive.getCurrentMaxDiveNumber()).resolves.toBe(17);
      expect(fetchImpl.mock.calls[1]?.[0]).toBe(
        `https://connectapi.${domain}/userprofile-service/userprofile/currentMaxDiveNumber`,
      );
      fetchImpl.mockResolvedValueOnce(new Response("[]"));
      await client.connectapi("/diving/v1/dive/tags", {
        headers: { Authorization: "attacker" },
      });
      expect(
        new Headers(fetchImpl.mock.calls[2]?.[1]?.headers).get("authorization"),
      ).toBe("Bearer access");
    },
  );

  it("uses saved tokens and the explicit Connect-ID bridge", async () => {
    const store = new MemoryTokenStore();
    await store.save(tokens());
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(detail));
    const client = new GarminClient({ tokenStore: store, fetchImpl });
    expect(await client.loadTokens()).toBe(true);
    const garmin = new Garmin(client);
    await expect(garmin.getDiveLogByConnectActivityId(summary.connectActivityId)).resolves.toEqual(detail);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://connectapi.garmin.com/diving/v1/dive/detail/by/connectid/202",
    );
    await expect(garmin.getDiveLog(summary.id)).resolves.toEqual(detail);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://connectapi.garmin.com/diving/v1/dive/detail/101");
  });

  it("requires an explicit valid local date for numeric Dive gear", async () => {
    const { dive, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(Response.json(certification));
    await expect(dive.getDiverCertification(302, "2026-11-11")).resolves.toEqual(certification);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://connectapi.garmin.com/diving/v1/gear/302?current-user-date=2026-11-11",
    );
    fetchImpl.mockResolvedValueOnce(Response.json(gear));
    await expect(dive.getDiveGear(301, "2026-11-11")).resolves.toEqual(gear);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      "https://connectapi.garmin.com/diving/v1/gear/301?current-user-date=2026-11-11",
    );
    fetchImpl.mockResolvedValueOnce(Response.json([gearSummary]));
    await expect(dive.getDiveGearSummaries()).resolves.toEqual([gearSummary]);
    fetchImpl.mockResolvedValueOnce(Response.json([certification]));
    await expect(dive.getDiverCertifications()).resolves.toEqual([certification]);
    expect(() => dive.getDiveGear(12, "2026-02-30")).toThrow(GarminError);
    expect(() => dive.getDiveLog("../other")).toThrow(GarminError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([
    "https://evil.invalid",
    "//evil.invalid/diving/",
    "/diving/../other",
    "/diving/%2e%2e/other",
    "/diving/x?secret=1",
    "/diving/x#fragment",
    "/diving/\\other",
    "diving/v1/dive",
  ])("rejects unsafe Dive ID %s before dispatch", (path) => {
    const { dive, fetchImpl } = setup();
    expect(() => dive.getDiveLog(path)).toThrow(GarminError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("preserves the empty-account envelope with and without paging parameters", async () => {
    const { dive, fetchImpl } = setup();
    fetchImpl.mockImplementation(async () => Response.json({ totalCount: 0 }));
    for (const filters of [undefined, { requestedPage: 0, resultsPerPage: 1 }]) {
      const result = await dive.getDiveLogs(filters);
      expect(result).toEqual({ totalCount: 0 });
      expect(result?.diveActivities?.[0]).toBeUndefined();
      expect(result?.pageSize).toBeUndefined();
      expect(result?.pageNumber).toBeUndefined();
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("preserves empty responses and existing auth/error handling", async () => {
    const { dive, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(dive.getDiveTags()).resolves.toBeNull();
    fetchImpl.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    await expect(dive.getDiverPrivacy()).rejects.toBeInstanceOf(
      GarminAuthError,
    );
    fetchImpl.mockResolvedValueOnce(new Response("<html>challenge</html>"));
    await expect(dive.getDiveLogs()).rejects.toThrow("non-JSON");
  });

  it("runs the public facade through the GET-only probe guard", async () => {
    const inner = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]"));
    const guard = createReadOnlyFetch(inner);
    const client = new GarminClient({ fetchImpl: guard, retries: 0 });
    client.setTokens(tokens());
    await new Garmin(client).getDiverCertifications();
    await expect(
      client.connectapi("/some-write", { method: "POST", json: {} }),
    ).rejects.toThrow();
    expect(guard.audit()).toEqual({ sent: { GET: 1 }, refused: 1 });
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
