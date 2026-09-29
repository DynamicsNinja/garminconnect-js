import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

// `npm run check -w mcp` builds the extension before testing; a bare vitest run skips instead.
const OUT = new URL("../dist-mcpb/", import.meta.url);
const STAGE = new URL("stage/", OUT);
const built = existsSync(fileURLToPath(STAGE));
const describeBuilt = built ? describe : describe.skip;

describeBuilt("Desktop Extension (.mcpb)", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

  it("stages exactly the manifest, the icon and the bundled server", () => {
    const list = (dir: string, prefix = ""): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? list(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
      );
    expect(list(fileURLToPath(STAGE)).sort()).toEqual(["icon.png", "manifest.json", "server/index.js"]);
  });

  it("has a manifest whose version matches the package, and a real PNG icon", () => {
    const manifest = JSON.parse(readFileSync(new URL("manifest.json", STAGE), "utf8")) as Record<string, unknown>;
    expect(manifest["version"]).toBe(pkg.version);
    expect(manifest["manifest_version"]).toBe("0.4");
    const png = readFileSync(new URL("icon.png", STAGE));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("packs a zip named for the version", () => {
    const file = new URL(`garminconnect-mcp-${pkg.version}.mcpb`, OUT);
    expect(readFileSync(file).subarray(0, 2).toString()).toBe("PK");
  });

  it("runs from an empty folder with no node_modules and lists its tools", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gc-mcpb-"));
    const tokens = mkdtempSync(path.join(os.tmpdir(), "gc-mcpb-tokens-"));
    try {
      cpSync(new URL("server/index.js", STAGE), path.join(dir, "index.js"));
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(dir, "index.js")],
        env: { ...(process.env as Record<string, string>), GARMIN_MCP_TOKEN_DIR: tokens, GARMIN_MCP_GROUPS: "${user_config.groups}" },
      });
      const client = new Client({ name: "mcpb-test", version: "0" });
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(client.getServerVersion()?.version).toBe(pkg.version);
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["sign_in_to_garmin", "create_workout", "get_sleep_data"]));
      await client.close();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      rmSync(tokens, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 60_000);
});
