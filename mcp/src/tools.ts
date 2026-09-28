import { methodTools } from "./method-tools.js";
import type { ToolFactory } from "./server.js";
import { workoutTools } from "./workout-tools.js";

/** Every tool the server exposes, in listing order: the hand-written workout tools first. */
export const TOOL_FACTORIES: readonly ToolFactory[] = [workoutTools, methodTools];
