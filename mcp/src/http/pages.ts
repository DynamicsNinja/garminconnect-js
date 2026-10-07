/** The hosted sign-in pages: the local sign-in page's look, posting to /mcp/oauth/signin. */
import { credentialsForm, escape, loginHeaders, messagePage, mfaForm } from "../login-page.js";

export { SUBMIT_SCRIPT, SUBMIT_SCRIPT_HASH } from "../login-page.js";

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
  return loginHeaders({ formAction: redirectUri ? [formActionSource(redirectUri)] : [] });
}

export function credentialsPage(o: { action: string; request: string; clientName: string | null; redirectUri: string; email?: string; error?: string }): string {
  const target = escape(redirectTarget(o.redirectUri));
  const client = o.clientName ? `an app that calls itself <strong>${escape(o.clientName)}</strong>` : "your MCP client";
  const trust = isTrustedRedirect(o.redirectUri)
    ? ""
    : `<div class="error">${target} is not a known MCP client. Only continue if you started this from an app you trust.</div>
<label style="display:flex;gap:8px;align-items:center;margin-top:14px"><input type="checkbox" name="confirmRedirect" value="1" style="width:auto" required>I trust ${target} with access to my Garmin data</label>`;
  return credentialsForm({
    action: o.action,
    hiddenFields: { request: o.request },
    email: o.email,
    error: o.error,
    intro: `<p>Sign in to Garmin Connect to use your Garmin data in ${client}. Your password goes only to Garmin and is never stored.</p>
<p>After you sign in, you'll be sent to <strong>${target}</strong>.</p>`,
    extraFieldsHtml: `<label style="display:flex;gap:8px;align-items:center;margin-top:14px"><input type="checkbox" name="disconnectOthers" value="1" style="width:auto">Disconnect my other Garmin connections</label>
${trust}`,
  });
}

export const mfaPage = (o: { action: string; mfa: string; error?: string }): string => mfaForm({ action: o.action, hiddenFields: { mfa: o.mfa }, error: o.error });

export const errorPage = (message: string): string => messagePage("Garmin sign-in", message);
