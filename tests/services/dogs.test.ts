import { describe, expect, it, vi } from "vitest";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminError } from "../../src/errors.js";
import type { Tokens } from "../../src/auth/tokens.js";

// Response shapes observed on 2026-11-24 (Settings > Dogs, the activity edit in the mobile app).
// Every value below is synthetic.
const dog = {
  id: 501, adminId: 9, name: "Fixture Dog", nickname: null, species: "dog",
  primaryBreed: { id: 8, name: "AIREDALE TERRIER", species: "dog" }, secondaryBreeds: [],
  gender: "female", isNeutered: true, weight: 21500, birthdate: "2022-03-01",
  birthdatePrecision: "month", adoptionDate: null, adoptionDatePrecision: null,
  status: "active", deviceId: null,
};

function tokens(): Tokens {
  return {
    oauth1: { oauth_token: "one", oauth_token_secret: "secret", domain: "garmin.com" },
    oauth2: {
      scope: "CONNECT_READ", jti: "test", token_type: "Bearer", access_token: "access",
      refresh_token: "refresh", expires_in: 3600, expires_at: Date.now() / 1000 + 3600,
      refresh_token_expires_in: 7200, refresh_token_expires_at: Date.now() / 1000 + 7200,
    },
  };
}

function setup(body: unknown = dog) {
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(body));
  const client = new GarminClient({ fetchImpl, retries: 0 });
  client.setTokens(tokens());
  return { client, garmin: new Garmin(client), fetchImpl };
}

const call = (f: ReturnType<typeof setup>["fetchImpl"], i: number) => {
  const [url, init] = f.mock.calls[i] ?? [];
  return {
    url: String(url),
    method: init?.method ?? "GET",
    body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    auth: new Headers(init?.headers).get("authorization"),
  };
};

describe("dog profiles (gcx.garmin.com)", () => {
  it("reads profiles from the gcx host with the bearer token", async () => {
    const { garmin, fetchImpl } = setup([dog]);
    await expect(garmin.getDogs()).resolves.toEqual([dog]);
    await garmin.getDogs("retired");
    fetchImpl.mockResolvedValueOnce(Response.json(dog));
    await expect(garmin.getDog(501)).resolves.toEqual(dog);
    expect(call(fetchImpl, 0)).toMatchObject({
      url: "https://gcx.garmin.com/family-api/profile-service/profile/pets", auth: "Bearer access",
    });
    expect(call(fetchImpl, 1).url).toBe("https://gcx.garmin.com/family-api/profile-service/profile/pets?status=retired");
    expect(call(fetchImpl, 2).url).toBe("https://gcx.garmin.com/family-api/profile-service/profile/pets/501");
  });

  it("returns [] when Garmin answers null, and refuses an unknown status", async () => {
    const { garmin, fetchImpl } = setup(null);
    await expect(garmin.getDogs()).resolves.toEqual([]);
    await expect(garmin.getDogs("lost" as "active")).rejects.toThrow(GarminError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("turns the breed map into a sorted list", async () => {
    const { garmin } = setup({ "8": "DOG_BREED_AIREDALE_TERRIER", "1": "DOG_BREED_OTHER" });
    await expect(garmin.getDogBreeds()).resolves.toEqual([
      { id: 1, key: "DOG_BREED_OTHER" }, { id: 8, key: "DOG_BREED_AIREDALE_TERRIER" },
    ]);
  });

  it("creates a dog: kg to grams, YYYY-MM to month precision", async () => {
    const { garmin, fetchImpl } = setup();
    await garmin.createDog({
      name: "Fixture Dog", primaryBreedId: 8, secondaryBreedIds: [2], gender: "female",
      isNeutered: true, weightKg: 21.5, birthdate: "2022-03", adoptionDate: "2023-01-15",
    });
    expect(call(fetchImpl, 0)).toEqual({
      url: "https://gcx.garmin.com/family-api/profile-service/profile/pets",
      method: "POST",
      auth: "Bearer access",
      body: {
        name: "Fixture Dog", primaryBreedId: 8, secondaryBreedIds: [2], gender: "female",
        isNeutered: true, weight: 21500, birthdate: "2022-03-01", birthdatePrecision: "month",
        adoptionDate: "2023-01-15", adoptionDatePrecision: "day",
      },
    });
  });

  it("refuses what Garmin would store wrong or reject", async () => {
    const { garmin, fetchImpl } = setup();
    const bad: unknown[] = [
      { name: " " },
      { name: "x", gender: "other" },
      { name: "x", weightKg: -5 },
      { name: "x", weight: 20000 },
      { name: "x", birthdate: "2022" },
      { name: "x", birthdate: "2022-02-30" },
      { name: "x", secondaryBreedIds: [0] },
    ];
    for (const input of bad) {
      await expect(garmin.createDog(input as never)).rejects.toThrow(GarminError);
    }
    await expect(garmin.createDog({ name: "x", weight: 1 } as never)).rejects.toThrow(/weightKg/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("updates only the given fields, and null clears", async () => {
    const { garmin, fetchImpl } = setup();
    await garmin.updateDog("501", { weightKg: null, primaryBreedId: null, birthdate: null });
    expect(call(fetchImpl, 0)).toMatchObject({
      url: "https://gcx.garmin.com/family-api/profile-service/profile/pets/501",
      method: "PUT",
      body: { weight: null, primaryBreedId: null, birthdate: null, birthdatePrecision: null },
    });
    await expect(garmin.updateDog(501, {})).rejects.toThrow(GarminError);
    await expect(garmin.updateDog(501, { name: "" })).rejects.toThrow(GarminError);
  });

  it("retires, unretires and deletes", async () => {
    const { garmin, fetchImpl } = setup();
    fetchImpl.mockImplementation(async () => new Response(null, { status: 204 }));
    await garmin.setDogRetired(501, true);
    await garmin.setDogRetired(501, false);
    await expect(garmin.deleteDog(501)).resolves.toBeNull();
    expect(call(fetchImpl, 0)).toMatchObject({
      url: "https://gcx.garmin.com/family-api/profile-service/profile/pets/501/status",
      method: "PUT", body: { status: "retired" },
    });
    expect(call(fetchImpl, 1).body).toEqual({ status: "active" });
    expect(call(fetchImpl, 2)).toMatchObject({ method: "DELETE" });
  });

  it("refuses an id that is not a positive integer before any request", async () => {
    const { garmin, fetchImpl } = setup();
    for (const id of ["../activity-service/activity/1", "1?x=y", 0, -1, 1.5, "abc"]) {
      await expect(garmin.getDog(id)).rejects.toThrow(GarminError);
      await expect(garmin.deleteDog(id)).rejects.toThrow(GarminError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("dog stats (connectapi)", () => {
  it("defaults the lifetime metrics to distance and duration", async () => {
    const { garmin, fetchImpl } = setup({});
    await garmin.getDogLifetimeStats();
    await garmin.getDogLifetimeStats(["duration"]);
    expect(call(fetchImpl, 0).url).toBe(
      "https://connectapi.garmin.com/fitnessstats-service/activity-animal/dog/stats/lifetime?metric=distance&metric=duration",
    );
    expect(call(fetchImpl, 1).url).toMatch(/\?metric=duration$/);
    await expect(garmin.getDogLifetimeStats([])).rejects.toThrow(GarminError);
    await expect(garmin.getDogLifetimeStats(["speed" as "distance"])).rejects.toThrow(GarminError);
  });

  it("POSTs dog ids for per-dog stats, with both dates or neither", async () => {
    const { garmin, fetchImpl } = setup([]);
    await garmin.getDogStats([501, 501]);
    await garmin.getDogStats([501], "2026-11-18", new Date("2026-11-24T12:00:00Z"));
    expect(call(fetchImpl, 0)).toMatchObject({
      url: "https://connectapi.garmin.com/fitnessstats-service/activity-animal/dog/stats/bulk",
      method: "POST", body: [501],
    });
    expect(call(fetchImpl, 1).url).toMatch(/bulk\?startDate=2026-11-18&endDate=2026-11-24$/);
    await expect(garmin.getDogStats([501], "2026-11-18")).rejects.toThrow(/both/);
    await expect(garmin.getDogStats([501], "2026-11-24", "2026-11-18")).rejects.toThrow(GarminError);
    await expect(garmin.getDogStats([])).rejects.toThrow(GarminError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("setActivityDogs", () => {
  it("checks ids against the active dogs, then sends hasDog with the ids", async () => {
    const { garmin, fetchImpl } = setup([dog]);
    fetchImpl.mockResolvedValueOnce(Response.json([dog]));
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await garmin.setActivityDogs(42, [501]);
    expect(call(fetchImpl, 0).url).toBe("https://gcx.garmin.com/family-api/profile-service/profile/pets?status=active");
    expect(call(fetchImpl, 1)).toMatchObject({
      url: "https://connectapi.garmin.com/activity-service/activity/42",
      method: "PUT",
      body: { activityId: 42, metadataDTO: { hasDog: true, dogProfileIds: [501] } },
    });
  });

  it("refuses an id that is not an active dog of the account", async () => {
    const { garmin, fetchImpl } = setup([dog]);
    await expect(garmin.setActivityDogs(42, [1])).rejects.toThrow(/not an active dog/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("removes every dog with [] and needs no lookup", async () => {
    const { garmin, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await garmin.setActivityDogs("42", []);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(call(fetchImpl, 0).body).toEqual({ activityId: "42", metadataDTO: { hasDog: false } });
    await expect(garmin.setActivityDogs(42, [0])).rejects.toThrow(GarminError);
  });
});

describe("dog search filters", () => {
  it("sends hasDog only when true, and dogProfileId", async () => {
    const { garmin, fetchImpl } = setup([]);
    await garmin.searchActivities({ hasDog: true, dogProfileId: 501 });
    await garmin.searchActivities({ hasDog: false });
    expect(call(fetchImpl, 0).url).toMatch(/hasDog=true&dogProfileId=501$/);
    expect(call(fetchImpl, 1).url).not.toMatch(/hasDog/);
  });
});

describe("client host option", () => {
  it("refuses a host other than connectapi or gcx", async () => {
    const { client, fetchImpl } = setup();
    await expect(client.connectapi("/x", { host: "evil.example/#" as "gcx" })).rejects.toThrow(GarminError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
