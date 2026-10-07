import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { GarminAuthError, GarminHttpError, GarminRateLimitError } from "garminconnect-js";
import { NotLoggedInError } from "./session.js";

// A Desktop Extension user has no terminal and no `garminconnect-mcp` command; the npm-install
// route documents `garminconnect-mcp login` separately (see README), but this hint has to work
// for both, so it names only the tool every install method has.
export const LOGIN_HINT = "call the `sign_in_to_garmin` tool to sign in, then try again";

/** Plain-language text for a failure. Library messages are already free of tokens. */
export function describeError(error: unknown, hint: string = LOGIN_HINT): string {
  if (error instanceof NotLoggedInError) {
    return error.reason ? `Not logged in to Garmin (${error.reason}): ${hint}.` : `Not logged in to Garmin: ${hint}.`;
  }
  if (error instanceof GarminAuthError) {
    return `Garmin session expired or was rejected (${error.message}): ${hint}.`;
  }
  if (error instanceof GarminRateLimitError) {
    const wait = error.retryAfter !== undefined ? `; retry after ${error.retryAfter} s` : "";
    return `Garmin is rate limiting requests${wait}. ${error.message}`;
  }
  if (error instanceof GarminHttpError) return `Garmin returned HTTP ${error.status}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function errorResult(error: unknown, hint?: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: describeError(error, hint) }] };
}
