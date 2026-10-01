#!/usr/bin/env node
/**
 * `garminconnect-mcp`        start the MCP server on stdio (Claude Desktop runs this)
 * `garminconnect-mcp login`  sign in once and save the session
 *
 * stdout carries MCP protocol frames only; everything human-readable goes to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FileTokenStore, Garmin, GarminClient } from "garminconnect-js";
import { describeError } from "./errors.js";
import { login, terminalIo } from "./login.js";
import { createServer } from "./server.js";
import { fileSession, loadConfig } from "./session.js";
import { TOOL_FACTORIES } from "./tools.js";

const version = __MCP_VERSION__;
const USAGE = `garminconnect-mcp ${version}

  garminconnect-mcp          start the MCP server (stdio); Claude Desktop runs this
  garminconnect-mcp login    sign in to Garmin once and save the session
`;

const config = loadConfig();
const command = process.argv[2];
try {
  if (command === "login") {
    const client = new GarminClient({ tokenStore: new FileTokenStore(config.tokenDir) });
    await login(terminalIo(), client);
    const profile = await new Garmin(client).getUserProfile();
    console.error(`Logged in as ${profile.displayName}. Session saved to ${config.tokenDir}.`);
  } else if (command === undefined) {
    const server = createServer({ config, session: fileSession(config.tokenDir, { credentials: config.credentials }), version }, TOOL_FACTORIES);
    await server.connect(new StdioServerTransport());
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}
