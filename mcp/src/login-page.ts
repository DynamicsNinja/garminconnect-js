/**
 * The one Garmin sign-in page, shared by the hosted server (http/pages.ts) and the Desktop
 * Extension's local page (signin-page.ts): shell, branding, forms, the submit script and the CSP.
 * Callers add only their own copy and hidden fields.
 */
import { createHash } from "node:crypto";
import { WORDMARK_DARK, WORDMARK_LIGHT } from "./brand.js";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

const REPO_URL = "https://github.com/DynamicsNinja/garminconnect-js";

/**
 * The one script the pages run: on submit it blocks a second submit (a second Garmin login burns a
 * rate-limit attempt) and shows that something is happening. The pages work without it. Forms opt
 * in through `data-busy` (button label), `data-submit` (the button) and `data-status`. When the
 * browser restores the page from its back/forward cache the form is reset, never reloaded:
 * reloading the result of a POST makes the browser offer to re-submit the credentials.
 */
export const SUBMIT_SCRIPT =
  'document.querySelectorAll("form").forEach(function(f){' +
  'var done=false,b=f.querySelector("[data-submit]"),s=f.querySelector("[data-status]"),label=b&&b.textContent;' +
  'f.addEventListener("submit",function(e){if(done){e.preventDefault();return;}done=true;' +
  'if(b){b.disabled=true;b.classList.add("busy");b.textContent=f.getAttribute("data-busy")||"Working\\u2026";}' +
  "if(s){s.hidden=false;}});" +
  'window.addEventListener("pageshow",function(e){if(e.persisted){done=false;' +
  "if(b){b.disabled=false;b.classList.remove(\"busy\");b.textContent=label;}if(s){s.hidden=true;}}});});";

/** CSP source for SUBMIT_SCRIPT, so scripts never need `unsafe-inline`. */
export const SUBMIT_SCRIPT_HASH = `'sha256-${createHash("sha256").update(SUBMIT_SCRIPT).digest("base64")}'`;

export function loginHeaders(o: { formAction: string[] }): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": `default-src 'none'; script-src ${SUBMIT_SCRIPT_HASH}; style-src 'unsafe-inline'; form-action ${["'self'", ...o.formAction].join(" ")}`,
    "cache-control": "no-store",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  };
}

// Both wordmarks sit in one document, so the dark one's gradient id must differ from the light one's.
const wordmark = (svg: string, id?: string) => (id ? svg.replace('id="g"', `id="${id}"`).replace("url(#g)", `url(#${id})`) : svg);

const STYLE = `<style>
:root{color-scheme:light dark;--bg:#f6f8fa;--card:#fff;--line:#d0d7de;--text:#1f2328;--muted:#59636e;--input:#fff;--err-bg:#ffebe9;--err:#82071e;--accent:#0969da;--btn-text:#fff;--btn-from:#0969DA;--btn-to:#0A8F7F}
@media (prefers-color-scheme: dark){:root{--bg:#0d1117;--card:#161b22;--line:#30363d;--text:#e6edf3;--muted:#9198a1;--input:#0d1117;--err-bg:#3d1214;--err:#ffb3ad;--accent:#58a6ff;--btn-text:#0d1117;--btn-from:#58A6FF;--btn-to:#39D3BB}}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px}
main{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px;width:100%;max-width:400px}
.brand{margin:0 0 20px}.brand svg{display:block;width:100%;max-width:320px;height:auto;margin:0 auto}.brand-dark{display:none}
@media (prefers-color-scheme: dark){.brand-light{display:none}.brand-dark{display:block}}
h1{font-size:1.25rem;margin:0 0 6px}p{color:var(--muted);margin:0 0 16px;line-height:1.45}
label{display:block;font-size:.9rem;margin:14px 0 4px}
input[type=text],input[type=password],input:not([type]){width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--input);color:var(--text);font-size:16px}
input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
button{margin-top:20px;width:100%;padding:12px;border:0;border-radius:8px;background:linear-gradient(90deg,var(--btn-from),var(--btn-to));color:var(--btn-text);font-size:1rem;font-weight:600;cursor:pointer}
button:disabled{cursor:wait;opacity:.85}
button.busy::before{content:"";display:inline-block;width:1em;height:1em;margin-right:.6em;vertical-align:-.15em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:gc-spin .8s linear infinite}
@keyframes gc-spin{to{transform:rotate(360deg)}}
[data-status]{margin:12px 0 0;font-size:.9rem}
.error{background:var(--err-bg);color:var(--err);border-radius:8px;padding:10px;margin-bottom:8px}
footer{margin-top:16px;font-size:.8rem;color:var(--muted);text-align:center;max-width:400px}footer a{color:inherit}
</style>`;

export function loginShell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>${STYLE}</head><body><main>
<div class="brand"><div class="brand-light">${WORDMARK_LIGHT}</div><div class="brand-dark">${wordmark(WORDMARK_DARK, "g-dark")}</div></div>
${body}</main><footer>Open source · <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">garminconnect-js on GitHub</a> · Not affiliated with Garmin</footer></body></html>`;
}

const errorBox = (error?: string) => (error ? `<div class="error" role="alert">${escape(error)}</div>` : "");
const hidden = (fields: Record<string, string>) => Object.entries(fields).map(([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`).join("");
const script = `<script>${SUBMIT_SCRIPT}</script>`;

/** `intro` and `extraFieldsHtml` are trusted HTML: the caller escapes anything it interpolates. */
export function credentialsForm(o: { hiddenFields: Record<string, string>; email?: string; error?: string; intro: string; extraFieldsHtml?: string; action?: string }): string {
  return loginShell(
    "Sign in to Garmin",
    `<h1>Sign in to Garmin Connect</h1>${o.intro}
${errorBox(o.error)}
<form method="post"${o.action ? ` action="${escape(o.action)}"` : ""} data-busy="Signing in to Garmin…">${hidden(o.hiddenFields)}<input type="hidden" name="step" value="credentials">
<label for="email">Email or username</label><input id="email" name="email" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${escape(o.email ?? "")}">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
${o.extraFieldsHtml ?? ""}
<button type="submit" data-submit>Sign in</button>
<p data-status role="status" hidden>This usually takes 5–15 seconds. Keep this window open.</p></form>${script}`,
  );
}

export function mfaForm(o: { hiddenFields: Record<string, string>; error?: string; action?: string }): string {
  return loginShell(
    "Garmin verification code",
    `<h1>Enter your verification code</h1><p>Garmin sent a code to your email or phone.</p>
${errorBox(o.error)}
<form method="post"${o.action ? ` action="${escape(o.action)}"` : ""} data-busy="Verifying…">${hidden(o.hiddenFields)}<input type="hidden" name="step" value="mfa">
<label for="code">Code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required>
<button type="submit" data-submit>Verify</button>
<p data-status role="status" hidden>Checking your code with Garmin…</p></form>${script}`,
  );
}

/** A page with no form: an error, or "signed in, close this tab". Both arguments are plain text. */
export function messagePage(title: string, message: string): string {
  return loginShell(title, `<h1>${escape(title)}</h1><p>${escape(message)}</p>`);
}
