import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { GarminAuthError, GarminHttpError, GarminRateLimitError } from "garminconnect-js";
import { NotLoggedInError } from "./session.js";

export const LOGIN_HINT =
  "call the `sign_in_to_garmin` tool to sign in (or run `garminconnect-mcp login` in a terminal), then try again";

/** Plain-language text for a failure. Library messages are already free of tokens. */
export function describeError(error: unknown): string {
  if (error instanceof NotLoggedInError) return `Not logged in to Garmin: ${LOGIN_HINT}.`;
  if (error instanceof GarminAuthError) {
    return `Garmin session expired or was rejected (${error.message}): ${LOGIN_HINT}.`;
  }
  if (error instanceof GarminRateLimitError) {
    const wait = error.retryAfter !== undefined ? `; retry after ${error.retryAfter} s` : "";
    return `Garmin is rate limiting requests${wait}. ${error.message}`;
  }
  if (error instanceof GarminHttpError) return `Garmin returned HTTP ${error.status}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function errorResult(error: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: describeError(error) }] };
}
