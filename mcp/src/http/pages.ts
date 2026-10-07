/** The hosted sign-in pages: the local sign-in page's look, posting to /mcp/oauth/signin. */
import { createHash } from "node:crypto";
import { escape, html } from "../signin-page.js";

/**
 * The one script the hosted pages run: on submit it blocks a second submit (a second Garmin login
 * burns a rate-limit attempt) and shows that something is happening. The pages work without it.
 * Forms opt in through `data-busy` (button label), `data-submit` (the button) and `data-status`.
 */
export const SUBMIT_SCRIPT =
  'document.querySelectorAll("form").forEach(function(f){var done=false;f.addEventListener("submit",function(e){' +
  'if(done){e.preventDefault();return;}done=true;' +
  'var b=f.querySelector("[data-submit]"),s=f.querySelector("[data-status]");' +
  'if(b){b.disabled=true;b.classList.add("busy");b.textContent=f.getAttribute("data-busy")||"Working…";}' +
  'if(s){s.hidden=false;}});});' +
  'window.addEventListener("pageshow",function(e){if(e.persisted){location.reload();}});';

/** CSP source for SUBMIT_SCRIPT, so no `unsafe-inline` for scripts. */
export const SUBMIT_SCRIPT_HASH = `'sha256-${createHash("sha256").update(SUBMIT_SCRIPT).digest("base64")}'`;

const SUBMIT_STYLE = `<style>button.busy{opacity:.8;cursor:wait}button.busy::before{content:"";display:inline-block;width:1em;height:1em;margin-right:.6em;vertical-align:-.15em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:gc-spin .8s linear infinite}@keyframes gc-spin{to{transform:rotate(360deg)}}[data-status]{margin-top:12px}</style>`;
const submitAssets = `${SUBMIT_STYLE}<script>${SUBMIT_SCRIPT}</script>`;

/** A CSP `form-action` source for the client's redirect: its origin, or its scheme for app links. */
export function formActionSource(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.protocol === "http:" || url.protocol === "https:" ? url.origin : url.protocol;
}

/**
 * Redirect targets the sign-in page trusts without asking: the known MCP clients. Anyone can
 * register a client under any name, so for any other target the user must confirm where the
 * authorization code goes.
 */
export const TRUSTED_REDIRECTS = {
  /** Exact host match, https only. */
  hosts: ["claude.ai", "claude.com"],
  /** Loopback, http or https, any port: a desktop client listening on the user's own machine. */
  loopbackHosts: ["127.0.0.1", "localhost", "[::1]"],
  /** App links. */
  schemes: ["cursor:", "vscode:", "vscode-insiders:"],
} as const;

export function isTrustedRedirect(redirectUri: string): boolean {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  if (url.protocol === "https:" && (TRUSTED_REDIRECTS.hosts as readonly string[]).includes(url.hostname)) return true;
  if ((url.protocol === "http:" || url.protocol === "https:") && (TRUSTED_REDIRECTS.loopbackHosts as readonly string[]).includes(url.hostname)) return true;
  return (TRUSTED_REDIRECTS.schemes as readonly string[]).includes(url.protocol);
}

/** What the user is told the code goes to: the host for a web URL, the scheme for an app link. */
export function redirectTarget(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.protocol === "http:" || url.protocol === "https:" ? url.host : url.protocol;
}

/** Browsers apply `form-action` to the redirect after a submit, so the client's origin must be in it. */
export function pageHeaders(redirectUri?: string): Record<string, string> {
  const formAction = redirectUri ? `'self' ${formActionSource(redirectUri)}` : "'self'";
  return {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": `default-src 'none'; script-src ${SUBMIT_SCRIPT_HASH}; style-src 'unsafe-inline'; form-action ${formAction}`,
    "cache-control": "no-store",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  };
}

const errorBox = (error?: string) => (error ? `<div class="error">${escape(error)}</div>` : "");

export function credentialsPage(o: { action: string; request: string; clientName: string | null; redirectUri: string; email?: string; error?: string }): string {
  const target = escape(redirectTarget(o.redirectUri));
  const client = o.clientName ? `an app that calls itself <strong>${escape(o.clientName)}</strong>` : "your MCP client";
  const confirm = isTrustedRedirect(o.redirectUri)
    ? ""
    : `<div class="error">${target} is not a known MCP client. Only continue if you started this from an app you trust.</div>
<label style="display:flex;gap:8px;align-items:center;margin-top:14px"><input type="checkbox" name="confirmRedirect" value="1" style="width:auto" required>I trust ${target} with access to my Garmin data</label>`;
  return html(
    "Connect Garmin",
    `<h1>Connect Garmin</h1><p>Sign in to Garmin Connect to use your Garmin data in ${client}. Your password goes only to Garmin and is never stored.</p>
<p>After you sign in, you'll be sent to <strong>${target}</strong>.</p>
${errorBox(o.error)}
<form method="post" action="${escape(o.action)}" data-busy="Signing in to Garmin…"><input type="hidden" name="request" value="${escape(o.request)}"><input type="hidden" name="step" value="credentials">
<label for="email">Email or username</label><input id="email" name="email" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${escape(o.email ?? "")}">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<label style="display:flex;gap:8px;align-items:center;margin-top:14px"><input type="checkbox" name="disconnectOthers" value="1" style="width:auto">Disconnect my other Garmin connections</label>
${confirm}
<button type="submit" data-submit>Sign in</button>
<p data-status role="status" hidden>This usually takes 5–15 seconds. Keep this window open.</p></form>${submitAssets}`,
  );
}

export function mfaPage(o: { action: string; mfa: string; error?: string }): string {
  return html(
    "Garmin verification code",
    `<h1>Enter your verification code</h1><p>Garmin sent a code to your email or phone.</p>
${errorBox(o.error)}
<form method="post" action="${escape(o.action)}" data-busy="Verifying…"><input type="hidden" name="mfa" value="${escape(o.mfa)}"><input type="hidden" name="step" value="mfa">
<label for="code">Code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required>
<button type="submit" data-submit>Verify</button>
<p data-status role="status" hidden>Checking your code with Garmin…</p></form>${submitAssets}`,
  );
}

export function errorPage(message: string): string {
  return html("Garmin sign-in", `<h1>Garmin sign-in</h1>${errorBox(message)}`);
}
