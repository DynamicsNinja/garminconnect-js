import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { parseSealKeys, Sealer } from "../../src/http/seal.js";

const k1 = randomBytes(32);
const k2 = randomBytes(32);

describe("Sealer", () => {
  it("round-trips data for the same purpose", () => {
    const s = new Sealer([k1]);
    expect(s.unseal("access", s.seal("access", { a: 1 }))).toEqual({ data: { a: 1 } });
  });

  it("refuses another purpose, tampering, garbage and non-strings", () => {
    const s = new Sealer([k1]);
    const t = s.seal("refresh", { a: 1 });
    expect(s.unseal("access", t)).toBeNull();
    const flipped = t.slice(0, 20) + (t[20] === "A" ? "B" : "A") + t.slice(21);
    expect(s.unseal("refresh", flipped)).toBeNull();
    expect(s.unseal("refresh", "not-a-token")).toBeNull();
    expect(s.unseal("refresh", 42)).toBeNull();
  });

  it("expires sealed data after its ttl", () => {
    let now = 1000;
    const s = new Sealer([k1], () => now);
    const t = s.seal("code", "x", 60);
    expect(s.unseal("code", t)).toEqual({ data: "x", exp: 1060 });
    now = 1060;
    expect(s.unseal("code", t)).toBeNull();
  });

  it("opens tokens sealed with an older key after rotation, and seals with the newest", () => {
    const old = new Sealer([k1]).seal("access", "x");
    const rotated = new Sealer([k2, k1]);
    expect(rotated.unseal("access", old)).toEqual({ data: "x" });
    expect(new Sealer([k2]).unseal("access", rotated.seal("access", "y"))).toEqual({ data: "y" });
    expect(new Sealer([k2]).unseal("access", old)).toBeNull();
  });

  it("makes a stable pseudonym that depends on the key", () => {
    expect(new Sealer([k1]).pseudonym("42")).toBe(new Sealer([k1]).pseudonym("42"));
    expect(new Sealer([k1]).pseudonym("42")).not.toBe(new Sealer([k2]).pseudonym("42"));
    expect(new Sealer([k1]).pseudonym("42")).not.toContain("42");
  });
});

describe("parseSealKeys", () => {
  it("parses comma-separated base64 keys", () => {
    expect(parseSealKeys(`${k1.toString("base64")}, ${k2.toString("base64")}`)).toEqual([k1, k2]);
  });
  it("refuses a missing or short key", () => {
    expect(() => parseSealKeys(undefined)).toThrow(/SEAL_KEYS is not set/);
    expect(() => parseSealKeys(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
