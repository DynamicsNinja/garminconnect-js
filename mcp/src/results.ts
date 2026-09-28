import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** One tool result may not exceed this; some Garmin responses run to megabytes. */
export const MAX_RESULT_CHARS = 100_000;

export function truncate(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated: ${MAX_RESULT_CHARS} of ${text.length} characters]`;
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text: truncate(text) }] };
}

export function jsonResult(value: unknown): CallToolResult {
  if (value === undefined) return textResult("Done. Garmin returned no content.");
  if (value === null) return textResult("null (Garmin returned no data)");
  return textResult(JSON.stringify(value, null, 2));
}
