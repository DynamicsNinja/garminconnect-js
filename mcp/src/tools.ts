import { methodTools } from "./method-tools.js";
import type { ToolFactory } from "./server.js";
import { signInTools } from "./signin-tool.js";
import { workoutTools } from "./workout-tools.js";

/** Every tool the server exposes, in listing order: sign-in and the workout tools first. */
export const TOOL_FACTORIES: readonly ToolFactory[] = [signInTools(), workoutTools, methodTools];

/** The hosted (HTTP) server: OAuth replaces `sign_in_to_garmin`, so it is not offered. */
export const HOSTED_TOOL_FACTORIES: readonly ToolFactory[] = [workoutTools, methodTools];
