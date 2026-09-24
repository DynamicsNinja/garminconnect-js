import { describe, expect, it } from "vitest";
import {
  csrfFrom,
  mfaVarsFrom,
  ticketFrom,
  titleFrom,
  widgetDelayMs,
  widgetUrls,
} from "../../src/auth/widget.js";

describe("widgetUrls", () => {
  it("builds the embed and signin parameters for a domain", () => {
    const u = widgetUrls("garmin.com");
    expect(u.base).toBe("https://sso.garmin.com/sso");
    expect(u.embed).toBe("https://sso.garmin.com/sso/embed");
    expect(u.signin).toBe("https://sso.garmin.com/sso/signin");
    expect(u.embedParams).toEqual({
      id: "gauth-widget",
      embedWidget: "true",
      gauthHost: "https://sso.garmin.com/sso",
    });
    expect(u.signinParams).toEqual({
      id: "gauth-widget",
      embedWidget: "true",
      gauthHost: "https://sso.garmin.com/sso/embed",
      service: "https://sso.garmin.com/sso/embed",
      source: "https://sso.garmin.com/sso/embed",
      redirectAfterAccountLoginUrl: "https://sso.garmin.com/sso/embed",
      redirectAfterAccountCreationUrl: "https://sso.garmin.com/sso/embed",
    });
    expect(widgetUrls("garmin.cn").embed).toBe("https://sso.garmin.cn/sso/embed");
  });
});

describe("HTML helpers", () => {
  it("reads the CSRF token", () => {
    expect(csrfFrom('<input type="hidden" name="_csrf" value="abc-123" />')).toBe("abc-123");
    expect(csrfFrom("<form></form>")).toBeNull();
  });

  it("reads and trims the page title", () => {
    expect(titleFrom("<html><head><title> Success </title></head></html>")).toBe("Success");
    expect(titleFrom("<TITLE>GARMIN Authentication Application</TITLE>")).toBe(
      "GARMIN Authentication Application",
    );
    expect(titleFrom("<html></html>")).toBe("");
  });

  it("reads the service ticket", () => {
    expect(ticketFrom('var u = "https://sso.garmin.com/sso/embed?ticket=ST-0123-abc";')).toBe(
      "ST-0123-abc",
    );
    expect(ticketFrom("embed?ticket=ST-9&x=1")).toBe("ST-9");
    expect(ticketFrom("no ticket here")).toBeNull();
  });

  it("reads the MFA page's inline variables", () => {
    const html =
      '<script>var customerGuid = "guid-1"; var mfaMethod = "email"; var locale = "en_US";' +
      ' var clientId = "GarminConnect"; var codeSentTo = "";</script>';
    expect(mfaVarsFrom(html)).toEqual({
      customerGuid: "guid-1",
      mfaMethod: "email",
      locale: "en_US",
      clientId: "GarminConnect",
      codeSentTo: "",
    });
    expect(mfaVarsFrom("<html></html>")).toEqual({});
  });
});

describe("widgetDelayMs", () => {
  it("honours an override, including 0", () => {
    expect(widgetDelayMs(0)).toBe(0);
    expect(widgetDelayMs(1234)).toBe(1234);
  });

  it("defaults to between 3 and 8 seconds", () => {
    for (let i = 0; i < 50; i++) {
      const ms = widgetDelayMs();
      expect(ms).toBeGreaterThanOrEqual(3000);
      expect(ms).toBeLessThanOrEqual(8000);
    }
  });
});
