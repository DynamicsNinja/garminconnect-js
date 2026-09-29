/**
 * Builds the Claude Desktop Extension: stages manifest.json, icon.png and server/index.mjs, validates
 * the manifest, and packs garminconnect-mcp-<version>.mcpb with Anthropic's mcpb CLI.
 *
 *   npm run build:mcpb -w mcp   (after `npm run build -w mcp`, which produces dist-bundle/)
 *
 * The staged server is named `index.mjs`, not `.js`: the extension folder ships with no
 * package.json, so there is no `"type": "module"` for Node to read. Node 22 auto-detects ESM from
 * source; Node 18/20 don't, and fail with "Cannot use import statement outside a module". The
 * `.mjs` extension forces ESM regardless of Node version (see tsup.config.ts's `outExtension`).
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { SERVER_ICON_SVG } from "../src/icon.js";
import { mcpbCli } from "./mcpb-cli.js";

const MCP = fileURLToPath(new URL("..", import.meta.url));
const OUT = path.join(MCP, "dist-mcpb");
const STAGE = path.join(OUT, "stage");
const pkg = JSON.parse(readFileSync(path.join(MCP, "package.json"), "utf8")) as { version: string; description: string };

const bundle = path.join(MCP, "dist-bundle", "index.mjs");
if (!existsSync(bundle)) throw new Error("dist-bundle/index.mjs is missing: run `npm run build -w mcp` first");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(STAGE, "server"), { recursive: true });
cpSync(bundle, path.join(STAGE, "server", "index.mjs"));
writeFileSync(path.join(STAGE, "icon.png"), new Resvg(SERVER_ICON_SVG, { fitTo: { mode: "width", value: 512 } }).render().asPng());

const template = JSON.parse(readFileSync(path.join(MCP, "extension", "manifest.template.json"), "utf8")) as Record<string, unknown>;
const manifest = { ...template, version: pkg.version, description: pkg.description };
writeFileSync(path.join(STAGE, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const cli = mcpbCli(MCP);
execFileSync(process.execPath, [cli, "validate", path.join(STAGE, "manifest.json")], { stdio: "inherit" });
const file = path.join(OUT, `garminconnect-mcp-${pkg.version}.mcpb`);
execFileSync(process.execPath, [cli, "pack", STAGE, file], { stdio: "inherit" });
console.log(`Built ${path.relative(process.cwd(), file)}`);
