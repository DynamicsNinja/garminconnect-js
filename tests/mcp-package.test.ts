import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string): Record<string, unknown> => JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

describe("garminconnect-mcp package contract", () => {
  const root = read("package.json");
  const mcp = read("mcp/package.json");

  it("is released in lockstep with the library", () => {
    expect(mcp.version, "run `npm run bump -- <version>` to bump both").toBe(root.version);
  });

  it("depends only on the MCP SDK; the library is bundled, not installed", () => {
    expect(Object.keys(mcp.dependencies as object)).toEqual(["@modelcontextprotocol/sdk"]);
    expect(readFileSync("mcp/tsup.config.ts", "utf8")).toContain("noExternal: [/^garminconnect-js/]");
  });

  it("is a workspace of this repo, and the library keeps zero dependencies", () => {
    expect(root.workspaces).toEqual(["mcp"]);
    expect(root.dependencies).toEqual({});
  });
});
