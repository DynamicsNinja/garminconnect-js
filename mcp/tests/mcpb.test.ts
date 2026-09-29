import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mcpbCli } from "../scripts/mcpb-cli.js";

// `npm run check -w mcp` builds the extension before testing; a bare vitest run skips instead.
const MCP = fileURLToPath(new URL("..", import.meta.url));
const OUT = new URL("../dist-mcpb/", import.meta.url);
const STAGE = new URL("stage/", OUT);
const built = existsSync(fileURLToPath(STAGE));
const describeBuilt = built ? describe : describe.skip;

describeBuilt("Desktop Extension (.mcpb)", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  const archive = fileURLToPath(new URL(`garminconnect-mcp-${pkg.version}.mcpb`, OUT));

  // The spec cares about what actually ships inside the .mcpb, not the intermediate stage/
  // directory build-mcpb.ts assembles it from. Unpack the packed archive itself and assert on that.
  let unpacked: string;
  beforeAll(() => {
    unpacked = mkdtempSync(path.join(os.tmpdir(), "gc-mcpb-unpacked-"));
    execFileSync(process.execPath, [mcpbCli(MCP), "unpack", archive, unpacked]);
  });
  afterAll(() => {
    if (unpacked) rmSync(unpacked, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("packs exactly the manifest, the icon and the bundled server as .mjs", () => {
    const list = (dir: string, prefix = ""): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? list(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
      );
    expect(list(unpacked).sort()).toEqual(["icon.png", "manifest.json", "server/index.mjs"]);
  });

  it("has a manifest whose version matches the package, points at server/index.mjs, and a real PNG icon", () => {
    const manifest = JSON.parse(readFileSync(path.join(unpacked, "manifest.json"), "utf8")) as {
      version: string;
      manifest_version: string;
      server: { entry_point: string; mcp_config: { args: string[] } };
    };
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.manifest_version).toBe("0.4");
    expect(manifest.server.entry_point).toBe("server/index.mjs");
    expect(manifest.server.mcp_config.args).toEqual(["${__dirname}/server/index.mjs"]);
    const png = readFileSync(path.join(unpacked, "icon.png"));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("packs a zip named for the version", () => {
    expect(readFileSync(archive).subarray(0, 2).toString()).toBe("PK");
  });

  it("runs from an empty folder with no node_modules and lists its tools", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gc-mcpb-"));
    const tokens = mkdtempSync(path.join(os.tmpdir(), "gc-mcpb-tokens-"));
    try {
      copyFileSync(path.join(unpacked, "server", "index.mjs"), path.join(dir, "index.mjs"));
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(dir, "index.mjs")],
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

  it("would crash on Node 18/20 as .js, and does not as .mjs", () => {
    // The extension folder ships with no package.json, so there is no "type": "module" for Node to
    // read. Node 22 auto-detects ESM from source; Node 18/20 don't, and throw "Cannot use import
    // statement outside a module" instead. `--no-experimental-detect-module` (available on this
    // machine's Node 22) turns off that auto-detection and reproduces Node 18/20's behavior, without
    // needing a second Node install. This proves the OLD `server/index.js` naming used to fail here,
    // and confirms the current `.mjs` naming does not.
    // `--help` exits with process.exitCode = 2 by design (cli.ts's usage branch), so use spawnSync
    // rather than execFileSync, which would throw on that nonzero-but-expected exit code.
    const server = path.join(unpacked, "server", "index.mjs");
    const asDotJs = path.join(unpacked, "server", "index-as-dot-js-repro.js");
    try {
      // Simulate the pre-fix layout: same bundle contents, but named .js in a folder with no
      // package.json declaring "type": "module" — exactly what shipped before this fix round.
      copyFileSync(server, asDotJs);

      const before = spawnSync(process.execPath, ["--no-experimental-detect-module", asDotJs, "--help"], { encoding: "utf8" });
      expect(before.stderr).toContain("Cannot use import statement outside a module");
    } finally {
      rmSync(asDotJs, { force: true });
    }

    // The real, shipped .mjs file must run fine under the same reproduction flag.
    const after = spawnSync(process.execPath, ["--no-experimental-detect-module", server, "--help"], { encoding: "utf8" });
    expect(after.stderr).toContain(`garminconnect-mcp ${pkg.version}`);
    expect(after.stderr).not.toContain("SyntaxError");
  });
});
