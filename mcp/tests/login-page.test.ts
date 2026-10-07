import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { WORDMARK_DARK, WORDMARK_LIGHT } from "../src/brand.js";
import { credentialsForm, escape, loginHeaders, loginShell, messagePage, mfaForm, SUBMIT_SCRIPT, SUBMIT_SCRIPT_HASH } from "../src/login-page.js";

const GITHUB = "https://github.com/DynamicsNinja/garminconnect-js";

describe("login page", () => {
  it("hashes the script it embeds, and embeds it once", () => {
    expect(SUBMIT_SCRIPT_HASH).toBe(`'sha256-${createHash("sha256").update(SUBMIT_SCRIPT).digest("base64")}'`);
    for (const page of [credentialsForm({ hiddenFields: { key: "K" }, intro: "Hi" }), mfaForm({ hiddenFields: { key: "K" } })]) {
      expect(page).toContain(`<script>${SUBMIT_SCRIPT}</script>`);
      expect(page.match(/<script/g)).toHaveLength(1);
    }
    expect(messagePage("Done", "ok").match(/<script/g)).toBeNull();
  });

  it("escapes the error, email and hidden fields", () => {
    const page = credentialsForm({ hiddenFields: { request: 'a"<b' }, email: 'x"<y', error: "<bad>", intro: "Hi" });
    expect(page).toContain('name="request" value="a&quot;&lt;b"');
    expect(page).toContain('value="x&quot;&lt;y"');
    expect(page).toContain("&lt;bad&gt;");
    expect(page).not.toContain("<bad>");
    expect(escape(`<&"'>`)).toBe("&lt;&amp;&quot;&#39;&gt;");
    expect(messagePage("T<", "M<")).not.toMatch(/T<|M</);
  });

  it("carries the wordmark for both colour schemes, and the footer", () => {
    const page = loginShell("T", "<p>x</p>");
    expect(page).toContain("prefers-color-scheme: dark");
    expect(page).toContain("garminconnect-js: TypeScript client for Garmin Connect");
    expect(page).toContain("#0969DA");
    expect(page).toContain("#58A6FF");
    expect(page.length).toBeGreaterThan(WORDMARK_LIGHT.length + WORDMARK_DARK.length - 2000);
    expect(page).toContain(`href="${GITHUB}" target="_blank" rel="noopener noreferrer">garminconnect-js on GitHub</a>`);
    expect(page).toContain("Not affiliated with Garmin");
    // two inline SVGs in one document must not share a gradient id
    expect(page.match(/id="g"/g)).toHaveLength(1);
    expect(page).toContain('id="g-dark"');
  });

  it("builds the CSP and security headers", () => {
    expect(loginHeaders({ formAction: [] })["content-security-policy"]).toBe(`default-src 'none'; script-src ${SUBMIT_SCRIPT_HASH}; style-src 'unsafe-inline'; form-action 'self'`);
    expect(loginHeaders({ formAction: ["https://claude.ai", "cursor:"] })["content-security-policy"]).toContain("form-action 'self' https://claude.ai cursor:");
    expect(loginHeaders({ formAction: [] })).toMatchObject({ "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer" });
  });

  it("shows busy labels and status text", () => {
    expect(credentialsForm({ hiddenFields: {}, intro: "" })).toContain("This usually takes 5–15 seconds. Keep this window open.");
    expect(mfaForm({ hiddenFields: {} })).toContain("Checking your code with Garmin…");
  });
});

describe("submit script", () => {
  function run() {
    const handlers: Record<string, (e: unknown) => void> = {};
    const win: Record<string, (e: unknown) => void> = {};
    const classes = new Set<string>();
    const button = { disabled: false, textContent: "Sign in", classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } };
    const status = { hidden: true };
    const form = {
      querySelector: (q: string) => (q === "[data-submit]" ? button : q === "[data-status]" ? status : null),
      addEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] = h),
      getAttribute: () => "Signing in to Garmin…",
    };
    const reload = () => {
      throw new Error("must not reload");
    };
    const window = { addEventListener: (t: string, h: (e: unknown) => void) => (win[t] = h) };
    runInNewContext(SUBMIT_SCRIPT, { document: { querySelectorAll: () => [form] }, window, location: { reload } });
    return { handlers, win, button, status, classes };
  }

  it("blocks a second submit and shows progress", () => {
    const { handlers, button, status, classes } = run();
    let prevented = 0;
    handlers.submit!({ preventDefault: () => prevented++ });
    expect(prevented).toBe(0);
    expect(button).toMatchObject({ disabled: true, textContent: "Signing in to Garmin…" });
    expect(classes.has("busy")).toBe(true);
    expect(status.hidden).toBe(false);
    handlers.submit!({ preventDefault: () => prevented++ });
    expect(prevented).toBe(1);
  });

  it("resets, and does not reload, when restored from the back/forward cache", () => {
    const { handlers, win, button, status, classes } = run();
    handlers.submit!({ preventDefault() {} });
    win.pageshow!({ persisted: false });
    expect(button.disabled).toBe(true);
    win.pageshow!({ persisted: true });
    expect(button).toMatchObject({ disabled: false, textContent: "Sign in" });
    expect(classes.has("busy")).toBe(false);
    expect(status.hidden).toBe(true);
    let prevented = 0;
    handlers.submit!({ preventDefault: () => prevented++ });
    expect(prevented).toBe(0);
  });
});
