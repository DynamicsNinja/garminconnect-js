import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileTokenStore, GarminAuthError, type GarminClient, type LoginResult, type MfaState } from "garminconnect-js";
import { describeError } from "../src/errors.js";
import { fileSession, loadConfig, NotLoggedInError, type Credentials } from "../src/session.js";
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
    expect(c).toEqual({
      tokenDir: "/t",
      downloadDir: "/d",
      groups: new Set(["workouts", "metrics"]),
      enableGraphql: true,
      credentials: null,
    });
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

describe("loadConfig credentials", () => {
  it("reads the Garmin email and password when both are set", () => {
    expect(loadConfig({ GARMIN_EMAIL: " me@example.com ", GARMIN_PASSWORD: "pw" }).credentials).toEqual({
      email: "me@example.com",
      password: "pw",
    });
  });

  it("keeps the password exactly as typed, including surrounding spaces", () => {
    expect(loadConfig({ GARMIN_EMAIL: "me@example.com", GARMIN_PASSWORD: " p w " }).credentials?.password).toBe(" p w ");
  });

  it("needs both: one alone is no credentials", () => {
    expect(loadConfig({ GARMIN_EMAIL: "me@example.com" }).credentials).toBeNull();
    expect(loadConfig({ GARMIN_PASSWORD: "pw" }).credentials).toBeNull();
    expect(loadConfig({ GARMIN_EMAIL: "me@example.com", GARMIN_PASSWORD: "" }).credentials).toBeNull();
  });

  it("treats unsubstituted extension templates as unset", () => {
    const c = loadConfig({ GARMIN_EMAIL: "${user_config.garmin_email}", GARMIN_PASSWORD: "${user_config.garmin_password}" });
    expect(c.credentials).toBeNull();
  });
});

const CREDS: Credentials = { email: "me@example.com", password: "secret-pw" };

/** A stand-in for `GarminClient#login` that saves tokens like the real one, and records its calls. */
function fakeLogin(outcome: "success" | "mfa" | Error = "success") {
  const calls: Credentials[] = [];
  const login = async (client: GarminClient, credentials: Credentials): Promise<LoginResult> => {
    calls.push(credentials);
    if (outcome instanceof Error) throw outcome;
    if (outcome === "mfa") return { state: "mfa_required", mfaState: {} as MfaState };
    await client.tokenStore.save(TOKENS);
    client.setTokens(TOKENS);
    return { state: "success", oauth1: TOKENS.oauth1, oauth2: TOKENS.oauth2 };
  };
  return { login, calls };
}

const tempDir = () => mkdtempSync(path.join(os.tmpdir(), "gc-mcp-"));

describe("fileSession with configured credentials", () => {
  it("does not sign in when saved tokens exist", async () => {
    const dir = tempDir();
    await new FileTokenStore(dir).save(TOKENS);
    const { login, calls } = fakeLogin();
    await fileSession(dir, { credentials: CREDS, login }).get();
    expect(calls).toHaveLength(0);
  });

  it("signs in once when there are no saved tokens, and saves them for the next start", async () => {
    const dir = tempDir();
    const { login, calls } = fakeLogin();
    const session = fileSession(dir, { credentials: CREDS, login });
    await expect(session.get()).resolves.toBeDefined();
    expect(calls).toEqual([CREDS]);
    expect(await new FileTokenStore(dir).load()).not.toBeNull();
    session.reset();
    await session.get();
    expect(calls).toHaveLength(1);
  });

  it("shares one sign-in between concurrent first calls", async () => {
    const { login, calls } = fakeLogin();
    const session = fileSession(tempDir(), { credentials: CREDS, login });
    await Promise.all([session.get(), session.get(), session.get()]);
    expect(calls).toHaveLength(1);
  });

  it("tries a failed sign-in only once per run, and says why without the password", async () => {
    const { login, calls } = fakeLogin(new GarminAuthError("SSO error: INVALID_CREDENTIALS"));
    const session = fileSession(tempDir(), { credentials: CREDS, login });
    const first = await session.get().catch((e: unknown) => e);
    const second = await session.get().catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    for (const error of [first, second]) {
      expect(error).toBeInstanceOf(NotLoggedInError);
      const text = describeError(error);
      expect(text).toContain("INVALID_CREDENTIALS");
      expect(text).toContain("sign_in_to_garmin");
      expect(text).not.toContain(CREDS.password);
    }
  });

  it("explains that two-step verification cannot finish from the settings", async () => {
    const { login } = fakeLogin("mfa");
    const error = await fileSession(tempDir(), { credentials: CREDS, login })
      .get()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotLoggedInError);
    expect(describeError(error)).toMatch(/two-step verification/);
    expect(describeError(error)).toContain("sign_in_to_garmin");
  });

  it("picks up a sign-in made by other means after the automatic one failed", async () => {
    const dir = tempDir();
    const { login } = fakeLogin(new GarminAuthError("SSO error: INVALID_CREDENTIALS"));
    const session = fileSession(dir, { credentials: CREDS, login });
    await expect(session.get()).rejects.toBeInstanceOf(NotLoggedInError);
    await new FileTokenStore(dir).save(TOKENS); // e.g. sign_in_to_garmin
    session.reset();
    await expect(session.get()).resolves.toBeDefined();
  });

  it("signs in again when Garmin rejected the saved session", async () => {
    const dir = tempDir();
    await new FileTokenStore(dir).save(TOKENS);
    const { login, calls } = fakeLogin();
    const session = fileSession(dir, { credentials: CREDS, login });
    await session.get();
    expect(calls).toHaveLength(0);
    session.reset({ rejected: true });
    await session.get();
    expect(calls).toHaveLength(1);
  });

  it("does not sign in on an ordinary reset (e.g. after sign_in_to_garmin)", async () => {
    const dir = tempDir();
    await new FileTokenStore(dir).save(TOKENS);
    const { login, calls } = fakeLogin();
    const session = fileSession(dir, { credentials: CREDS, login });
    session.reset({ rejected: true });
    session.reset();
    await session.get();
    expect(calls).toHaveLength(0);
  });

  it("without credentials, a rejected session just reloads the saved tokens", async () => {
    const dir = tempDir();
    await new FileTokenStore(dir).save(TOKENS);
    const session = fileSession(dir);
    session.reset({ rejected: true });
    await expect(session.get()).resolves.toBeDefined();
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
