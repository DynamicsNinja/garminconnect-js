import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { loadHostedConfig } from "../../src/http/config.js";

const KEY = randomBytes(32).toString("base64");
const env = (extra: Record<string, string> = {}) => ({ PUBLIC_URL: "https://garmin.ficdev.xyz", SEAL_KEYS: KEY, DB_PATH: "/data/grants.db", ...extra });

describe("loadHostedConfig", () => {
  it("reads the required settings and defaults the rest", () => {
    const c = loadHostedConfig(env());
    expect(c.publicUrl.href).toBe("https://garmin.ficdev.xyz/");
    expect(c.keys).toHaveLength(1);
    expect(c).toMatchObject({ dbPath: "/data/grants.db", port: 3000, trustProxy: false });
    expect(c.mcp.enableGraphql).toBe(false);
  });

  it("honours PORT, TRUST_PROXY and the tool settings", () => {
    const c = loadHostedConfig(env({ PORT: "8080", TRUST_PROXY: "1", GARMIN_MCP_ENABLE_GRAPHQL: "true" }));
    expect(c).toMatchObject({ port: 8080, trustProxy: true });
    expect(c.mcp.enableGraphql).toBe(true);
  });

  it("parses CLIENT_IP_HEADER, lower-cased, and defaults it to null", () => {
    expect(loadHostedConfig(env()).clientIpHeader).toBeNull();
    expect(loadHostedConfig(env({ CLIENT_IP_HEADER: "  " })).clientIpHeader).toBeNull();
    expect(loadHostedConfig(env({ CLIENT_IP_HEADER: " CF-Connecting-IP " })).clientIpHeader).toBe("cf-connecting-ip");
    expect(() => loadHostedConfig(env({ CLIENT_IP_HEADER: "cf connecting ip" }))).toThrow(/CLIENT_IP_HEADER/);
  });

  it("allows plain http only for localhost", () => {
    expect(loadHostedConfig(env({ PUBLIC_URL: "http://127.0.0.1:3000" })).publicUrl.port).toBe("3000");
    expect(() => loadHostedConfig(env({ PUBLIC_URL: "http://garmin.ficdev.xyz" }))).toThrow(/https/);
  });

  it("names what is missing", () => {
    expect(() => loadHostedConfig({ SEAL_KEYS: KEY, DB_PATH: "/d" })).toThrow(/PUBLIC_URL/);
    expect(() => loadHostedConfig({ PUBLIC_URL: "https://x.y", DB_PATH: "/d" })).toThrow(/SEAL_KEYS/);
    expect(() => loadHostedConfig({ PUBLIC_URL: "https://x.y", SEAL_KEYS: KEY })).toThrow(/DB_PATH/);
    expect(() => loadHostedConfig(env({ PORT: "abc" }))).toThrow(/PORT/);
  });
});
