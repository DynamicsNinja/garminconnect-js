import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminConnectionError, GarminError } from "../../src/errors.js";
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

  http.get(`${API}/gear-service/gear/filterGear`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ gearPk: 1, displayName: "Trail Shoes" }]);
  }),

  http.post(`${API}/gear-service/gear/v2`, async ({ request }) => {
    record(request, await request.clone().json());
    return HttpResponse.json({ uuid: "new-uuid", gearPk: 42 });
  }),

  http.get(`${API}/gear-service/gear/stats/aabbccdd`, ({ request }) => {
    record(request);
    return HttpResponse.json({ totalDistance: 1000 });
  }),
  http.get(`${API}/gear-service/gear/stats/deadbeef`, ({ request }) => {
    record(request);
    return new HttpResponse("not found", { status: 404 });
  }),
  http.get(`${API}/gear-service/gear/stats/500err`, ({ request }) => {
    record(request);
    return new HttpResponse("boom", { status: 500 });
  }),

  http.get(`${API}/gear-service/gear/user/1/activityTypes`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ activityTypeKey: "running" }]);
  }),

  http.put(`${API}/gear-service/gear/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6/activityType/RUNNING/default/true`, ({ request }) => {
    record(request);
    return HttpResponse.json({ ok: true });
  }),
  http.delete(`${API}/gear-service/gear/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6/activityType/RUNNING`, ({ request }) => {
    record(request);
    return new HttpResponse(null, { status: 204 });
  }),
  http.put(`${API}/gear-service/gear/deadbeefdeadbeefdeadbeefdeadbeef/activityType/RUNNING/default/true`, () => {
    return new HttpResponse("not found", { status: 404 });
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

describe("getGear", () => {
  it("hits filterGear with userProfilePk and returns an array of gear entries", async () => {
    const result = await makeGarmin().getGear(1);
    expect(seen[0]!.url).toBe(`${API}/gear-service/gear/filterGear?userProfilePk=1`);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([{ gearPk: 1, displayName: "Trail Shoes" }]);
  });
});

describe("createGear", () => {
  it("POSTs to /gear-service/gear/v2 with the full body shape and uppercased type keys", async () => {
    await makeGarmin().createGear(
      "shoes",
      "Acme",
      "Trailblazer",
      "My trail shoes",
      "2026-01-15",
      "distance",
    );
    expect(seen[0]!.url).toBe(`${API}/gear-service/gear/v2`);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toEqual({
      uuid: null,
      gearType: "SHOES",
      brand: "Acme",
      model: "Trailblazer",
      name: "My trail shoes",
      firstUseDate: "2026-01-15",
      maxUsageDate: null,
      usageType: "DISTANCE",
      notes: "",
      associatedActivityTypes: [],
    });
  });

  it("converts maxUsageDistanceKm to metres and maxUsageDurationMin to seconds (round, floor 1)", async () => {
    await makeGarmin().createGear(
      "shoes",
      "Acme",
      "Trailblazer",
      "My trail shoes",
      "2026-01-15",
      "DISTANCE",
      5, // km -> 5000 m
      30, // min -> 1800 s
      "some notes",
      ["running", "trail_running"],
    );
    const body = seen[0]!.body as Record<string, unknown>;
    expect(body["maxUsageDistanceMeters"]).toBe(5000);
    expect(body["maxUsageDurationSeconds"]).toBe(1800);
    expect(body["notes"]).toBe("some notes");
    expect(body["associatedActivityTypes"]).toEqual([
      { activityTypeKey: "running", defaultGear: true, preferredGear: false },
      { activityTypeKey: "trail_running", defaultGear: true, preferredGear: false },
    ]);
  });

  it("rounds a fractional km/min conversion", async () => {
    await makeGarmin().createGear(
      "shoes",
      "Acme",
      "Trailblazer",
      "My trail shoes",
      "2026-01-15",
      "DISTANCE",
      0.0006, // -> round(0.6) = 1m, exactly at the floor
      0.02, // -> round(1.2) = 1s
    );
    const body = seen[0]!.body as Record<string, unknown>;
    expect(body["maxUsageDistanceMeters"]).toBe(1);
    expect(body["maxUsageDurationSeconds"]).toBe(1);
  });

  it("throws (does not send 0) when the converted distance floors below 1 meter", async () => {
    await expect(
      makeGarmin().createGear(
        "shoes",
        "Acme",
        "Trailblazer",
        "My trail shoes",
        "2026-01-15",
        "DISTANCE",
        0.0001, // round(0.1) = 0m
      ),
    ).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });

  it("throws when the converted duration floors below 1 second", async () => {
    await expect(
      makeGarmin().createGear(
        "shoes",
        "Acme",
        "Trailblazer",
        "My trail shoes",
        "2026-01-15",
        "DISTANCE",
        undefined,
        0.001, // round(0.06) = 0s
      ),
    ).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });

  it("routes firstUseDate through formatDate and throws before any request on an invalid date", async () => {
    await expect(
      makeGarmin().createGear("shoes", "Acme", "Trailblazer", "My trail shoes", "not-a-date"),
    ).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("setGearActivityDefaults", () => {
  const UUID = "a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6";

  it("read-modify-writes the v2 record, replacing associatedActivityTypes with lowercase keys", async () => {
    let putBody: unknown;
    server.use(
      http.get(`${API}/gear-service/gear/v2/${UUID}`, ({ request }) => {
        record(request);
        return HttpResponse.json({
          uuid: UUID,
          name: "existing",
          gearType: "SHOES",
          associatedActivityTypes: [{ activityTypeKey: "hiking", defaultGear: true, preferredGear: false }],
        });
      }),
      http.put(`${API}/gear-service/gear/v2/${UUID}`, async ({ request }) => {
        putBody = await request.clone().json();
        record(request);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await makeGarmin().setGearActivityDefaults(UUID, ["running", "cycling"]);

    expect(seen.map((x) => `${x.method} ${x.url}`)).toEqual([
      `GET ${API}/gear-service/gear/v2/${UUID}`,
      `PUT ${API}/gear-service/gear/v2/${UUID}`,
    ]);
    // Unrelated fields must survive the round trip — this is a full-record PUT.
    expect(putBody).toEqual({
      uuid: UUID,
      name: "existing",
      gearType: "SHOES",
      associatedActivityTypes: [
        { activityTypeKey: "running", defaultGear: true, preferredGear: false },
        { activityTypeKey: "cycling", defaultGear: true, preferredGear: false },
      ],
    });
  });

  it("clears all defaults when given an empty array", async () => {
    let putBody: { associatedActivityTypes?: unknown[] } | undefined;
    server.use(
      http.get(`${API}/gear-service/gear/v2/${UUID}`, () =>
        HttpResponse.json({ uuid: UUID, associatedActivityTypes: [{ activityTypeKey: "running" }] }),
      ),
      http.put(`${API}/gear-service/gear/v2/${UUID}`, async ({ request }) => {
        putBody = (await request.clone().json()) as { associatedActivityTypes?: unknown[] };
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await makeGarmin().setGearActivityDefaults(UUID, []);
    expect(putBody?.associatedActivityTypes).toEqual([]);
  });

  it("throws without issuing a PUT when the gear does not exist", async () => {
    server.use(
      http.get(`${API}/gear-service/gear/v2/${UUID}`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(makeGarmin().setGearActivityDefaults(UUID, ["running"])).rejects.toThrow(GarminError);
    expect(seen.filter((x) => x.method === "PUT")).toHaveLength(0);
  });
});

describe("deleteGear", () => {
  it("DELETEs gear/v2/{uuid} and re-hyphenates a bare 32-char uuid", async () => {
    // The live trap: getGear returns uuids WITHOUT hyphens, and the endpoint 404s on that form.
    // Passing the bare form must still produce the hyphenated URL.
    server.use(
      http.delete(
        `${API}/gear-service/gear/v2/a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6`,
        ({ request }) => {
          record(request);
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    const result = await makeGarmin().deleteGear("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
    expect(seen[0]!.method).toBe("DELETE");
    expect(seen[0]!.url).toBe(`${API}/gear-service/gear/v2/a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6`);
    expect(result).toBeNull();
  });

  it("passes an already-hyphenated uuid through unchanged", async () => {
    server.use(
      http.delete(
        `${API}/gear-service/gear/v2/a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6`,
        ({ request }) => {
          record(request);
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    await makeGarmin().deleteGear("a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6");
    expect(seen[0]!.url).toBe(`${API}/gear-service/gear/v2/a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6`);
  });

  it("rejects a non-hex uuid before issuing a request", async () => {
    await expect(makeGarmin().deleteGear("not-a-uuid!!")).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("getGearStats", () => {
  it("hits /gear-service/gear/stats/{gearUUID}", async () => {
    await expect(makeGarmin().getGearStats("aabbccdd")).resolves.toEqual({ totalDistance: 1000 });
    expect(seen[0]!.url).toBe(`${API}/gear-service/gear/stats/aabbccdd`);
  });

  it("returns {} on a 404 instead of throwing", async () => {
    await expect(makeGarmin().getGearStats("deadbeef")).resolves.toEqual({});
  });

  it("re-raises a non-404 error", async () => {
    await expect(makeGarmin().getGearStats("500err")).rejects.toThrow();
  });

  it("rejects a non-hex gearUUID before making a request", async () => {
    await expect(makeGarmin().getGearStats("not-hex-zzzz")).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});

describe("getGearDefaults", () => {
  it("hits /gear-service/gear/user/{userProfileNumber}/activityTypes and returns an array", async () => {
    const result = await makeGarmin().getGearDefaults(1);
    expect(seen[0]!.url).toBe(`${API}/gear-service/gear/user/1/activityTypes`);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([{ activityTypeKey: "running" }]);
  });
});

describe("setGearDefault", () => {
  it("PUTs .../default/true when defaultGear is true (default)", async () => {
    await expect(makeGarmin().setGearDefault("running", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6")).resolves.toEqual({
      ok: true,
    });
    expect(seen[0]!.url).toBe(
      `${API}/gear-service/gear/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6/activityType/RUNNING/default/true`,
    );
    expect(seen[0]!.method).toBe("PUT");
  });

  it("DELETEs the plain activityType path when defaultGear is false", async () => {
    await makeGarmin().setGearDefault("running", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", false);
    expect(seen[0]!.url).toBe(`${API}/gear-service/gear/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6/activityType/RUNNING`);
    expect(seen[0]!.method).toBe("DELETE");
  });

  it("uppercases activityType", async () => {
    await makeGarmin().setGearDefault("running", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
    expect(seen[0]!.url).toContain("/activityType/RUNNING/");
  });

  it("re-raises a 404 as GarminConnectionError with a not-found message", async () => {
    await expect(
      makeGarmin().setGearDefault("running", "deadbeefdeadbeefdeadbeefdeadbeef"),
    ).rejects.toThrow(GarminConnectionError);
    await expect(
      makeGarmin().setGearDefault("running", "deadbeefdeadbeefdeadbeefdeadbeef"),
    ).rejects.toThrow(/Cannot set gear default for UUID deadbeefdeadbeefdeadbeefdeadbeef: gear not found/);
  });
});
