import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileTokenStore } from "garminconnect-js";
import { fileSession, loadConfig, NotLoggedInError } from "../src/session.js";
import { TOKENS } from "./helpers.js";

describe("loadConfig", () => {
  it("defaults under the home directory", () => {
    const c = loadConfig({});
    expect(c.tokenDir).toBe(path.join(os.homedir(), ".garminconnect-mcp", "tokens"));
    expect(c.downloadDir).toBe(path.join(os.homedir(), "Downloads", "garmin"));
    expect(c.groups).toBeNull();
    expect(c.enableGraphql).toBe(false);
  });

  it("reads overrides", () => {
    const c = loadConfig({
      GARMIN_MCP_TOKEN_DIR: "/t",
      GARMIN_MCP_DOWNLOAD_DIR: "/d",
      GARMIN_MCP_GROUPS: " workouts, metrics ,",
      GARMIN_MCP_ENABLE_GRAPHQL: "1",
    });
    expect(c).toEqual({ tokenDir: "/t", downloadDir: "/d", groups: new Set(["workouts", "metrics"]), enableGraphql: true });
  });
});

describe("fileSession", () => {
  it("reports a missing login, and picks up a login made afterwards without a restart", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gc-mcp-"));
    const session = fileSession(dir);
    await expect(session.get()).rejects.toBeInstanceOf(NotLoggedInError);
    await new FileTokenStore(dir).save(TOKENS);
    await expect(session.get()).resolves.toBeDefined();
  });

  it("caches the session until reset", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gc-mcp-"));
    await new FileTokenStore(dir).save(TOKENS);
    const session = fileSession(dir);
    const first = await session.get();
    expect(await session.get()).toBe(first);
    session.reset();
    expect(await session.get()).not.toBe(first);
  });
});
