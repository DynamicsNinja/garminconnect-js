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

  it("treats empty and unsubstituted extension settings as unset", () => {
    // Claude Desktop extensions pass settings as env strings; an unset optional setting may arrive
    // as "" or, depending on the client, as the literal template.
    const c = loadConfig({
      GARMIN_MCP_GROUPS: "${user_config.groups}",
      GARMIN_MCP_DOWNLOAD_DIR: "",
      GARMIN_MCP_TOKEN_DIR: "  ",
      GARMIN_MCP_ENABLE_GRAPHQL: "${user_config.enable_graphql}",
    });
    expect(c.groups).toBeNull();
    expect(c.downloadDir).toBe(path.join(os.homedir(), "Downloads", "garmin"));
    expect(c.tokenDir).toBe(path.join(os.homedir(), ".garminconnect-mcp", "tokens"));
    expect(c.enableGraphql).toBe(false);
  });

  it("treats a literal, unexpanded ${HOME} as unset, because mcpb never substitutes it here", () => {
    // mcpb expands `${HOME}`-style OS placeholders BEFORE `${user_config.*}` placeholders. A
    // manifest default of "${HOME}/Downloads/garmin" is never expanded by that substitution pass
    // (there is no `${user_config...}` in it to trigger it), so the server would otherwise receive
    // this literal string as the configured download directory.
    expect(loadConfig({ GARMIN_MCP_DOWNLOAD_DIR: "${HOME}/Downloads/garmin" }).downloadDir).toBe(
      path.join(os.homedir(), "Downloads", "garmin"),
    );
  });

  it("treats a relative download dir as unset", () => {
    expect(loadConfig({ GARMIN_MCP_DOWNLOAD_DIR: "Downloads/garmin" }).downloadDir).toBe(
      path.join(os.homedir(), "Downloads", "garmin"),
    );
  });

  it("keeps an absolute download dir", () => {
    const abs = path.join(os.tmpdir(), "somewhere-else");
    expect(loadConfig({ GARMIN_MCP_DOWNLOAD_DIR: abs }).downloadDir).toBe(abs);
  });

  it("accepts true as well as 1 for GraphQL (extension booleans arrive as text)", () => {
    expect(loadConfig({ GARMIN_MCP_ENABLE_GRAPHQL: "true" }).enableGraphql).toBe(true);
    expect(loadConfig({ GARMIN_MCP_ENABLE_GRAPHQL: "TRUE" }).enableGraphql).toBe(true);
    expect(loadConfig({ GARMIN_MCP_ENABLE_GRAPHQL: "false" }).enableGraphql).toBe(false);
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
