/** The hosted sign-in pages: the local sign-in page's look, posting to /mcp/oauth/signin. */
import { escape, html } from "../signin-page.js";

/** A CSP `form-action` source for the client's redirect: its origin, or its scheme for app links. */
export function formActionSource(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.protocol === "http:" || url.protocol === "https:" ? url.origin : url.protocol;
}

/** Browsers apply `form-action` to the redirect after a submit, so the client's origin must be in it. */
export function pageHeaders(redirectUri?: string): Record<string, string> {
  const formAction = redirectUri ? `'self' ${formActionSource(redirectUri)}` : "'self'";
  return {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}`,
    "cache-control": "no-store",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  };
}

const errorBox = (error?: string) => (error ? `<div class="error">${escape(error)}</div>` : "");

export function credentialsPage(o: { action: string; request: string; clientName: string | null; email?: string; error?: string }): string {
  return html(
    "Connect Garmin",
    `<h1>Connect Garmin</h1><p>Sign in to Garmin Connect to use your Garmin data in ${escape(o.clientName ?? "your MCP client")}. Your password goes only to Garmin and is never stored.</p>
${errorBox(o.error)}
<form method="post" action="${escape(o.action)}"><input type="hidden" name="request" value="${escape(o.request)}"><input type="hidden" name="step" value="credentials">
<label for="email">Email or username</label><input id="email" name="email" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${escape(o.email ?? "")}">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<label style="display:flex;gap:8px;align-items:center;margin-top:14px"><input type="checkbox" name="disconnectOthers" value="1" style="width:auto">Disconnect my other Garmin connections</label>
<button type="submit">Sign in</button></form>`,
  );
}

export function mfaPage(o: { action: string; mfa: string; error?: string }): string {
  return html(
    "Garmin verification code",
    `<h1>Enter your verification code</h1><p>Garmin sent a code to your email or phone.</p>
${errorBox(o.error)}
<form method="post" action="${escape(o.action)}"><input type="hidden" name="mfa" value="${escape(o.mfa)}"><input type="hidden" name="step" value="mfa">
<label for="code">Code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required>
<button type="submit">Verify</button></form>`,
  );
}

export function errorPage(message: string): string {
  return html("Garmin sign-in", `<h1>Garmin sign-in</h1>${errorBox(message)}`);
}
