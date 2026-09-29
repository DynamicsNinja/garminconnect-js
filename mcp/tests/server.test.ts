import { describe, expect, it } from "vitest";
import { GarminAuthError, GarminHttpError } from "garminconnect-js";
import { createServer, type ToolFactory } from "../src/server.js";
import { textResult } from "../src/results.js";
import { connect, fakeFetch, sessionFor, testConfig, textOf } from "./helpers.js";

const tool = (name: string, run: () => Promise<never> | ReturnType<typeof textResult>): ToolFactory => () => [
  { tool: { name, inputSchema: { type: "object" } }, run: async () => run() },
];

describe("createServer", () => {
  const deps = () => ({ config: testConfig(), session: sessionFor(fakeFetch({}).fetchImpl) });

  it("introduces itself with a title and an icon", async () => {
    // Without an icon, clients such as Claude Desktop show a generic one on the permission
    // prompt. Deliberately our own watch glyph, not Garmin's logo: this is not a Garmin product.
    const client = await connect(deps(), []);
    const info = client.getServerVersion()!;
    expect(info).toMatchObject({ name: "garminconnect-mcp", title: "Garmin Connect (unofficial)" });
    expect(info.websiteUrl).toMatch(/^https:\/\/github\.com\/DynamicsNinja\/garminconnect-js/);
    const icon = info.icons?.[0];
    expect(icon?.mimeType).toBe("image/svg+xml");
    expect(icon?.src).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(icon!.src.split(",")[1]!, "base64").toString("utf8");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });

  it("lists and runs tools", async () => {
    const client = await connect(deps(), [tool("hello", () => textResult("hi"))]);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["hello"]);
    expect(textOf(await client.callTool({ name: "hello", arguments: {} }))).toBe("hi");
  });

  it("answers an unknown tool with an error result", async () => {
    const client = await connect(deps(), []);
    const result = await client.callTool({ name: "nope", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Unknown tool "nope"');
  });

  it("turns library errors into error results", async () => {
    const client = await connect(deps(), [
      tool("boom", () => Promise.reject(new GarminHttpError("server error", 500, "https://x", ""))),
    ]);
    const result = await client.callTool({ name: "boom", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Garmin returned HTTP 500: server error");
  });

  it("resets the session on an auth error so a fresh login is picked up", async () => {
    const d = deps();
    const client = await connect(d, [tool("auth", () => Promise.reject(new GarminAuthError("expired")))]);
    const result = await client.callTool({ name: "auth", arguments: {} });
    expect(textOf(result)).toContain("call the `sign_in_to_garmin` tool");
    expect(d.session.resets).toBe(1);
  });

  it("refuses duplicate tool names", () => {
    expect(() => createServer(deps(), [tool("a", () => textResult("")), tool("a", () => textResult(""))])).toThrow(
      /Duplicate tool name a/,
    );
  });
});
