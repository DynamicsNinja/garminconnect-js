import { describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { credentialsPage, errorPage, formActionSource, isTrustedRedirect, mfaPage, pageHeaders, redirectTarget, TRUSTED_REDIRECTS } from "../../src/http/pages.js";

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
    const page = credentialsPage({ action: "/mcp/oauth/signin", request: "REQ", clientName: "<script>", redirectUri: "https://claude.ai/cb", email: 'a"b', error: "Bad <pw>" });
    expect(page).toContain('name="request" value="REQ"');
    expect(page).toContain('name="step" value="credentials"');
    expect(page).toContain('name="disconnectOthers" value="1"');
    expect(page).toContain("&lt;script&gt;");
    expect(page).toContain('value="a&quot;b"');
    expect(page).toContain("Bad &lt;pw&gt;");
    expect(page).not.toContain("<script>");
    expect(credentialsPage({ action: "/a", request: "R", clientName: null, redirectUri: "https://claude.ai/cb" })).toContain("your MCP client");
  });

  it("knows the trusted redirect targets", () => {
    expect(TRUSTED_REDIRECTS.hosts).toEqual(["claude.ai", "claude.com"]);
    for (const uri of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback",
      "http://127.0.0.1/callback",
      "https://127.0.0.1:8443/cb",
      "http://localhost:6274/oauth/callback",
      "http://[::1]:9000/cb",
      "cursor://anysphere.cursor-retrieval/oauth/callback",
      "vscode://vscode.github-authentication/did-authenticate",
      "vscode-insiders://x/cb",
    ]) {
      expect(isTrustedRedirect(uri), uri).toBe(true);
    }
    for (const uri of [
      "http://claude.ai/cb", // https only
      "https://evil.claude.ai/cb",
      "https://claude.ai.evil.example/cb",
      "https://evil.example/cb",
      "ftp://127.0.0.1/cb",
      "javascript://x",
      "not a url",
    ]) {
      expect(isTrustedRedirect(uri), uri).toBe(false);
    }
    expect(redirectTarget("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
    expect(redirectTarget("http://localhost:6274/cb")).toBe("localhost:6274");
    expect(redirectTarget("cursor://anysphere.cursor-retrieval/oauth/callback")).toBe("cursor:");
  });

  it("says where the code goes, and that the client name is self-declared", () => {
    const page = credentialsPage({ action: "/a", request: "R", clientName: "Claude", redirectUri: "https://claude.ai/api/mcp/auth_callback" });
    expect(page).toContain("After you sign in, you'll be sent to <strong>claude.ai</strong>");
    expect(page).toContain("an app that calls itself <strong>Claude</strong>");
    expect(page).not.toContain("confirmRedirect");
    expect(page).not.toContain("not a known MCP client");
  });

  it("warns about an unknown redirect target and asks for a confirmation", () => {
    const page = credentialsPage({ action: "/a", request: "R", clientName: "Claude", redirectUri: "https://evil.example/cb" });
    expect(page).toContain("you'll be sent to <strong>evil.example</strong>");
    expect(page).toContain("evil.example is not a known MCP client. Only continue if you started this from an app you trust.");
    expect(page).toMatch(/<input type="checkbox" name="confirmRedirect" value="1"[^>]*required/);
    expect(page).toContain("I trust evil.example with access to my Garmin data");
  });

  it("renders the MFA and error pages", () => {
    const mfa = mfaPage({ action: "/mcp/oauth/signin", mfa: "M", error: "Wrong code" });
    expect(mfa).toContain('name="mfa" value="M"');
    expect(mfa).toContain('name="step" value="mfa"');
    expect(mfa).toContain("Wrong code");
    expect(errorPage("Expired <x>")).toContain("Expired &lt;x&gt;");
  });
});
