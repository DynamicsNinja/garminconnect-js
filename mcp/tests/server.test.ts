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
    expect(textOf(result)).toContain("npx garminconnect-mcp login");
    expect(d.session.resets).toBe(1);
  });

  it("refuses duplicate tool names", () => {
    expect(() => createServer(deps(), [tool("a", () => textResult("")), tool("a", () => textResult(""))])).toThrow(
      /Duplicate tool name a/,
    );
  });
});
