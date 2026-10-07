import Ajv2020 from "ajv/dist/2020.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GARMIN_METHODS } from "garminconnect-js/manifest";
import { EXCLUDED, KNOWN_GROUPS, methodTools, OPT_IN, toolName } from "../src/method-tools.js";
import { connect, fakeFetch, json, PROFILE_ROUTE, sessionFor, testConfig, textOf } from "./helpers.js";
import type { McpConfig } from "../src/session.js";

const deps = (fetchImpl: typeof fetch, config: Partial<McpConfig> = {}) => ({
  config: testConfig(config),
  session: sessionFor(fetchImpl),
});
const names = (config: Partial<McpConfig> = {}) => methodTools(deps(fakeFetch({}).fetchImpl, config)).map((t) => t.tool.name);

describe("methodTools", () => {
  it("takes upload inputs and download delivery from the injected files strategy", async () => {
    const files = {
      uploadSchema: () => ({ properties: { content: { type: "string" } }, required: ["content"] }),
      readUpload: async () => ({ blob: new Blob(["x"]), filename: "x.gpx" }),
      deliverDownload: async (name: string) => ({ content: [{ type: "text" as const, text: `delivered ${name}` }] }),
    };
    const { fetchImpl } = fakeFetch({ "GET /download-service/files/activity/": () => new Response(new Uint8Array([1, 2])) });
    const tools = methodTools({ ...deps(fetchImpl), files });
    const upload = tools.find((t) => t.tool.name === "import_activity")!;
    expect(upload.tool.inputSchema.properties).toHaveProperty("content");
    expect(upload.tool.inputSchema.properties).not.toHaveProperty("filePath");
    const download = tools.find((t) => t.tool.name === "download_activity")!;
    expect(textOf(await download.run({ activityId: 7 }))).toBe("delivered download_activity-7");
  });
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

  it("filters by group", () => {
    const wellness = GARMIN_METHODS.filter((m) => m.category === "wellness").map((m) => toolName(m.name));
    expect(names({ groups: new Set(["wellness"]) }).sort()).toEqual(wellness.sort());
  });

  it("matches group names case-insensitively and trims them", () => {
    const wellness = GARMIN_METHODS.filter((m) => m.category === "wellness").map((m) => toolName(m.name));
    expect(names({ groups: new Set([" Wellness "]) }).sort()).toEqual(wellness.sort());
  });

  it("ignores unknown group names instead of throwing", () => {
    const wellness = GARMIN_METHODS.filter((m) => m.category === "wellness").map((m) => toolName(m.name));
    expect(names({ groups: new Set(["wellness", "welness"]) }).sort()).toEqual(wellness.sort());
  });

  it("falls back to every group when none of the requested ones are valid", () => {
    expect(names({ groups: new Set(["welness", "bogus"]) }).sort()).toEqual(names().sort());
  });

  it("lists every real group in the extension manifest template's description, and only real groups", () => {
    const templatePath = fileURLToPath(new URL("../extension/manifest.template.json", import.meta.url));
    const template = JSON.parse(readFileSync(templatePath, "utf8")) as {
      user_config: { groups: { description: string } };
    };
    const description = template.user_config.groups.description;
    // The description names the groups as a plain comma-separated list, e.g.
    // "...to load: activities, badges-challenges, ..., workouts. Empty loads...". Pull out the
    // list between "load:" and the following sentence's full stop.
    const listText = description.match(/load:\s*([a-z][a-z-]*(?:,\s*[a-z][a-z-]*)*)\./)?.[1];
    expect(listText, description).toBeTruthy();
    const named = listText!.split(",").map((g) => g.trim());
    expect(named.length).toBeGreaterThan(0);
    for (const g of named) expect(KNOWN_GROUPS.has(g), g).toBe(true);
    // And every real group is actually named, so the description can't silently go stale either way.
    expect(new Set(named)).toEqual(KNOWN_GROUPS);
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

  describe("argument validation against the tool's own input schema", () => {
    // The low-level MCP Server does not check arguments, so without this a wrong type reached the
    // library, and a misspelt optional argument was silently dropped.
    const call = async (name: string, args: Record<string, unknown>) => {
      const { fetchImpl, calls } = fakeFetch({});
      const client = await connect(deps(fetchImpl), [methodTools]);
      return { result: await client.callTool({ name, arguments: args }), calls };
    };

    it("rejects a wrong type before calling Garmin", async () => {
      const { result, calls } = await call("get_activities", { start: "abc" });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Invalid arguments for get_activities: start must be number");
      expect(calls).toEqual([]);
    });

    it("rejects an argument the tool does not take", async () => {
      const { result, calls } = await call("get_activities", { start: 0, lmit: 5 });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe('Invalid arguments for get_activities: unknown argument "lmit"');
      expect(calls).toEqual([]);
    });

    it("rejects a missing required argument", async () => {
      const { result } = await call("get_sleep_data", {});
      expect(textOf(result)).toBe('Invalid arguments for get_sleep_data: missing required argument "cdate"');
    });

    it("compiles every generated tool's schema, so no tool first fails when it is called", () => {
      // Validators compile lazily; a schema ajv cannot compile would otherwise only surface on use.
      const tools = methodTools(deps(fakeFetch({}).fetchImpl, { enableGraphql: true }));
      const ajv = new Ajv2020({ strict: false, validateFormats: false });
      for (const { tool } of tools) {
        expect(() => ajv.compile(tool.inputSchema), tool.name).not.toThrow();
      }
    });

    it("rejects a value outside an enum, listing the allowed ones", async () => {
      const { result } = await call("download_activity", { activityId: 1, format: "PDF" });
      expect(textOf(result)).toMatch(/^Invalid arguments for download_activity: format must be one of ORIGINAL, TCX, GPX/);
    });
  });
});
