import { describe, expect, it } from "vitest";
import { jsonResult, MAX_RESULT_CHARS, truncate } from "../src/results.js";

describe("results", () => {
  it("leaves short text alone", () => {
    expect(truncate("abc")).toBe("abc");
  });
  it("truncates long text and says so", () => {
    const out = truncate("x".repeat(MAX_RESULT_CHARS + 5));
    expect(out.startsWith("x".repeat(MAX_RESULT_CHARS))).toBe(true);
    expect(out.endsWith(`[truncated: ${MAX_RESULT_CHARS} of ${MAX_RESULT_CHARS + 5} characters]`)).toBe(true);
  });
  it("serializes JSON, and says so when there is nothing", () => {
    expect(jsonResult({ a: 1 }).content).toEqual([{ type: "text", text: '{\n  "a": 1\n}' }]);
    expect(jsonResult(null).content).toEqual([{ type: "text", text: "null (Garmin returned no data)" }]);
    expect(jsonResult(undefined).content).toEqual([{ type: "text", text: "Done. Garmin returned no content." }]);
  });
});
