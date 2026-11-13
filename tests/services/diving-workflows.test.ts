import { describe, expect, it, vi } from "vitest";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { MemoryTokenStore } from "../../src/auth/token-store.js";
import type { Tokens } from "../../src/auth/tokens.js";
import { resetConsumerCache } from "../../src/auth/consumer.js";

// Deliberately synthetic records: transport/patch behavior, not proof of server write contracts.
function tokens(expired = false): Tokens {
  const future = Math.floor(Date.now() / 1000) + 7200;
  return {
    oauth1: {
      oauth_token: "one",
      oauth_token_secret: "secret",
      domain: "garmin.com",
    },
    oauth2: {
      // Workflow tests start with a write-capable token; auth exchange has separate tests.
      scope: "CONNECT_READ DIVE_API_WRITE",
      jti: "j",
      token_type: "Bearer",
      access_token: "access",
      refresh_token: "r",
      expires_in: 3600,
      expires_at: expired ? 1 : future,
      refresh_token_expires_in: 7200,
      refresh_token_expires_at: future,
    },
  };
}
function setup(responses: unknown[] = []) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const body of responses)
    fetchImpl.mockResolvedValueOnce(Response.json(body));
  const client = new GarminClient({ fetchImpl, retries: 2, backoffMs: 0 });
  client.setTokens(tokens());
  return { client, dive: new Garmin(client), fetchImpl };
}
function body(
  fetchImpl: ReturnType<typeof setup>["fetchImpl"],
  index: number,
): unknown {
  return JSON.parse(String(fetchImpl.mock.calls[index]?.[1]?.body));
}

describe("Dive workflows", () => {
  it("keeps false flags and does not invent pagination or renumbering defaults", async () => {
    const { dive, fetchImpl } = setup([{}, {}, {}]);
    await dive.getDiveLogs({
      requestedPage: 1,
      resultsPerPage: 2,
      dlnEligible: false,
      filter: { name: "fixture" },
    });
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.searchParams.get("dlnEligible")).toBe("false");
    expect(url.searchParams.get("requestedPage")).toBe("1");
    await dive.createDiveLog(
      {
        name: "fixture",
        startTime: "2026-11-11T12:00:00Z",
        timezone: "UTC",
        diveType: "SCUBA",
        profile: { maxDepth: 2, bottomTime: 60 },
      },
      { renumberSubsequentDives: false },
    );
    expect(
      new URL(String(fetchImpl.mock.calls[1]?.[0])).searchParams.get(
        "renumberSubsequentDives",
      ),
    ).toBe("false");
    await dive.deleteDiveLog(42);
    expect(new URL(String(fetchImpl.mock.calls[2]?.[0])).search).toBe("");
  });

  it("patches nested leaves without replacing media or unrelated recorded values", async () => {
    const { dive, fetchImpl } = setup([
      {
        id: 4,
        name: "old",
        profile: { maxDepth: 20, averageDepth: 10 },
        media: { images: [{ imageUUID: "existing" }] },
      },
      {},
    ]);
    await dive.updateDiveLog(
      4,
      { name: "new", profile: { maxDepth: 22 }, notes: "note" },
      { renumberThisDive: false, renumberSubsequentDives: false },
    );
    expect(body(fetchImpl, 1)).toEqual([
      { op: "replace", path: "/name", value: "new" },
      { op: "replace", path: "/profile/maxDepth", value: 22 },
      { op: "add", path: "/notes", value: "note" },
    ]);
    expect(
      new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("content-type"),
    ).toBe("application/json-patch+json");
    expect(
      new URL(String(fetchImpl.mock.calls[1]?.[0])).searchParams.get(
        "renumberThisDive",
      ),
    ).toBe("false");
  });

  it("wraps certification creation and preserves card images during a text edit", async () => {
    const { dive, fetchImpl } = setup([
      {},
      {
        gearId: 9,
        type: "CERTIFICATION",
        notes: "unchanged",
        gearField: {
          type: "CERTIFICATION",
          fields: { certificationId: "old", images: [{ imageUUID: "card" }] },
        },
      },
      {},
    ]);
    await dive.createDiverCertification(
      {
        name: "card",
        certification: { category: "APNEA", addToAllDives: false },
      },
      "2026-11-11",
    );
    expect(body(fetchImpl, 0)).toEqual({
      name: "card",
      type: "CERTIFICATION",
      gearField: {
        type: "CERTIFICATION",
        fields: { category: "APNEA", addToAllDives: false },
      },
    });
    await dive.updateDiverCertification(
      9,
      { certification: { certificationId: "new" } },
      "2026-11-11",
    );
    expect(body(fetchImpl, 2)).toEqual([
      {
        op: "replace",
        path: "/gearField/fields/certificationId",
        value: "new",
      },
    ]);
  });

  it("keeps gear filters separate from bulk Dive association and card ordering", async () => {
    const { dive, fetchImpl } = setup([[], [], null]);
    await dive.getDiveGearSummaries({
      gearTypes: "MASK",
      gearStatus: "ACTIVE",
      currentUserDate: "2026-11-11",
      filter: { "only-having-problems": "false" },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("gear-types=MASK");
    await dive.bulkCreateDiveGear(
      [
        {
          name: "mask",
          type: "MASK",
          gearField: { type: "MASK", fields: { type: "SINGLE_LENS" } },
        },
      ],
      123,
      "2026-11-11",
    );
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain(
      "associate-diveactivity-id=123",
    );
    await dive.reorderDiverCertifications([8, "6"]);
    expect(body(fetchImpl, 2)).toEqual([8, 6]);
  });

  it.each(["POST", "PATCH", "DELETE"])(
    "uses the existing transport retry policy for Dive %s",
    async (method) => {
      const { dive, fetchImpl } = setup();
      fetchImpl.mockResolvedValue(new Response("transient", { status: 503 }));
      const call = method === "POST"
        ? () => dive.createDiveLog({ name: "fixture", startTime: "2026-11-11T12:00:00Z", timezone: "UTC", diveType: "SINGLE_GAS", profile: { maxDepth: 2 } })
        : method === "DELETE" ? () => dive.deleteDiveLog(42) : () => dive.updateDiveLog(42, { notes: "fixture" });
      if (method === "PATCH") fetchImpl.mockResolvedValueOnce(Response.json({ id: 42 }));
      await expect(call()).rejects.toThrow();
      expect(fetchImpl).toHaveBeenCalledTimes(method === "PATCH" ? 2 : method === "DELETE" ? 3 : 1);
    },
  );

  it("does not change Connect DELETE retry semantics", async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(new Response("transient", { status: 503 }));
    await expect(
      client.connectapi("/thing", { method: "DELETE" }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("uploads multipart separately and preserves an existing log image when attachment fails", async () => {
    const { dive, fetchImpl } = setup([
      { imageUUID: "uploaded" },
      {
        id: 7,
        media: {
          images: [{ imageUUID: "existing" }],
          videos: [{ id: "video" }],
        },
      },
    ]);
    fetchImpl.mockResolvedValueOnce(
      new Response("unavailable", { status: 503 }),
    );
    const uploaded = await dive.uploadDiveImage(
      new Blob(["synthetic"], { type: "image/png" }),
      "fixture.png",
      { category: "DIVE_ACTIVITY" },
    );
    expect(uploaded).toEqual({ imageUUID: "uploaded" });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.body).toBeInstanceOf(FormData);
    const file = (init?.body as FormData).get("file") as Blob;
    expect(await file.text()).toBe("synthetic");
    expect(file.type).toBe("application/octet-stream");
    expect(new Headers(init?.headers).has("content-type")).toBe(false);
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer access",
    );
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "source-platform=DIVE_ANDROID",
    );
    await expect(
      dive.addDiveLogImage(7, { imageUUID: "uploaded" }),
    ).rejects.toThrow();
    expect(body(fetchImpl, 2)).toEqual([
      {
        op: "replace",
        path: "/media/images",
        value: [{ imageUUID: "existing" }, { imageUUID: "uploaded" }],
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("attaches gear and certification images at their distinct nesting paths", async () => {
    const { dive, fetchImpl } = setup([
      { gearId: 1, type: "MASK", media: { images: [] } },
      {},
      {
        gearId: 2,
        type: "CERTIFICATION",
        gearField: {
          type: "CERTIFICATION",
          fields: { images: [{ imageUUID: "old" }] },
        },
      },
      {},
    ]);
    await dive.addDiveGearImage(1, { imageUUID: "new" }, "2026-11-11");
    await dive.addDiverCertificationImage(
      2,
      { imageUUID: "new" },
      "2026-11-11",
    );
    expect(body(fetchImpl, 1)).toEqual([
      { op: "replace", path: "/media/images", value: [{ imageUUID: "new" }] },
    ]);
    expect(body(fetchImpl, 3)).toEqual([
      {
        op: "replace",
        path: "/gearField/fields/images",
        value: [{ imageUUID: "old" }, { imageUUID: "new" }],
      },
    ]);
  });

  it("merges privacy without erasing sibling settings and keeps log privacy separate", async () => {
    const current = {
      profile: {
        showDiveNumber: true,
        showBottomTime: true,
        badgeVisibility: "ONLY_ME",
        visibility: "ONLY_ME",
      },
      activity: {
        advFieldsVisibility: "ONLY_ME",
        locationVisibility: "ONLY_ME",
        visibility: "ONLY_ME",
      },
    };
    const { dive, fetchImpl } = setup([current, null, null]);
    await dive.updateDiverPrivacy({
      profile: { showDiveNumber: false, visibility: undefined },
    });
    expect(body(fetchImpl, 1)).toEqual({
      ...current,
      profile: { ...current.profile, showDiveNumber: false },
    });
    await dive.setDiveLogPrivacy(123, "private");
    expect(fetchImpl.mock.calls[2]?.[0]).toBe(
      "https://connectapi.garmin.com/diving/proxy/connect/activity-service/activity/123",
    );
    expect(body(fetchImpl, 2)).toEqual({ typeKey: "private" });
  });

  it("refuses null clearing and unexpected fields before writing", async () => {
    const { dive, fetchImpl } = setup([{ id: 1 }]);
    await expect(
      dive.updateDiveLog(1, { notes: null } as never),
    ).rejects.toThrow("Null clearing");
    await expect(dive.updateDiveLog(1, { unsupported: true } as never)).rejects.toThrow("Unsupported Dive field");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("shares a single refresh and persisted tokens across concurrent Connect and Dive requests", async () => {
    resetConsumerCache();
    const store = new MemoryTokenStore();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = String(url);
      if (path.includes("oauth_consumer"))
        return Response.json({ consumer_key: "ck", consumer_secret: "cs" });
      if (path.includes("/oauth/exchange/"))
        return Response.json({ ...tokens().oauth2, access_token: "fresh" });
      return Response.json([]);
    });
    const client = new GarminClient({ fetchImpl, tokenStore: store });
    client.setTokens(tokens(true));
    await Promise.all([
      client.connectapi("/thing"),
      new Garmin(client).getDiveTags(),
    ]);
    expect(
      fetchImpl.mock.calls.filter(([url]) =>
        String(url).includes("/oauth/exchange/"),
      ),
    ).toHaveLength(1);
    expect((await store.load())?.oauth2.access_token).toBe("fresh");
    for (const [, init] of fetchImpl.mock.calls.filter(
      ([url]) =>
        String(url).endsWith("/thing") || String(url).endsWith("/tags"),
    )) {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer fresh",
      );
    }
  });
});
