/**
 * Builds the Claude Desktop Extension: stages manifest.json, icon.png and server/index.js, validates
 * the manifest, and packs garminconnect-mcp-<version>.mcpb with Anthropic's mcpb CLI.
 *
 *   npm run build:mcpb -w mcp   (after `npm run build -w mcp`, which produces dist-bundle/)
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { SERVER_ICON_SVG } from "../src/icon.js";

const MCP = fileURLToPath(new URL("..", import.meta.url));
const OUT = path.join(MCP, "dist-mcpb");
const STAGE = path.join(OUT, "stage");
const pkg = JSON.parse(readFileSync(path.join(MCP, "package.json"), "utf8")) as { version: string; description: string };

/**
 * The mcpb CLI entry, found by walking up to the nearest node_modules (workspaces hoist it).
 *
 * Deviation from the brief: `@anthropic-ai/mcpb@2.1.x`'s package.json declares `"bin"` as a plain
 * STRING (`"dist/cli/cli.js"`), not an object keyed by command name as the brief's snippet assumed
 * (`bin["mcpb"]`). Handle both shapes so this keeps working if a future version switches.
 */
function mcpbCli(): string {
  for (let dir = MCP; ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, "node_modules", "@anthropic-ai", "mcpb", "package.json");
    if (existsSync(manifest)) {
      const bin = (JSON.parse(readFileSync(manifest, "utf8")) as { bin: string | Record<string, string> }).bin;
      const rel = typeof bin === "string" ? bin : bin["mcpb"]!;
      return path.join(path.dirname(manifest), rel);
    }
    if (path.dirname(dir) === dir) throw new Error("@anthropic-ai/mcpb is not installed");
  }
}

const bundle = path.join(MCP, "dist-bundle", "index.js");
if (!existsSync(bundle)) throw new Error("dist-bundle/index.js is missing: run `npm run build -w mcp` first");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(STAGE, "server"), { recursive: true });
cpSync(bundle, path.join(STAGE, "server", "index.js"));
writeFileSync(path.join(STAGE, "icon.png"), new Resvg(SERVER_ICON_SVG, { fitTo: { mode: "width", value: 512 } }).render().asPng());

const template = JSON.parse(readFileSync(path.join(MCP, "extension", "manifest.template.json"), "utf8")) as Record<string, unknown>;
const manifest = { ...template, version: pkg.version, description: pkg.description };
writeFileSync(path.join(STAGE, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const cli = mcpbCli();
execFileSync(process.execPath, [cli, "validate", path.join(STAGE, "manifest.json")], { stdio: "inherit" });
const file = path.join(OUT, `garminconnect-mcp-${pkg.version}.mcpb`);
execFileSync(process.execPath, [cli, "pack", STAGE, file], { stdio: "inherit" });
console.log(`Built ${path.relative(process.cwd(), file)}`);
