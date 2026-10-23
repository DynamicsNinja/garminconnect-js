import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { createHttpApp } from "../../src/http/app.js";
// eslint-disable-next-line no-restricted-imports
import { MemoryGrantStore } from "../../src/http/grants.js";
// eslint-disable-next-line no-restricted-imports
import { Sealer } from "../../src/http/seal.js";
// eslint-disable-next-line no-restricted-imports
import { buildStats, foldClients, MIN_CLIENT_USERS, statsHeaders, statsPage, type Stats } from "../../src/http/stats.js";
import { testConfig } from "../helpers.js";
import { fakeAuth } from "./fakes.js";

const DAY = 20_000 * 86_400; // 2024-10-04

describe("foldClients", () => {
  it("keeps clients with enough people and folds the rest, and nameless ones, into Other", () => {
    expect(MIN_CLIENT_USERS).toBe(3);
    expect(
      foldClients([
        { client: "Claude", users: 10 },
        { client: "Claude Desktop", users: 3 },
        { client: "Cursor", users: 2 },
        { client: null, users: 1 },
        { client: "my-laptop-of-alice", users: 1 },
      ]),
    ).toEqual([
      { name: "Claude", users: 10 },
      { name: "Claude Desktop", users: 3 },
      { name: "Other", users: 4 },
    ]);
    expect(foldClients([{ client: "Claude", users: 5 }])).toEqual([{ name: "Claude", users: 5 }]);
  });
});

describe("buildStats", () => {
  it("combines live counts, folded clients and the trend", () => {
    const store = new MemoryGrantStore();
    for (const u of ["a", "b", "c"]) store.activate(store.create(u, "Claude", DAY).grantId, DAY);
    store.activate(store.create("a", "Cursor", DAY).grantId, DAY);
    store.recordDay(DAY);
    expect(buildStats(store, DAY + 10)).toEqual({
      generatedAt: "2024-10-04T00:00:10.000Z",
      users: 3,
      connections: 4,
      active: { day: 3, week: 3, month: 3 },
      clients: [{ name: "Claude", users: 3 }, { name: "Other", users: 1 }],
      daily: [{ day: "2024-10-04", users: 3, connections: 4, active7d: 3, joined: 3 }],
    });
  });
});

const sample = (daily: Stats["daily"]): Stats => ({
  generatedAt: "2024-10-04T12:00:00.000Z",
  users: 12,
  connections: 15,
  active: { day: 4, week: 9, month: 12 },
  clients: [{ name: "<img src=x>", users: 12 }],
  daily,
});

describe("statsPage", () => {
  it("shows the numbers, escapes client names, and carries no script or em dash", () => {
    const page = statsPage(sample([]));
    expect(page).toContain(">12<");
    expect(page).toContain("&lt;img src=x&gt;");
    expect(page).not.toContain("<img");
    expect(page).not.toContain("<script");
    expect(page.includes("—")).toBe(false);
  });

  it("draws a line once there are two days, and explains a trend that has not started", () => {
    expect(statsPage(sample([]))).not.toContain("<polyline");
    expect(statsPage(sample([{ day: "2024-10-04", users: 3, connections: 3, active7d: 3, joined: 0 }]))).toContain("The trend starts on 2024-10-04");
    const page = statsPage(sample([
      { day: "2024-10-03", users: 2, connections: 2, active7d: 2, joined: 0 },
      { day: "2024-10-04", users: 3, connections: 3, active7d: 3, joined: 0 },
    ]));
    expect(page).toContain("<polyline");
    expect(page).not.toContain("The trend starts");
  });

  it("is served with a script-free, cacheable policy", () => {
    expect(statsHeaders()).toMatchObject({
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "cache-control": "public, max-age=300",
      "x-frame-options": "DENY",
    });
  });
});

describe("stats routes", () => {
  const servers: http.Server[] = [];
  afterEach(() => servers.splice(0).forEach((s) => s.close()));

  async function start(grants: MemoryGrantStore, now: () => number) {
    const server = http.createServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    server.on("request", createHttpApp({ publicUrl: new URL(base), sealer: new Sealer([randomBytes(32)]), grants, auth: fakeAuth(), mcp: testConfig(), version: "test", log: () => {}, now }));
    return base;
  }

  it("serves the page and the JSON publicly, caching the numbers for five minutes", async () => {
    const grants = new MemoryGrantStore();
    let t = DAY;
    const base = await start(grants, () => t);
    grants.activate(grants.create("a", "Claude", DAY).grantId, DAY);

    const page = await fetch(`${base}/mcp/stats`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(await page.text()).toContain("Garmin MCP usage");

    grants.activate(grants.create("b", "Claude", DAY).grantId, DAY);
    const cached = await fetch(`${base}/mcp/stats.json`);
    expect(cached.headers.get("cache-control")).toBe("public, max-age=300");
    expect(((await cached.json()) as Stats).users).toBe(1);

    t = DAY + 300;
    expect(((await (await fetch(`${base}/mcp/stats.json`)).json()) as Stats).users).toBe(2);
  });
});
