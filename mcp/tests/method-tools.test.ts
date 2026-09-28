import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GARMIN_METHODS } from "garminconnect-js/manifest";
import { EXCLUDED, methodTools, OPT_IN, toolName } from "../src/method-tools.js";
import { connect, fakeFetch, json, PROFILE_ROUTE, sessionFor, testConfig, textOf } from "./helpers.js";
import type { McpConfig } from "../src/session.js";

const deps = (fetchImpl: typeof fetch, config: Partial<McpConfig> = {}) => ({
  config: testConfig(config),
  session: sessionFor(fetchImpl),
});
const names = (config: Partial<McpConfig> = {}) => methodTools(deps(fakeFetch({}).fetchImpl, config)).map((t) => t.tool.name);

describe("methodTools", () => {
  it("exposes every manifest method except the exclusions and opt-ins", () => {
    const expected = GARMIN_METHODS.filter((m) => !(m.name in EXCLUDED) && !(m.name in OPT_IN)).map((m) => toolName(m.name));
    expect(names().sort()).toEqual(expected.sort());
    for (const hidden of ["logout", "upload_workout", "update_workout", "query_garmin_graphql"]) {
      expect(names()).not.toContain(hidden);
    }
  });

  it("uses unique, valid MCP names", () => {
    const all = names({ enableGraphql: true });
    expect(new Set(all).size).toBe(all.length);
    for (const n of all) expect(n).toMatch(/^[a-z0-9_]{1,64}$/);
    expect(toolName("getSpo2Data")).toBe("get_spo2_data");
  });

  it("sets annotations from the safety class", () => {
    const tools = methodTools(deps(fakeFetch({}).fetchImpl));
    const find = (n: string) => tools.find((t) => t.tool.name === n)!.tool.annotations;
    expect(find("get_sleep_data")).toMatchObject({ readOnlyHint: true });
    expect(find("schedule_workout")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(find("delete_gear")).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it("offers GraphQL only when enabled", () => {
    expect(names({ enableGraphql: true })).toContain("query_garmin_graphql");
  });

  it("filters by group and rejects unknown groups", () => {
    const wellness = GARMIN_METHODS.filter((m) => m.category === "wellness").map((m) => toolName(m.name));
    expect(names({ groups: new Set(["wellness"]) }).sort()).toEqual(wellness.sort());
    expect(() => names({ groups: new Set(["welness"]) })).toThrow(/Unknown GARMIN_MCP_GROUPS value\(s\): welness\. Valid: .*wellness/);
  });

  it("replaces a Blob parameter with filePath in the input schema", () => {
    const tool = methodTools(deps(fakeFetch({}).fetchImpl)).find((t) => t.tool.name === "import_activity")!.tool;
    expect(tool.inputSchema.properties).toHaveProperty("filePath");
    expect(tool.inputSchema.properties).not.toHaveProperty("file");
    expect(tool.inputSchema.properties).not.toHaveProperty("filename");
    expect(tool.inputSchema.required).toEqual(["filePath"]);
  });

  it("calls the library and returns its JSON", async () => {
    const { fetchImpl, calls } = fakeFetch({
      ...PROFILE_ROUTE,
      "GET /wellness-service/wellness/dailySleepData": () => json({ dailySleepDTO: { id: 7 } }),
    });
    const client = await connect(deps(fetchImpl), [methodTools]);
    const result = await client.callTool({ name: "get_sleep_data", arguments: { cdate: "2026-09-20" } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ dailySleepDTO: { id: 7 } });
    expect(calls.some((c) => c.url.includes("dailySleepData") && c.url.includes("2026-09-20"))).toBe(true);
  });

  it("saves downloads to the download directory", async () => {
    const downloadDir = mkdtempSync(path.join(os.tmpdir(), "gc-dl-"));
    const fit = new Uint8Array(16);
    fit.set(new TextEncoder().encode(".FIT"), 8);
    const { fetchImpl } = fakeFetch({ "GET /workout-service/workout/FIT/42": () => new Response(fit) });
    const client = await connect(deps(fetchImpl, { downloadDir }), [methodTools]);
    const result = await client.callTool({ name: "download_workout", arguments: { workoutId: 42 } });
    expect(JSON.parse(textOf(result))).toEqual({ path: path.join(downloadDir, "download_workout-42.fit"), bytes: 16 });
  });

  it("uploads a local file", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gc-up-"));
    const gpx = path.join(dir, "run.gpx");
    writeFileSync(gpx, '<?xml version="1.0"?><gpx></gpx>');
    const { fetchImpl, calls } = fakeFetch({ "POST /upload-service/upload/gpx": () => json({ detailedImportResult: {} }) });
    const client = await connect(deps(fetchImpl), [methodTools]);
    const result = await client.callTool({ name: "import_activity", arguments: { filePath: gpx } });
    expect(result.isError, textOf(result)).toBeFalsy();
    expect(calls.find((c) => c.method === "POST")?.url).toContain("/upload-service/upload/gpx");
  });

  it("returns a bad file path as a tool error without calling Garmin", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    const client = await connect(deps(fetchImpl), [methodTools]);
    const result = await client.callTool({ name: "import_activity", arguments: { filePath: "run.gpx" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("absolute path");
    expect(calls).toEqual([]);
  });

  it("coerces an ISO 8601 date-time string for a bare-Date param (add_weigh_in's `when`)", async () => {
    const { fetchImpl, calls } = fakeFetch({ "POST /weight-service/user-weight": () => json({ ok: true }) });
    const client = await connect(deps(fetchImpl), [methodTools]);
    const result = await client.callTool({
      name: "add_weigh_in",
      arguments: { weightValue: 70, when: "2026-09-27T07:30:00" },
    });
    expect(result.isError, textOf(result)).toBeFalsy();
    const call = calls.find((c) => c.method === "POST" && c.url.includes("/weight-service/user-weight"));
    expect(call).toBeDefined();
    expect((call!.body as { dateTimestamp?: string }).dateTimestamp).toContain("2026-09-27");
  });

  it("rejects a non-date `when` before calling Garmin", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    const client = await connect(deps(fetchImpl), [methodTools]);
    const result = await client.callTool({
      name: "add_weigh_in",
      arguments: { weightValue: 70, when: "not a date" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("expected an ISO 8601 date-time");
    expect(calls).toEqual([]);
  });

  it("passes Garmin HTTP errors back as tool errors", async () => {
    const { fetchImpl } = fakeFetch({ ...PROFILE_ROUTE, "GET /activity-service/activity/9": () => json({ message: "nope" }, 500) });
    const client = await connect(deps(fetchImpl), [methodTools]);
    const result = await client.callTool({ name: "get_activity", arguments: { activityId: 9 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Garmin returned HTTP 500/);
  });
});
