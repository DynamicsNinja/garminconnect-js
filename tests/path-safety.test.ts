import { describe, expect, it } from "vitest";
import { GarminClient } from "../src/client.js";
import { Garmin } from "../src/garmin.js";
import type { Tokens } from "../src/auth/tokens.js";

const future = Math.floor(Date.now() / 1000) + 3600;

function tokens(): Tokens {
  return {
    oauth1: { oauth_token: "o1tok", oauth_token_secret: "o1sec", domain: "garmin.com" },
    oauth2: {
      scope: "CONNECT_READ",
      jti: "j",
      token_type: "Bearer",
      access_token: "REAL-TOKEN",
      refresh_token: "rt",
      expires_in: 3600,
      expires_at: future,
      refresh_token_expires_in: 7200,
      refresh_token_expires_at: future,
    },
  };
}

/**
 * Records every outgoing request instead of hitting the network. Returns the recorder plus a
 * `Garmin` wired to it, so each test asserts the LITERAL composed URL the transport would send.
 */
function makeRecorder() {
  const seen: { url: string; method: string; headers: Headers }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    seen.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers ?? {}),
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new GarminClient({ fetchImpl });
  client.setTokens(tokens());
  return { seen, client, garmin: new Garmin(client) };
}

/**
 * I1: ids were template-interpolated raw, and `Fetcher.request` hands the result to `new URL()`,
 * which NORMALIZES `..` segments. A user-controlled route param (the default shape of consuming
 * code, per the README's Next.js route handler) could therefore redirect the request — carrying
 * the user's bearer token — to any Garmin endpoint, including writes.
 */
describe("path-segment encoding (I1)", () => {
  it("neutralises a `..` traversal that would otherwise reach another service", async () => {
    const { seen, garmin } = makeRecorder();
    await garmin.deleteWorkout("../../weight-service/weight/2026-01-01/byversion/999");

    expect(seen).toHaveLength(1);
    // The whole hostile value survives as ONE encoded segment under workout-service.
    expect(seen[0]!.url).toBe(
      "https://connectapi.garmin.com/workout-service/workout/" +
        "..%2F..%2Fweight-service%2Fweight%2F2026-01-01%2Fbyversion%2F999",
    );
    expect(new URL(seen[0]!.url).pathname.startsWith("/workout-service/workout/")).toBe(true);
    expect(seen[0]!.url).not.toContain("/weight-service/");
  });

  it("neutralises a `?`/`#` injection into an id", async () => {
    const { seen, garmin } = makeRecorder();
    await garmin.getActivity("1?x=y#frag");

    expect(seen[0]!.url).toBe(
      "https://connectapi.garmin.com/activity-service/activity/1%3Fx%3Dy%23frag",
    );
    const parsed = new URL(seen[0]!.url);
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe("");
  });

  it("neutralises a traversal in an interpolated display name", async () => {
    const { seen, client } = makeRecorder();
    // A display name comes back from Garmin, but it is still interpolated into a path; upstream
    // guards it with `quote(name, safe="")` for the same reason.
    const garmin = new Garmin(client);
    Object.defineProperty(garmin, "displayName", {
      value: async () => "../../../workout-service/workout/1",
    });
    await garmin.getUserSummary("2026-01-01");

    expect(new URL(seen[0]!.url).pathname).toBe(
      "/usersummary-service/usersummary/daily/..%2F..%2F..%2Fworkout-service%2Fworkout%2F1",
    );
  });

  it("leaves a legitimate id, UUID and date byte-for-byte unchanged", async () => {
    const { seen, garmin } = makeRecorder();
    await garmin.getActivity(19216801);
    await garmin.getGearStats("a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6");
    await garmin.getHrvData("2026-01-01");

    expect(seen[0]!.url).toBe("https://connectapi.garmin.com/activity-service/activity/19216801");
    expect(seen[1]!.url).toBe(
      "https://connectapi.garmin.com/gear-service/gear/stats/a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6",
    );
    expect(seen[2]!.url).toBe("https://connectapi.garmin.com/hrv-service/hrv/2026-01-01");
  });
});

/**
 * I2: the headers were built with object spread, which only overwrites on an EXACT key match.
 * `Authorization` and `authorization` are distinct object keys, and `new Headers()` then COMBINES
 * the duplicates with `", "` — so a caller-supplied capital-A token rode along beside the real one.
 */
describe("bearer token cannot be replaced by a caller header (I2)", () => {
  it("drops a capital-A Authorization passed to connectapi", async () => {
    const { seen, client } = makeRecorder();
    await client.connectapi("/activity-service/activity/1", {
      headers: { Authorization: "Bearer CALLER" },
    });

    expect(seen[0]!.headers.get("authorization")).toBe("Bearer REAL-TOKEN");
  });

  it("drops a lower-case authorization passed to connectapi", async () => {
    const { seen, client } = makeRecorder();
    await client.connectapi("/activity-service/activity/1", {
      headers: { authorization: "Bearer CALLER" },
    });

    expect(seen[0]!.headers.get("authorization")).toBe("Bearer REAL-TOKEN");
  });

  it("drops a capital-A Authorization passed to upload", async () => {
    const { seen, client } = makeRecorder();
    await client.upload(new Blob(["x"]), "a.gpx", "/upload-service/upload/gpx", {
      headers: { Authorization: "Bearer CALLER", "User-Agent": "custom-agent" },
    });

    expect(seen[0]!.headers.get("authorization")).toBe("Bearer REAL-TOKEN");
    // `upload` still lets a caller override the User-Agent — `importActivity` depends on it.
    expect(seen[0]!.headers.get("user-agent")).toBe("custom-agent");
  });
});
