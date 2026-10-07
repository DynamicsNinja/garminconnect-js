import { describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { credentialsPage, errorPage, formActionSource, mfaPage, pageHeaders } from "../../src/http/pages.js";

describe("pages", () => {
  it("lets the form redirect to the client's origin or custom scheme", () => {
    expect(formActionSource("https://claude.ai/api/mcp/auth_callback")).toBe("https://claude.ai");
    expect(formActionSource("https://x.example/cb?a=1")).toBe("https://x.example");
    expect(formActionSource("cursor://anysphere.cursor-retrieval/oauth/callback")).toBe("cursor:");
    expect(pageHeaders("https://claude.ai/cb")["content-security-policy"]).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://claude.ai",
    );
    expect(pageHeaders()["content-security-policy"]).toContain("form-action 'self'");
    expect(pageHeaders()).toMatchObject({ "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer" });
  });

  it("renders the credentials form with escaped values", () => {
    const page = credentialsPage({ action: "/mcp/oauth/signin", request: "REQ", clientName: "<script>", email: 'a"b', error: "Bad <pw>" });
    expect(page).toContain('name="request" value="REQ"');
    expect(page).toContain('name="step" value="credentials"');
    expect(page).toContain('name="disconnectOthers" value="1"');
    expect(page).toContain("&lt;script&gt;");
    expect(page).toContain('value="a&quot;b"');
    expect(page).toContain("Bad &lt;pw&gt;");
    expect(page).not.toContain("<script>");
    expect(credentialsPage({ action: "/a", request: "R", clientName: null })).toContain("your MCP client");
  });

  it("renders the MFA and error pages", () => {
    const mfa = mfaPage({ action: "/mcp/oauth/signin", mfa: "M", error: "Wrong code" });
    expect(mfa).toContain('name="mfa" value="M"');
    expect(mfa).toContain('name="step" value="mfa"');
    expect(mfa).toContain("Wrong code");
    expect(errorPage("Expired <x>")).toContain("Expired &lt;x&gt;");
  });
});
