import { describe, expect, it, vi } from "vitest";
import { CookieJar } from "../../src/http/cookie-jar.js";

describe("CookieJar", () => {
  it("stores a cookie and returns it for the same host", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/sso/x", ["SESSION=abc; Path=/"]);
    expect(jar.cookieHeaderFor("https://sso.garmin.com/sso/y")).toBe("SESSION=abc");
  });

  it("joins multiple cookies with '; '", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", ["A=1; Path=/", "B=2; Path=/"]);
    const header = jar.cookieHeaderFor("https://sso.garmin.com/");
    expect(header?.split("; ").sort()).toEqual(["A=1", "B=2"]);
  });

  it("returns undefined when nothing matches", () => {
    const jar = new CookieJar();
    expect(jar.cookieHeaderFor("https://sso.garmin.com/")).toBeUndefined();
  });

  it("a later Set-Cookie with the same name/domain/path replaces the earlier one", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", ["S=old; Path=/"]);
    jar.setFromResponse("https://sso.garmin.com/", ["S=new; Path=/"]);
    expect(jar.cookieHeaderFor("https://sso.garmin.com/")).toBe("S=new");
  });

  it("does not leak a host-only cookie to a different host", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", ["S=abc; Path=/"]);
    expect(jar.cookieHeaderFor("https://connectapi.garmin.com/")).toBeUndefined();
  });

  it("sends a Domain cookie to subdomains but not to a suffix impostor", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", [
      "S=abc; Path=/; Domain=.garmin.com",
    ]);
    expect(jar.cookieHeaderFor("https://connectapi.garmin.com/")).toBe("S=abc");
    expect(jar.cookieHeaderFor("https://garmin.com/")).toBe("S=abc");
    expect(jar.cookieHeaderFor("https://evilgarmin.com/")).toBeUndefined();
  });

  it("matches on path prefix at a segment boundary", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/sso/a", ["S=abc; Path=/sso"]);
    expect(jar.cookieHeaderFor("https://sso.garmin.com/sso")).toBe("S=abc");
    expect(jar.cookieHeaderFor("https://sso.garmin.com/sso/deep/er")).toBe("S=abc");
    expect(jar.cookieHeaderFor("https://sso.garmin.com/ssoother")).toBeUndefined();
    expect(jar.cookieHeaderFor("https://sso.garmin.com/other")).toBeUndefined();
  });

  it("defaults Path to the request directory when absent", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/sso/deep/page", ["S=abc"]);
    expect(jar.cookieHeaderFor("https://sso.garmin.com/sso/deep/other")).toBe("S=abc");
    expect(jar.cookieHeaderFor("https://sso.garmin.com/sso")).toBeUndefined();
  });

  it("withholds a Secure cookie from http", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", ["S=abc; Path=/; Secure"]);
    expect(jar.cookieHeaderFor("http://sso.garmin.com/")).toBeUndefined();
    expect(jar.cookieHeaderFor("https://sso.garmin.com/")).toBe("S=abc");
  });

  it("drops an expired cookie", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", [
      "S=abc; Path=/; Expires=Thu, 01 Jan 2026 00:00:10 GMT",
    ]);
    expect(jar.cookieHeaderFor("https://sso.garmin.com/")).toBe("S=abc");
    vi.setSystemTime(new Date("2026-01-01T00:00:20Z"));
    expect(jar.cookieHeaderFor("https://sso.garmin.com/")).toBeUndefined();
    vi.useRealTimers();
  });

  it("honours Max-Age", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", ["S=abc; Path=/; Max-Age=10"]);
    vi.setSystemTime(new Date("2026-01-01T00:00:20Z"));
    expect(jar.cookieHeaderFor("https://sso.garmin.com/")).toBeUndefined();
    vi.useRealTimers();
  });

  it("round-trips through JSON", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", ["S=abc; Path=/; Domain=.garmin.com"]);
    const revived = CookieJar.fromJSON(JSON.parse(JSON.stringify(jar.toJSON())));
    expect(revived.cookieHeaderFor("https://connectapi.garmin.com/")).toBe("S=abc");
  });

  it("two jars do not share state", () => {
    const a = new CookieJar();
    const b = new CookieJar();
    a.setFromResponse("https://sso.garmin.com/", ["S=a; Path=/"]);
    expect(b.cookieHeaderFor("https://sso.garmin.com/")).toBeUndefined();
  });
});
