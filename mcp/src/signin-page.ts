/**
 * A one-off Garmin sign-in page served on this computer only, so a Desktop Extension user can sign
 * in (including MFA) without a terminal. The password goes from the browser straight to the
 * library's `login`; it is never stored, logged, echoed, or shown to Claude.
 *
 * Only 127.0.0.1, a random port, and a random one-time key in the URL; the exact Host is checked
 * (DNS rebinding) and the key is re-checked in every POST (other sites cannot submit to it).
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { LoginResult, MfaState } from "garminconnect-js";

export interface SignInClient {
  login(email: string, password: string): Promise<LoginResult>;
  resumeLogin(mfaState: MfaState, code: string): Promise<void>;
  displayName(): Promise<string>;
}

export interface SignInPageOptions {
  createClient: () => SignInClient;
  onSignedIn: () => void;
  idleMs?: number;
}

export interface SignInPage {
  readonly url: string;
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};
const MAX_BODY = 16 * 1024;

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

function html(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>
body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;width:min(360px,90vw)}
h1{font-size:1.25rem;margin:0 0 4px}p{color:#475569;margin:0 0 16px}
label{display:block;font-size:.9rem;margin:12px 0 4px}input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:1rem}
button{margin-top:18px;width:100%;padding:10px;border:0;border-radius:8px;background:#0f766e;color:#fff;font-size:1rem;cursor:pointer}
.error{background:#fef2f2;color:#991b1b;border-radius:8px;padding:10px;margin-bottom:8px}
</style></head><body><main>${body}</main></body></html>`;
}

function credentialsForm(key: string, error?: string, email = ""): string {
  return html(
    "Sign in to Garmin",
    `<h1>Sign in to Garmin Connect</h1><p>For the Garmin tools in Claude. Your password goes only to Garmin.</p>
${error ? `<div class="error">${escape(error)}</div>` : ""}
<form method="post"><input type="hidden" name="key" value="${escape(key)}"><input type="hidden" name="step" value="credentials">
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required value="${escape(email)}">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Sign in</button></form>`,
  );
}

function mfaForm(key: string, error?: string): string {
  return html(
    "Garmin verification code",
    `<h1>Enter your verification code</h1><p>Garmin sent a code to your email or phone.</p>
${error ? `<div class="error">${escape(error)}</div>` : ""}
<form method="post"><input type="hidden" name="key" value="${escape(key)}"><input type="hidden" name="step" value="mfa">
<label for="code">Code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required>
<button type="submit">Verify</button></form>`,
  );
}

const donePage = (name: string) =>
  html("Signed in", `<h1>Signed in as ${escape(name)}</h1><p>You can close this tab and go back to Claude.</p>`);

function readBody(req: http.IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Request too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", reject);
    // An aborted upload never emits "end"; settle instead of hanging (a no-op once resolved).
    req.on("close", () => reject(new Error("Request aborted")));
  });
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function startSignInPage(options: SignInPageOptions): Promise<SignInPage> {
  const key = randomBytes(32).toString("base64url");
  const keyBytes = Buffer.from(key);
  /** Constant-time key check (length first; the length of a 43-char key is no secret). */
  const isKey = (candidate: string | null | undefined): boolean => {
    if (candidate == null) return false;
    const bytes = Buffer.from(candidate);
    return bytes.length === keyBytes.length && timingSafeEqual(bytes, keyBytes);
  };
  const idleMs = options.idleMs ?? 15 * 60_000;
  let client: SignInClient | null = null;
  let mfaState: MfaState | null = null;
  let finished = false;
  let isClosed = false;
  let idle: NodeJS.Timeout | undefined;
  let port = 0; // cached: server.address() is null once the server has closed
  // Sign-in steps run one at a time, so a double submit cannot sign in (and reset the session) twice.
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(step: () => Promise<T>): Promise<T> => {
    const run = queue.then(step);
    queue = run.catch(() => {});
    return run;
  };

  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => (resolveClosed = r));

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, HEADERS);
      res.end(html("Error", "<h1>Something went wrong</h1><p>Close this tab and ask Claude to sign in again.</p>"));
    });
  });

  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= new Promise<void>((resolve) => {
      isClosed = true;
      clearTimeout(idle);
      server.close(() => resolve());
      // Node >= 18.2; drops idle keep-alive sockets and any request still in flight.
      server.closeAllConnections?.();
    }).then(resolveClosed));

  const touch = () => {
    if (isClosed) return;
    clearTimeout(idle);
    idle = setTimeout(() => void close(), idleMs);
    idle.unref();
  };

  /** Once signed in, the page shuts down after this response, even if the browser already dropped it. */
  const closeAfter = (res: http.ServerResponse) => {
    if (res.destroyed || res.writableFinished) void close();
    else res.once("close", () => void close());
  };
  const sendDone = (res: http.ServerResponse, name = "your Garmin account") => {
    closeAfter(res);
    if (res.destroyed) return;
    res.writeHead(200, HEADERS);
    res.end(donePage(name));
  };

  const notFound = (res: http.ServerResponse) => {
    res.writeHead(404, { "cache-control": "no-store" });
    res.end();
  };

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const path = req.url ?? "";
    if (req.headers.host !== `127.0.0.1:${port}` || !path.startsWith("/") || !isKey(path.slice(1))) return notFound(res);
    touch();
    const send = (body: string) => {
      res.writeHead(200, HEADERS);
      res.end(body);
    };
    if (finished) return sendDone(res);
    if (req.method === "GET") return send(mfaState ? mfaForm(key) : credentialsForm(key));
    if (req.method !== "POST") return notFound(res);

    const form = await readBody(req);
    if (!isKey(form.get("key"))) return notFound(res);
    return serialized(() => step(form, res, send));
  }

  async function step(form: URLSearchParams, res: http.ServerResponse, send: (body: string) => void): Promise<void> {
    // A submit that waited behind the one that signed in gets the done page, not a second sign-in.
    if (finished) return sendDone(res);
    // The browser gave up while this submit waited, or the page closed: do not sign in behind its back.
    if (res.destroyed) return;
    if (isClosed) return notFound(res);

    if (form.get("step") === "mfa") {
      if (!client || !mfaState) return send(credentialsForm(key, "Please sign in again."));
      const code = (form.get("code") ?? "").replace(/\s+/g, "");
      try {
        await client.resumeLogin(mfaState, code);
      } catch (e) {
        return send(mfaForm(key, message(e)));
      }
      return finish(res, client);
    }

    const email = (form.get("email") ?? "").trim();
    const password = form.get("password") ?? "";
    // A fresh attempt abandons any MFA step still pending from an earlier one.
    client = null;
    mfaState = null;
    const attempt = options.createClient();
    let result: LoginResult;
    try {
      result = await attempt.login(email, password);
    } catch (e) {
      return send(credentialsForm(key, message(e), email));
    }
    client = attempt;
    if (result.state === "mfa_required") {
      mfaState = result.mfaState;
      return send(mfaForm(key));
    }
    return finish(res, attempt);
  }

  async function finish(res: http.ServerResponse, signedIn: SignInClient): Promise<void> {
    finished = true;
    mfaState = null;
    options.onSignedIn();
    const name = await signedIn.displayName().catch(() => "your Garmin account");
    // The browser may have dropped this request mid-login (a cancelled double click, a closed tab);
    // sendDone closes the page either way.
    sendDone(res, name);
  }

  let onListenError: (e: Error) => void = () => {};
  await new Promise<void>((resolve, reject) => {
    onListenError = reject;
    server.once("error", onListenError);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  server.off("error", onListenError);
  // A later server error must not crash the MCP process (an unhandled "error" would) or print anything.
  server.on("error", () => void close());
  // An open sign-in page must never be the reason the MCP process stays alive; the idle timer
  // (also unref'd) closes it anyway.
  server.unref();
  port = (server.address() as AddressInfo).port;
  touch();
  return { url: `http://127.0.0.1:${port}/${key}`, closed, close };
}
