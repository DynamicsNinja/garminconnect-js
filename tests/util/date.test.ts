import { describe, expect, it } from "vitest";
import { formatDate } from "../../src/util/date.js";

describe("formatDate", () => {
  it("passes a well-formed string through", () => {
    expect(formatDate("2026-09-22")).toBe("2026-09-22");
  });

  it("formats a Date as YYYY-MM-DD in UTC", () => {
    expect(formatDate(new Date("2026-09-22T23:30:00Z"))).toBe("2026-09-22");
  });

  it("zero-pads month and day", () => {
    expect(formatDate(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01-05");
  });

  it("rejects a malformed string", () => {
    expect(() => formatDate("22-09-2026")).toThrow(/YYYY-MM-DD/);
    expect(() => formatDate("2026-9-2")).toThrow(/YYYY-MM-DD/);
  });

  it("rejects an impossible date", () => {
    expect(() => formatDate("2026-13-01")).toThrow(/valid date/);
  });

  it("rejects an invalid Date object", () => {
    expect(() => formatDate(new Date("nope"))).toThrow(/valid date/);
  });
});
