import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { GarminAuthError } from "garminconnect-js";
import { errorResult } from "./errors.js";
import type { McpConfig, Session } from "./session.js";

export interface ToolDef {
  tool: Tool;
  run(input: Record<string, unknown>): Promise<CallToolResult>;
}

export interface ServerDeps {
  config: McpConfig;
  session: Session;
  version?: string;
}

export type ToolFactory = (deps: ServerDeps) => ToolDef[];

export function createServer(deps: ServerDeps, factories: readonly ToolFactory[]): Server {
  const tools = factories.flatMap((factory) => factory(deps));
  const byName = new Map<string, ToolDef>();
  for (const def of tools) {
    if (byName.has(def.tool.name)) throw new Error(`Duplicate tool name ${def.tool.name}`);
    byName.set(def.tool.name, def);
  }

  const server = new Server(
    { name: "garminconnect-mcp", version: deps.version ?? "0.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map((t) => t.tool) }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const def = byName.get(request.params.name);
    if (!def) return errorResult(new Error(`Unknown tool "${request.params.name}"`));
    try {
      return await def.run(request.params.arguments ?? {});
    } catch (error) {
      // After `login` in a terminal, the next call must use the NEW tokens, not the cached client.
      if (error instanceof GarminAuthError) deps.session.reset();
      return errorResult(error);
    }
  });
  return server;
}
