import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminError } from "../../src/errors.js";
import type { Tokens } from "../../src/auth/tokens.js";

const API = "https://connectapi.garmin.com";
const seen: { url: string; method: string; secFetchSite: string | null }[] = [];

function record(request: Request) {
  seen.push({
    url: request.url,
    method: request.method,
    secFetchSite: request.headers.get("Sec-Fetch-Site"),
  });
}

function goal(id: number) {
  return { goalId: id };
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

  // status is used only as a valid-value marker to pick a scenario (real endpoint doesn't branch
  // on it this way — this is a test fixture, not a claim about upstream behaviour):
  // "past" -> always empty; "future" -> two pages then empty; "active" -> one item then empty.
  http.get(`${API}/goal-service/goal/goals`, ({ request }) => {
    record(request);
    const url = new URL(request.url);
    const start = Number(url.searchParams.get("start"));
    const status = url.searchParams.get("status");
    if (status === "past") return HttpResponse.json([]);
    if (status === "future") {
      if (start === 0) return HttpResponse.json([goal(1), goal(2)]);
      if (start === 2) return HttpResponse.json([goal(3)]);
      return HttpResponse.json([]);
    }
    if (start === 0) return HttpResponse.json([goal(1)]);
    return HttpResponse.json([]);
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

describe("getGoals", () => {
  it("hits /goal-service/goal/goals with status/start/limit/sortOrder and the Sec-Fetch-Site header", async () => {
    const result = await makeGarmin().getGoals("active", 0, 1);
    expect(seen[0]!.url).toBe(
      `${API}/goal-service/goal/goals?status=active&start=0&limit=1&sortOrder=asc`,
    );
    expect(seen[0]!.method).toBe("GET");
    expect(seen[0]!.secFetchSite).toBe("same-origin");
    expect(result).toEqual([goal(1)]);
  });

  it("defaults to status=active, start=0, limit=30", async () => {
    await makeGarmin().getGoals();
    const url = new URL(seen[0]!.url);
    expect(url.searchParams.get("status")).toBe("active");
    expect(url.searchParams.get("start")).toBe("0");
    expect(url.searchParams.get("limit")).toBe("30");
  });

  it("paginates: fetches successive pages of `limit` size until an empty page, and concatenates", async () => {
    const result = await makeGarmin().getGoals("future", 0, 2);
    expect(result).toEqual([goal(1), goal(2), goal(3)]);
    expect(seen).toHaveLength(3); // start=0 -> 2 items, start=2 -> 1 item, start=4 -> empty
    expect(seen[0]!.url).toContain("start=0");
    expect(seen[1]!.url).toContain("start=2");
    expect(seen[2]!.url).toContain("start=4");
  });

  it("returns [] immediately when the first page is empty", async () => {
    await expect(makeGarmin().getGoals("past")).resolves.toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it("throws before any request for an invalid status", async () => {
    // @ts-expect-error deliberately passing an invalid status to test the runtime guard
    await expect(makeGarmin().getGoals("bogus")).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });
});
