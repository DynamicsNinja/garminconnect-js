import { methodTools } from "./method-tools.js";
import type { ToolFactory } from "./server.js";

/** Every tool the server exposes, in listing order. */
export const TOOL_FACTORIES: readonly ToolFactory[] = [methodTools];
