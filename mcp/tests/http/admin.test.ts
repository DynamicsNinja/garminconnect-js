import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { addOwners, ADMIN_SCRIPT, adminHeaders, adminPage, checkBasicAuth, isDay, monthFiles, readLogs } from "../../src/http/admin.js";
// eslint-disable-next-line no-restricted-imports
import { createHttpApp } from "../../src/http/app.js";
// eslint-disable-next-line no-restricted-imports
import { MemoryGrantStore } from "../../src/http/grants.js";
// eslint-disable-next-line no-restricted-imports
import { Sealer } from "../../src/http/seal.js";
import { testConfig } from "../helpers.js";
import { fakeAuth } from "./fakes.js";

const PASSWORD = "correct horse battery staple";
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

const dirs: string[] = [];
const servers: http.Server[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function logDir(files: Record<string, string[]>): string {
  const dir = mkdtempSync(join(tmpdir(), "mcp-admin-"));
  dirs.push(dir);
  for (const [name, lines] of Object.entries(files)) writeFileSync(join(dir, name), lines.map((l) => `${l}\n`).join(""));
  return dir;
}

const line = (t: string, extra: Record<string, unknown> = {}) => JSON.stringify({ t, ...extra });

describe("admin helpers", () => {
  it("accepts the password under any user name, and nothing else", () => {
    expect(checkBasicAuth(basic("me", PASSWORD), PASSWORD)).toBe(true);
    expect(checkBasicAuth(basic("", PASSWORD), PASSWORD)).toBe(true);
    expect(checkBasicAuth(basic("me", "wrong"), PASSWORD)).toBe(false);
    expect(checkBasicAuth(basic("me", `${PASSWORD}x`), PASSWORD)).toBe(false);
    expect(checkBasicAuth(`Bearer ${PASSWORD}`, PASSWORD)).toBe(false);
    expect(checkBasicAuth(`Basic ${Buffer.from("nocolon").toString("base64")}`, PASSWORD)).toBe(false);
    expect(checkBasicAuth(undefined, PASSWORD)).toBe(false);
  });

  it("validates days and lists the month files a range touches", () => {
    expect(isDay("2026-10-25")).toBe(true);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("2026-10-25T00:00")).toBe(false);
    expect(isDay(["2026-10-25"])).toBe(false);
    expect(monthFiles("2026-11-15", "2027-01-02")).toEqual(["2026-11.jsonl", "2026-12.jsonl", "2027-01.jsonl"]);
    expect(monthFiles("2026-10-01", "2026-10-31")).toEqual(["2026-10.jsonl"]);
  });

  it("reads only the asked days across months, skipping junk, and keeps the newest past the cap", async () => {
    const dir = logDir({
      "2026-10.jsonl": [line("2026-10-30T10:00:00Z", { rpc: "a" }), "not json", "", "42", line("2026-10-31T23:59:59Z", { rpc: "b" })],
      "2026-11.jsonl": [line("2026-11-01T00:00:00Z", { rpc: "c" }), line("2026-11-02T00:00:00Z", { rpc: "d" })],
    });
    const r = await readLogs(dir, "2026-10-31", "2026-11-01");
    expect(r).toEqual({ lines: [{ t: "2026-10-31T23:59:59Z", rpc: "b" }, { t: "2026-11-01T00:00:00Z", rpc: "c" }], truncated: false });
    expect(await readLogs(dir, "2026-09-01", "2026-09-30")).toEqual({ lines: [], truncated: false });
    const capped = await readLogs(dir, "2026-10-01", "2026-11-30", 2);
    expect(capped.truncated).toBe(true);
    expect(capped.lines.map((l) => l["rpc"])).toEqual(["c", "d"]);
  });

  it("adds each line's person and app from the grants on record, keeping a logged person", () => {
    const owners = [{ grantId: "J4OQcl_Fxxxxxxxxxxxxxx", userHash: "personAAAAyyyy", clientName: "Claude" }];
    const lines = [
      { t: "1", grant: "J4OQcl_F", rpc: "tools/list" },
      { t: "2", grant: "J4OQcl_F", user: "loggedXX", rpc: "tools/list" },
      { t: "3", grant: "purged__", rpc: "tools/list" },
      { t: "4", msg: "sign-in" },
    ];
    expect(addOwners(lines, owners)).toEqual([
      { t: "1", grant: "J4OQcl_F", user: "personAA", client: "Claude", rpc: "tools/list" },
      { t: "2", grant: "J4OQcl_F", user: "loggedXX", client: "Claude", rpc: "tools/list" },
      { t: "3", grant: "purged__", rpc: "tools/list" },
      { t: "4", msg: "sign-in" },
    ]);
  });

  it("pins its one script by hash and keeps the page out of search engines", () => {
    const h = adminHeaders();
    const hash = createHash("sha256").update(ADMIN_SCRIPT).digest("base64");
    expect(h["content-security-policy"]).toContain(`script-src 'sha256-${hash}'`);
    expect(h["content-security-policy"]).toContain("connect-src 'self'");
    expect(h["x-robots-tag"]).toBe("noindex, nofollow");
    expect(h["cache-control"]).toBe("no-store");
    expect(adminPage()).toContain(`<script>${ADMIN_SCRIPT}</script>`);
    expect(ADMIN_SCRIPT).not.toContain("innerHTML");
  });
});

describe("admin routes", () => {
  async function start(admin?: { password: string; logDir: string }) {
    const server = http.createServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const logged: Record<string, unknown>[] = [];
    server.on("request", createHttpApp({ publicUrl: new URL(base), sealer: new Sealer([randomBytes(32)]), grants: new MemoryGrantStore(), auth: fakeAuth(), mcp: testConfig(), version: "test", log: (l) => logged.push(l), ...(admin && { admin }) }));
    return { base, logged };
  }

  it("does not exist without a password", async () => {
    const { base } = await start();
    expect((await fetch(`${base}/mcp/admin`)).status).toBe(404);
    expect((await fetch(`${base}/mcp/admin/logs.json?from=2026-10-25&to=2026-10-25`)).status).toBe(404);
  });

  it("asks for the password, logs a wrong one, and serves the page and the lines with the right one", async () => {
    const dir = logDir({ "2026-10.jsonl": [line("2026-10-25T08:18:14Z", { grant: "J4OQcl_F", rpc: "tools/call", tool: "get_user_profile", status: 200, ms: 267 })] });
    const { base, logged } = await start({ password: PASSWORD, logDir: dir });

    const bare = await fetch(`${base}/mcp/admin`);
    expect(bare.status).toBe(401);
    expect(bare.headers.get("www-authenticate")).toMatch(/^Basic realm=/);
    expect(logged).toEqual([]);

    expect((await fetch(`${base}/mcp/admin`, { headers: { authorization: basic("me", "nope") } })).status).toBe(401);
    expect(logged).toEqual([{ msg: "admin auth failed" }]);

    const page = await fetch(`${base}/mcp/admin`, { headers: { authorization: basic("me", PASSWORD) } });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("script-src 'sha256-");
    expect(await page.text()).toContain("Garmin MCP logs");

    expect((await fetch(`${base}/mcp/admin/logs.json?from=2026-10-25&to=2026-10-25`)).status).toBe(401);
    const json = await fetch(`${base}/mcp/admin/logs.json?from=2026-10-25&to=2026-10-25`, { headers: { authorization: basic("me", PASSWORD) } });
    expect(json.headers.get("cache-control")).toBe("no-store");
    expect(await json.json()).toEqual({ lines: [{ t: "2026-10-25T08:18:14Z", grant: "J4OQcl_F", rpc: "tools/call", tool: "get_user_profile", status: 200, ms: 267 }], truncated: false });
  });

  it("refuses a bad range", async () => {
    const { base } = await start({ password: PASSWORD, logDir: logDir({}) });
    const auth = { authorization: basic("me", PASSWORD) };
    for (const q of ["", "?from=2026-10-25", "?from=2026-10-26&to=2026-10-25", "?from=x&to=2026-10-25", "?from=2026-10-25&from=2026-10-26&to=2026-10-26"]) {
      expect((await fetch(`${base}/mcp/admin/logs.json${q}`, { headers: auth })).status).toBe(400);
    }
  });

  it("locks out an IP after ten wrong passwords, while password-less requests stay free", async () => {
    const { base } = await start({ password: PASSWORD, logDir: logDir({}) });
    for (let i = 0; i < 15; i++) expect((await fetch(`${base}/mcp/admin`)).status).toBe(401);
    for (let i = 0; i < 10; i++) expect((await fetch(`${base}/mcp/admin`, { headers: { authorization: basic("me", "nope") } })).status).toBe(401);
    expect((await fetch(`${base}/mcp/admin`, { headers: { authorization: basic("me", PASSWORD) } })).status).toBe(429);
  });
});
