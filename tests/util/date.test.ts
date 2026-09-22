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

  it("rejects a calendar date that JavaScript would silently roll over", () => {
    // Without the round-trip comparison in formatDate, these would silently
    // roll forward (e.g. Feb 30 -> Mar 2) instead of throwing.
    expect(() => formatDate("2026-02-30")).toThrow(/valid date/);
    expect(() => formatDate("2026-04-31")).toThrow(/valid date/); // April has 30 days
    expect(() => formatDate("2026-02-29")).toThrow(/valid date/); // 2026 is not a leap year
  });

  it("accepts Feb 29 in a leap year", () => {
    expect(formatDate("2028-02-29")).toBe("2028-02-29"); // 2028 is a leap year
  });
});
