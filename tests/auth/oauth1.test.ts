import { describe, expect, it } from "vitest";
import {
  buildOAuth1Header,
  percentEncode,
  signatureBaseString,
} from "../../src/auth/oauth1.js";

describe("percentEncode", () => {
  it("leaves unreserved characters alone", () => {
    expect(percentEncode("aZ0-._~")).toBe("aZ0-._~");
  });

  it("escapes the characters encodeURIComponent misses", () => {
    expect(percentEncode("!*'()")).toBe("%21%2A%27%28%29");
  });

  it("escapes reserved characters and space", () => {
    expect(percentEncode("a b&c=d")).toBe("a%20b%26c%3Dd");
  });

  it("encodes non-ASCII as UTF-8", () => {
    expect(percentEncode("é")).toBe("%C3%A9");
  });
});

describe("signatureBaseString", () => {
  // RFC 5849 section 3.4.1.1 worked example
  it("matches the RFC 5849 worked example", () => {
    const params = {
      b5: "=%3D",
      a3: "a",
      "c@": "",
      a2: "r b",
      oauth_consumer_key: "9djdj82h48djs9d2",
      oauth_token: "kkk9d7dh3k39sjv7",
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: "137131201",
      oauth_nonce: "7d8f3e4a",
      c2: "",
    };
    const base = signatureBaseString(
      "POST",
      "http://example.com/request",
      params,
    );
    expect(base).toBe(
      "POST&http%3A%2F%2Fexample.com%2Frequest&a2%3Dr%2520b%26a3%3Da%26b5" +
        "%3D%253D%25253D%26c%2540%3D%26c2%3D%26oauth_consumer_key%3D9djdj82h4" +
        "8djs9d2%26oauth_nonce%3D7d8f3e4a%26oauth_signature_method%3DHMAC-SHA1" +
        "%26oauth_timestamp%3D137131201%26oauth_token%3Dkkk9d7dh3k39sjv7",
    );
  });

  it("sorts params by encoded key, then by encoded value", () => {
    const base = signatureBaseString("GET", "https://x.test/p", {
      b: "2",
      a: "2",
      A: "1",
    });
    expect(base).toBe("GET&https%3A%2F%2Fx.test%2Fp&A%3D1%26a%3D2%26b%3D2");
  });

  it("normalizes the URL: lowercases scheme and host, drops the default port and query", () => {
    const base = signatureBaseString("GET", "HTTPS://X.TEST:443/p?q=1", {
      q: "1",
    });
    expect(base).toBe("GET&https%3A%2F%2Fx.test%2Fp&q%3D1");
  });
});

describe("buildOAuth1Header", () => {
  // Derived from the RFC 5849 section 1.2 / 2.1 temporary-credential example
  // (consumer key/secret, nonce, timestamp, callback all taken verbatim from
  // the RFC). The RFC's own published signature ("74KNZJeDHnMBp0EMJ9ZHt/XKycU=")
  // was computed WITHOUT an oauth_version parameter, because the RFC's example
  // request omits oauth_version entirely. This implementation always sends
  // oauth_version="1.0" (matching real-world OAuth1 implementations, including
  // the `oauthlib`/`requests_oauthlib` library that Garmin's own `garth` Python
  // client uses via `OAuth1Session`, where `Client.get_oauth_params()`
  // unconditionally includes `('oauth_version', '1.0')` in the signed
  // parameter set). Since oauth_version is sent, it MUST be part of what gets
  // signed, or Garmin's server would recompute a different signature and
  // reject the request. So the expected signature below is recomputed with
  // oauth_version included, verified independently via a standalone Node
  // script performing the same HMAC-SHA1 computation.
  it("produces a Garmin-compatible signature for the RFC 5849 section 1.2 temporary-credential example", () => {
    const header = buildOAuth1Header({
      method: "POST",
      url: "https://photos.example.net/initiate",
      consumerKey: "dpf43f3p2l4k3l03",
      consumerSecret: "kd94hf93k423kf44",
      nonce: "wIjqoS",
      timestamp: 137131200,
      bodyParams: { oauth_callback: "http://printer.example.com/ready" },
    });
    expect(header).toContain('oauth_signature="msrTmwtDEKqeVXeJaufuiXOpbJI%3D"');
    expect(header).toMatch(/^OAuth /);
    expect(header).toContain('oauth_consumer_key="dpf43f3p2l4k3l03"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toContain('oauth_version="1.0"');
  });

  it("includes the token and signs with the token secret when given", () => {
    const withToken = buildOAuth1Header({
      method: "GET",
      url: "https://x.test/a",
      consumerKey: "ck",
      consumerSecret: "cs",
      token: "tk",
      tokenSecret: "ts",
      nonce: "n",
      timestamp: 1,
    });
    const withoutToken = buildOAuth1Header({
      method: "GET",
      url: "https://x.test/a",
      consumerKey: "ck",
      consumerSecret: "cs",
      nonce: "n",
      timestamp: 1,
    });
    expect(withToken).toContain('oauth_token="tk"');
    expect(withoutToken).not.toContain("oauth_token=");
    expect(withToken).not.toBe(withoutToken);
  });

  it("signs query-string params from the URL", () => {
    const a = buildOAuth1Header({
      method: "GET",
      url: "https://x.test/a?ticket=ST-1",
      consumerKey: "ck",
      consumerSecret: "cs",
      nonce: "n",
      timestamp: 1,
    });
    const b = buildOAuth1Header({
      method: "GET",
      url: "https://x.test/a?ticket=ST-2",
      consumerKey: "ck",
      consumerSecret: "cs",
      nonce: "n",
      timestamp: 1,
    });
    expect(a).not.toBe(b);
  });

  it("generates a distinct nonce per call when not injected", () => {
    const args = {
      method: "GET",
      url: "https://x.test/a",
      consumerKey: "ck",
      consumerSecret: "cs",
    };
    expect(buildOAuth1Header(args)).not.toBe(buildOAuth1Header(args));
  });
});
