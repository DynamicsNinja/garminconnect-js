import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const read = (p: string): Record<string, unknown> => JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

describe("@dynamicsninja/garminconnect-mcp package contract", () => {
  const root = read("package.json");
  const mcp = read("mcp/package.json");
  const mcpScripts = mcp.scripts as Record<string, string>;
  const prepack = mcpScripts.prepack ?? "";

  it("publishes under the maintainer's scope, publicly", () => {
    // npm rejected the unscoped `garminconnect-mcp` as too similar to `garmin-connect-mcp`. A
    // scoped package is private unless told otherwise, so without publishConfig the release
    // workflow's plain `npm publish -w mcp` would fail or publish a private package.
    expect(mcp.name).toBe("@dynamicsninja/garminconnect-mcp");
    expect(mcp.publishConfig).toEqual({ access: "public" });
    // The command users run stays short, whatever the package is called.
    expect(mcp.bin).toEqual({ "garminconnect-mcp": "dist/cli.js" });
  });

  it("is released in lockstep with the library", () => {
    expect(mcp.version, "run `npm run bump -- <version>` to bump both").toBe(root.version);
  });

  it("depends only on the MCP SDK and ajv; the library is bundled, not installed", () => {
    // ajv validates tool arguments. The SDK already depends on it, so it adds nothing to install.
    expect(Object.keys(mcp.dependencies as object).sort()).toEqual(["@modelcontextprotocol/sdk", "ajv"]);
    expect(readFileSync("mcp/tsup.config.ts", "utf8")).toContain("noExternal: [/^garminconnect-js/]");
  });

  it("is a workspace of this repo, and the library keeps zero dependencies", () => {
    expect(root.workspaces).toEqual(["mcp"]);
    expect(root.dependencies).toEqual({});
  });

  it("ships the MIT LICENSE and NOTICE in the published tarball", () => {
    expect(mcp.files).toEqual(expect.arrayContaining(["LICENSE", "NOTICE"]));
    expect(prepack).toContain("LICENSE");
    expect(prepack).toContain("NOTICE");
  });

  it("prepack actually copies LICENSE/NOTICE from the root into mcp/", () => {
    expect(prepack.length, "mcp/package.json is missing a prepack script").toBeGreaterThan(0);
    // Run the REAL prepack script (not a re-implementation of it), from a throwaway directory
    // shaped like `mcp/` (a direct child of the repo root, where the real LICENSE/NOTICE live),
    // so this fails if the script's mechanism — not just its text — stops working.
    const scratch = mkdtempSync(path.join(process.cwd(), "mcp-prepack-test-"));
    try {
      // Run the script's own command line (it already starts with `node -e "..."`) through a
      // shell, exactly as `npm run prepack`/`npm pack` would invoke it.
      execSync(prepack, { cwd: scratch, env: process.env });
      expect(existsSync(path.join(scratch, "LICENSE"))).toBe(true);
      expect(existsSync(path.join(scratch, "NOTICE"))).toBe(true);
      expect(readFileSync(path.join(scratch, "LICENSE"), "utf8")).toEqual(readFileSync("LICENSE", "utf8"));
    } finally {
      // Windows can hold the just-written files briefly (indexer, antivirus); retry the delete.
      rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 30_000); // spawns a shell and Node: slow under a busy full-suite run on Windows
});
