import { describe, expect, it } from "vitest";
import { credentialsPage, errorPage, mfaPage } from "../src/http/pages.js";
import { credentialsForm, messagePage, mfaForm } from "../src/login-page.js";

const EM_DASH = "\u2014";

describe("sign-in pages", () => {
  it("contain no em dash in anything a visitor sees", () => {
    const pages = {
      credentials: credentialsForm({ hiddenFields: { key: "K" }, intro: "Sign in" }),
      credentialsWithError: credentialsForm({ hiddenFields: { key: "K" }, intro: "Sign in", error: "Wrong password", email: "a@b.c" }),
      mfa: mfaForm({ hiddenFields: { key: "K" } }),
      mfaWithError: mfaForm({ hiddenFields: { key: "K" }, error: "Bad code" }),
      message: messagePage("Done", "You can close this tab."),
      hostedCredentials: credentialsPage({ action: "/a", request: "r", clientName: "Claude", redirectUri: "https://claude.ai/api/mcp/auth_callback" }),
      hostedMfa: mfaPage({ action: "/a", mfa: "m" }),
      hostedError: errorPage("Something went wrong"),
    };
    for (const [name, html] of Object.entries(pages)) expect(html.includes(EM_DASH), name).toBe(false);
  });
});