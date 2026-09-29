# garminconnect-mcp Desktop Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Garmin MCP server as a double-click Claude Desktop Extension (`.mcpb`) with an icon, settings, and a terminal-free sign-in page.

**Architecture:** A second, fully self-contained tsup build of the existing server is packed with a generated manifest and a rasterized icon by Anthropic's `mcpb` CLI. A new `sign_in_to_garmin` tool starts a localhost-only sign-in page (random port, one-time key, Host check, CSP) that runs the library's `login`/`resumeLogin` and resets the running session. CI attaches the `.mcpb` to the GitHub Release.

**Tech Stack:** TypeScript, tsup/esbuild, `node:http`, vitest, `@modelcontextprotocol/sdk` 1.30.x, `@anthropic-ai/mcpb` ^2.1.2 (dev), `@resvg/resvg-js` ^2.6.2 (dev).

**Spec:** `docs/superpowers/specs/2026-09-29-desktop-extension-design.md`

## Global Constraints

- `garminconnect-js` keeps `"dependencies": {}`; `mcp/package.json` runtime deps stay exactly `@modelcontextprotocol/sdk` and `ajv` (tests/mcp-package.test.ts). New packages are **devDependencies of `mcp/` only**.
- The npm build (`mcp/dist/cli.js`) is unchanged in behaviour: SDK/ajv stay external there.
- The server writes nothing to stdout except MCP frames. The sign-in page and the browser opener must not write to stdout either.
- The password is never logged, stored, echoed in HTML, or returned in a tool result.
- Sign-in page: bind `127.0.0.1`, port 0, 32-byte base64url key in the path, exact `Host: 127.0.0.1:<port>` check, key re-checked in POST bodies, 404 with empty body otherwise, CSP `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'`, `Cache-Control: no-store`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, 15-minute idle shutdown, one instance at a time.
- Manifest `manifest_version: "0.4"`; `version` comes from `mcp/package.json`.
- `mcp/src` imports the library only as `garminconnect-js`, `/exercises`, `/manifest`; stays flat.
- Commit on `main` and push after each task. Do NOT tag, publish, or create a GitHub Release.

## Review Focus

1. **Unsubstituted settings**: Claude Desktop may pass `"${user_config.groups}"` literally when a setting is empty; the server must treat that as unset, not fail with "Unknown GARMIN_MCP_GROUPS value". (Task 1)
2. **A second browser tab / double submit**: submitting the credentials form twice, or reloading the done page, must not crash the server or leak state. (Task 2)
3. **MFA code with spaces** (`"123 456"`) should work — strip whitespace. (Task 2)
4. **The bundled server run from an empty folder** — no `node_modules`, no `../package.json` — must start and list tools. (Task 4)
5. **Expired session, not just missing**: `sign_in_to_garmin` must treat a session whose profile call fails with an auth error as "not signed in" and open the page. (Task 3)

---

### Task 1: Config hardening, build-time version, exported icon SVG

**Files:**
- Modify: `mcp/src/session.ts` (`loadConfig`), `mcp/src/icon.ts`, `mcp/src/cli.ts`, `mcp/tsup.config.ts`
- Create: `mcp/src/globals.d.ts`
- Modify: `mcp/tests/session.test.ts`

**Interfaces:**
- Produces: `SERVER_ICON_SVG: string` exported from `mcp/src/icon.ts`; build-time constant `__MCP_VERSION__` (declared in `globals.d.ts`, defined by tsup); `loadConfig` semantics below.

- [ ] **Step 1: Failing tests** — append to `describe("loadConfig", …)` in `mcp/tests/session.test.ts`:

```ts
  it("treats empty and unsubstituted extension settings as unset", () => {
    // Claude Desktop extensions pass settings as env strings; an unset optional setting may arrive
    // as "" or, depending on the client, as the literal template.
    const c = loadConfig({
      GARMIN_MCP_GROUPS: "${user_config.groups}",
      GARMIN_MCP_DOWNLOAD_DIR: "",
      GARMIN_MCP_TOKEN_DIR: "  ",
      GARMIN_MCP_ENABLE_GRAPHQL: "${user_config.enable_graphql}",
    });
    expect(c.groups).toBeNull();
    expect(c.downloadDir).toBe(path.join(os.homedir(), "Downloads", "garmin"));
    expect(c.tokenDir).toBe(path.join(os.homedir(), ".garminconnect-mcp", "tokens"));
    expect(c.enableGraphql).toBe(false);
  });

  it("accepts true as well as 1 for GraphQL (extension booleans arrive as text)", () => {
    expect(loadConfig({ GARMIN_MCP_ENABLE_GRAPHQL: "true" }).enableGraphql).toBe(true);
    expect(loadConfig({ GARMIN_MCP_ENABLE_GRAPHQL: "TRUE" }).enableGraphql).toBe(true);
    expect(loadConfig({ GARMIN_MCP_ENABLE_GRAPHQL: "false" }).enableGraphql).toBe(false);
  });
```

- [ ] **Step 2:** `npx vitest run --root mcp tests/session.test.ts` → the two new tests FAIL.

- [ ] **Step 3: Implement** — in `mcp/src/session.ts` replace the body of `loadConfig`:

```ts
/** A setting's value, or undefined when it is empty or an unsubstituted `${...}` template. */
const setting = (value: string | undefined): string | undefined => {
  const v = value?.trim();
  return v && !/^\$\{[^}]*\}$/.test(v) ? v : undefined;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  const home = os.homedir();
  const groups = (setting(env["GARMIN_MCP_GROUPS"]) ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  const graphql = (setting(env["GARMIN_MCP_ENABLE_GRAPHQL"]) ?? "").toLowerCase();
  return {
    tokenDir: setting(env["GARMIN_MCP_TOKEN_DIR"]) ?? path.join(home, ".garminconnect-mcp", "tokens"),
    downloadDir: setting(env["GARMIN_MCP_DOWNLOAD_DIR"]) ?? path.join(home, "Downloads", "garmin"),
    groups: groups.length > 0 ? new Set(groups) : null,
    enableGraphql: graphql === "1" || graphql === "true",
  };
}
```

- [ ] **Step 4:** Rerun the session tests → PASS (all, including the existing ones).

- [ ] **Step 5: Export the SVG** — in `mcp/src/icon.ts` rename `const SVG` to `export const SERVER_ICON_SVG` and use it in `SERVER_ICON` (`Buffer.from(SERVER_ICON_SVG, "utf8")`). Update the file comment: "Also rasterized to icon.png for the Desktop Extension (scripts/build-mcpb.ts)."

- [ ] **Step 6: Build-time version** — the bundled extension server has no `../package.json` beside it, so the version must be compiled in.
  - Create `mcp/src/globals.d.ts`:
    ```ts
    /** The package version, injected by tsup at build time (see tsup.config.ts). */
    declare const __MCP_VERSION__: string;
    ```
  - In `mcp/src/cli.ts` delete the `createRequire` import and the `const { version } = createRequire(...)` line; add `const version = __MCP_VERSION__;`.
  - In `mcp/tsup.config.ts`:
    ```ts
    import { readFileSync } from "node:fs";
    import { defineConfig } from "tsup";

    const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

    export default defineConfig({
      entry: { cli: "src/cli.ts" },
      format: ["esm"],
      target: "node18",
      platform: "node",
      clean: true,
      sourcemap: true,
      define: { __MCP_VERSION__: JSON.stringify(version) },
      // Inline garminconnect-js (resolved to ../src through tsconfig `paths`). The server is released in
      // lockstep with the library and must never run against a different version of it.
      noExternal: [/^garminconnect-js/],
    });
    ```

- [ ] **Step 7:** `npm run check` → PASS. Then `node mcp/dist/cli.js --help; echo $?` → usage mentions the current version, exit 2.

- [ ] **Step 8: Commit** — `fix(mcp): treat empty or unsubstituted settings as unset; compile the version in` (+ Co-Authored-By trailer), push.

---

### Task 2: The localhost sign-in page

**Files:**
- Create: `mcp/src/signin-page.ts`, `mcp/tests/signin-page.test.ts`

**Interfaces:**
- Consumes: `LoginResult`, `MfaState` types from `garminconnect-js`.
- Produces:
  ```ts
  export interface SignInClient {
    login(email: string, password: string): Promise<LoginResult>;
    resumeLogin(mfaState: MfaState, code: string): Promise<void>;
    displayName(): Promise<string>;
  }
  export interface SignInPageOptions {
    createClient: () => SignInClient; // one per sign-in attempt; its token store saves the session
    onSignedIn: () => void;           // e.g. session.reset()
    idleMs?: number;                  // default 15 * 60_000
  }
  export interface SignInPage { readonly url: string; readonly closed: Promise<void>; close(): Promise<void> }
  export function startSignInPage(options: SignInPageOptions): Promise<SignInPage>;
  ```

- [ ] **Step 1: Failing tests** — `mcp/tests/signin-page.test.ts`:

```ts
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { GarminAuthError, type LoginResult, type MfaState } from "garminconnect-js";
import { startSignInPage, type SignInClient, type SignInPage } from "../src/signin-page.js";

const PASSWORD = "correct horse battery staple";

/** Raw HTTP so the Host header can be set (fetch forbids it). */
function request(url: string, opts: { method?: string; body?: Record<string, string>; host?: string } = {}) {
  const u = new URL(url);
  const body = opts.body ? new URLSearchParams(opts.body).toString() : undefined;
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request(
      {
        host: u.hostname, port: u.port, path: u.pathname, method: opts.method ?? (body ? "POST" : "GET"),
        headers: {
          host: opts.host ?? u.host,
          ...(body && { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) }),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function fakeClient(mode: "ok" | "mfa" | "bad", calls: string[] = []): SignInClient {
  return {
    async login(email, password) {
      calls.push(`login:${email}`);
      if (mode === "bad" || password !== PASSWORD) throw new GarminAuthError("SSO error: INVALID_CREDENTIALS");
      return mode === "mfa"
        ? ({ state: "mfa_required", mfaState: { flow: "mobile" } as unknown as MfaState } as LoginResult)
        : ({ state: "success" } as LoginResult);
    },
    async resumeLogin(_state, code) {
      calls.push(`mfa:${code}`);
      if (code !== "123456") throw new GarminAuthError("SSO error: INVALID_MFA_CODE");
    },
    async displayName() {
      return "runner42";
    },
  };
}

const keyOf = (url: string) => new URL(url).pathname.slice(1);
let page: SignInPage | undefined;
afterEach(async () => {
  await page?.close();
  page = undefined;
});

describe("sign-in page", () => {
  it("serves the form only on 127.0.0.1 with the right key and Host", async () => {
    page = await startSignInPage({ createClient: () => fakeClient("ok"), onSignedIn: () => {} });
    const url = new URL(page.url);
    expect(url.hostname).toBe("127.0.0.1");
    expect(keyOf(page.url)).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const ok = await request(page.url);
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('name="password"');
    expect(ok.headers["content-security-policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(ok.headers["x-frame-options"]).toBe("DENY");

    expect((await request(`${url.origin}/wrong-key`)).status).toBe(404);
    expect((await request(`${url.origin}/`)).status).toBe(404);
    expect((await request(page.url, { host: "evil.test" })).status).toBe(404);
    expect((await request(page.url, { host: `localhost:${url.port}` })).status).toBe(404);
  });

  it("rejects a POST whose form key does not match", async () => {
    page = await startSignInPage({ createClient: () => fakeClient("ok"), onSignedIn: () => {} });
    const res = await request(page.url, { body: { key: "nope", step: "credentials", email: "a@b.c", password: PASSWORD } });
    expect(res.status).toBe(404);
  });

  it("signs in without MFA, resets the session, and shuts down", async () => {
    let resets = 0;
    const calls: string[] = [];
    page = await startSignInPage({ createClient: () => fakeClient("ok", calls), onSignedIn: () => resets++ });
    const res = await request(page.url, { body: { key: keyOf(page.url), step: "credentials", email: "a@b.c", password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(res.body).toContain("Signed in as runner42");
    expect(res.body).not.toContain(PASSWORD);
    expect(resets).toBe(1);
    expect(calls).toEqual(["login:a@b.c"]);
    await page.closed; // resolves once the server has closed
  });

  it("asks for the MFA code, accepts one with spaces, then finishes", async () => {
    let resets = 0;
    const calls: string[] = [];
    page = await startSignInPage({ createClient: () => fakeClient("mfa", calls), onSignedIn: () => resets++ });
    const key = keyOf(page.url);
    const step1 = await request(page.url, { body: { key, step: "credentials", email: "a@b.c", password: PASSWORD } });
    expect(step1.body).toContain('name="code"');
    expect(step1.body).not.toContain(PASSWORD);
    expect(resets).toBe(0);

    const wrong = await request(page.url, { body: { key, step: "mfa", code: "000000" } });
    expect(wrong.body).toContain("INVALID_MFA_CODE");
    expect(wrong.body).toContain('name="code"');

    const done = await request(page.url, { body: { key, step: "mfa", code: "123 456" } });
    expect(done.body).toContain("Signed in as runner42");
    expect(calls).toEqual(["login:a@b.c", "mfa:000000", "mfa:123456"]);
    expect(resets).toBe(1);
    await page.closed;
  });

  it("shows Garmin's error on a wrong password and never echoes the password", async () => {
    page = await startSignInPage({ createClient: () => fakeClient("bad"), onSignedIn: () => {} });
    const res = await request(page.url, { body: { key: keyOf(page.url), step: "credentials", email: "a@b.c", password: "hunter2<script>" } });
    expect(res.status).toBe(200);
    expect(res.body).toContain("INVALID_CREDENTIALS");
    expect(res.body).toContain('name="password"');
    expect(res.body).not.toContain("hunter2");
    expect(res.body).toContain('value="a@b.c"'); // email is kept, escaped
  });

  it("an MFA post without a pending login starts over instead of crashing", async () => {
    page = await startSignInPage({ createClient: () => fakeClient("mfa"), onSignedIn: () => {} });
    const res = await request(page.url, { body: { key: keyOf(page.url), step: "mfa", code: "123456" } });
    expect(res.status).toBe(200);
    expect(res.body).toContain('name="password"');
  });

  it("closes itself after the idle time", async () => {
    page = await startSignInPage({ createClient: () => fakeClient("ok"), onSignedIn: () => {}, idleMs: 50 });
    await page.closed;
    await expect(request(page.url)).rejects.toThrow();
  });
});
```

- [ ] **Step 2:** `npx vitest run --root mcp tests/signin-page.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `mcp/src/signin-page.ts`:

```ts
/**
 * A one-off Garmin sign-in page served on this computer only, so a Desktop Extension user can sign
 * in (including MFA) without a terminal. The password goes from the browser straight to the
 * library's `login`; it is never stored, logged, echoed, or shown to Claude.
 *
 * Only 127.0.0.1, a random port, and a random one-time key in the URL; the exact Host is checked
 * (DNS rebinding) and the key is re-checked in every POST (other sites cannot submit to it).
 */
import { randomBytes } from "node:crypto";
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

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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
  });
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function startSignInPage(options: SignInPageOptions): Promise<SignInPage> {
  const key = randomBytes(32).toString("base64url");
  const idleMs = options.idleMs ?? 15 * 60_000;
  let client: SignInClient | null = null;
  let mfaState: MfaState | null = null;
  let finished = false;
  let idle: NodeJS.Timeout | undefined;

  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => (resolveClosed = r));

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, HEADERS);
      res.end(html("Error", "<h1>Something went wrong</h1><p>Close this tab and ask Claude to sign in again.</p>"));
    });
  });

  const close = () =>
    new Promise<void>((resolve) => {
      clearTimeout(idle);
      server.closeAllConnections?.();
      server.close(() => resolve());
    }).then(resolveClosed);

  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => void close(), idleMs);
    idle.unref();
  };

  const notFound = (res: http.ServerResponse) => {
    res.writeHead(404, { "cache-control": "no-store" });
    res.end();
  };

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const { port } = server.address() as AddressInfo;
    if (req.headers.host !== `127.0.0.1:${port}` || req.url !== `/${key}`) return notFound(res);
    touch();
    const send = (body: string) => {
      res.writeHead(200, HEADERS);
      res.end(body);
    };
    if (finished) return send(donePage("your Garmin account"));
    if (req.method === "GET") return send(mfaState ? mfaForm(key) : credentialsForm(key));
    if (req.method !== "POST") return notFound(res);

    const form = await readBody(req);
    if (form.get("key") !== key) return notFound(res);

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
    res.writeHead(200, HEADERS);
    res.end(donePage(name), () => void close());
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  touch();
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/${key}`, closed, close };
}
```

Notes for the implementer: `server.closeAllConnections` exists on Node ≥ 18.2 — keep the optional call. If lint flags the `escape` lookup's non-null assertion, keep the map but type it as `Record<string, string>`.

- [ ] **Step 4:** Run the tests → PASS. Then `npm run check` → PASS.

- [ ] **Step 5: Commit** — `feat(mcp): a localhost-only Garmin sign-in page`, push.

---

### Task 3: The `sign_in_to_garmin` tool

**Files:**
- Create: `mcp/src/signin-tool.ts`, `mcp/tests/signin-tool.test.ts`
- Modify: `mcp/src/errors.ts` (`LOGIN_HINT`), `mcp/src/tools.ts`, `mcp/tests/server.test.ts`, `mcp/tests/workout-tools.test.ts` (tool count)

**Interfaces:**
- Consumes: `startSignInPage`, `SignInClient` (Task 2); `ToolFactory`, `ServerDeps` (server.ts); `textResult`.
- Produces: `signInTools(options?: { openUrl?: (url: string) => void; createClient?: (tokenDir: string) => SignInClient; idleMs?: number }): ToolFactory`, `openInBrowser(url: string): void`, and `LOGIN_HINT` = "call the `sign_in_to_garmin` tool to sign in (or run `garminconnect-mcp login` in a terminal), then try again".

- [ ] **Step 1: Failing tests** — `mcp/tests/signin-tool.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Garmin, GarminAuthError, GarminClient } from "garminconnect-js";
import { signInTools } from "../src/signin-tool.js";
import type { Session } from "../src/session.js";
import { NotLoggedInError } from "../src/session.js";
import { connect, fakeFetch, PROFILE_ROUTE, sessionFor, testConfig, textOf } from "./helpers.js";

const neverSignedIn: Session & { resets: number } = {
  resets: 0,
  get: async () => {
    throw new NotLoggedInError("No saved Garmin login");
  },
  reset() {
    neverSignedIn.resets++;
  },
};

const unusedClient = () => ({
  login: async () => {
    throw new Error("not used");
  },
  resumeLogin: async () => {},
  displayName: async () => "x",
});

describe("sign_in_to_garmin", () => {
  it("says who is signed in and opens nothing when a session works", async () => {
    const opened: string[] = [];
    const { fetchImpl } = fakeFetch(PROFILE_ROUTE);
    const client = await connect({ config: testConfig(), session: sessionFor(fetchImpl) }, [
      signInTools({ openUrl: (u) => opened.push(u), createClient: unusedClient }),
    ]);
    const text = textOf(await client.callTool({ name: "sign_in_to_garmin", arguments: {} }));
    expect(text).toBe("Already signed in to Garmin as abc-display.");
    expect(opened).toEqual([]);
  });

  it("opens the sign-in page when there is no session, and reuses it on a second call", async () => {
    const opened: string[] = [];
    const client = await connect({ config: testConfig(), session: neverSignedIn }, [
      signInTools({ openUrl: (u) => opened.push(u), createClient: unusedClient, idleMs: 5_000 }),
    ]);
    const first = textOf(await client.callTool({ name: "sign_in_to_garmin", arguments: {} }));
    const second = textOf(await client.callTool({ name: "sign_in_to_garmin", arguments: {} }));
    expect(opened).toHaveLength(2);
    expect(opened[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}$/);
    expect(opened[1]).toBe(opened[0]);
    expect(first).toContain(opened[0]!);
    expect(first).toContain("tell me when you're done");
    expect(second).toContain(opened[0]!);
  });

  it("treats an expired session (profile call rejected) as not signed in", async () => {
    const opened: string[] = [];
    const expired: Session = {
      get: async () => {
        const g = new Garmin(new GarminClient());
        g.getUserProfile = async () => {
          throw new GarminAuthError("expired");
        };
        return g;
      },
      reset() {},
    };
    const client = await connect({ config: testConfig(), session: expired }, [
      signInTools({ openUrl: (u) => opened.push(u), createClient: unusedClient, idleMs: 5_000 }),
    ]);
    const text = textOf(await client.callTool({ name: "sign_in_to_garmin", arguments: {} }));
    expect(opened).toHaveLength(1);
    expect(text).toContain("sign-in page opened");
  });
});
```

In `mcp/tests/server.test.ts`, change the auth-error expectation to
`expect(textOf(result)).toContain("call the `sign_in_to_garmin` tool");` and in
`mcp/tests/workout-tools.test.ts` "registers every tool once" change `generated + 4` to `generated + 5`.

- [ ] **Step 2:** Run those three test files → FAIL.

- [ ] **Step 3: Implement** `mcp/src/signin-tool.ts`:

```ts
/**
 * `sign_in_to_garmin`: signs the user in without a terminal, via the localhost page in
 * signin-page.ts. Always registered; the hint in every "not logged in" error points here.
 */
import { spawn } from "node:child_process";
import { FileTokenStore, Garmin, GarminAuthError, GarminClient } from "garminconnect-js";
import { textResult } from "./results.js";
import type { ToolFactory } from "./server.js";
import { startSignInPage, type SignInClient, type SignInPage } from "./signin-page.js";

/** Opens a URL in the default browser. Output is discarded (stdout carries MCP frames). */
export function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args as string[], { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The URL is in the tool result; the user can open it by hand.
  }
}

function tokenStoreClient(tokenDir: string): SignInClient {
  const client = new GarminClient({ tokenStore: new FileTokenStore(tokenDir) });
  return {
    login: (email, password) => client.login(email, password),
    resumeLogin: (state, code) => client.resumeLogin(state, code),
    displayName: async () => (await new Garmin(client).getUserProfile()).displayName,
  };
}

export interface SignInToolOptions {
  openUrl?: (url: string) => void;
  createClient?: (tokenDir: string) => SignInClient;
  idleMs?: number;
}

export function signInTools(options: SignInToolOptions = {}): ToolFactory {
  const openUrl = options.openUrl ?? openInBrowser;
  const createClient = options.createClient ?? tokenStoreClient;
  let page: SignInPage | null = null;

  return ({ config, session }) => [
    {
      tool: {
        name: "sign_in_to_garmin",
        description:
          "Sign in to Garmin Connect. Call this when another Garmin tool says you are not logged in or the session " +
          "expired. It opens a sign-in page in the user's browser; the password and MFA code are entered there, never " +
          "in the chat. Afterwards, ask the user to tell you when they have finished, then retry.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { title: "Sign in to Garmin", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      async run() {
        try {
          const profile = await (await session.get()).getUserProfile();
          return textResult(`Already signed in to Garmin as ${profile.displayName}.`);
        } catch (error) {
          if (!(error instanceof GarminAuthError)) throw error;
        }
        if (!page) {
          const started = await startSignInPage({
            createClient: () => createClient(config.tokenDir),
            onSignedIn: () => session.reset(),
            idleMs: options.idleMs,
          });
          page = started;
          void started.closed.then(() => {
            if (page === started) page = null;
          });
        }
        openUrl(page.url);
        return textResult(
          `A Garmin sign-in page opened in your browser: ${page.url}\n` +
            "Sign in there (including any MFA code), then tell me when you're done.",
        );
      },
    },
  ];
}
```

`mcp/src/errors.ts`:
```ts
export const LOGIN_HINT =
  "call the `sign_in_to_garmin` tool to sign in (or run `garminconnect-mcp login` in a terminal), then try again";
```

`mcp/src/tools.ts`:
```ts
import { methodTools } from "./method-tools.js";
import type { ToolFactory } from "./server.js";
import { signInTools } from "./signin-tool.js";
import { workoutTools } from "./workout-tools.js";

/** Every tool the server exposes, in listing order: sign-in and the workout tools first. */
export const TOOL_FACTORIES: readonly ToolFactory[] = [signInTools(), workoutTools, methodTools];
```

- [ ] **Step 4:** Tests → PASS; `npm run check` → PASS. Check `mcp/tests/errors.test.ts` still passes (it uses the `LOGIN_HINT` constant).

- [ ] **Step 5: Commit** — `feat(mcp): sign_in_to_garmin opens the local sign-in page`, push.

---

### Task 4: Build and validate the `.mcpb`

**Files:**
- Create: `mcp/extension/manifest.template.json`, `mcp/scripts/build-mcpb.ts`, `mcp/tests/mcpb.test.ts`
- Modify: `mcp/tsup.config.ts` (second build), `mcp/package.json` (devDeps, scripts), `.gitignore`

**Interfaces:**
- Consumes: `SERVER_ICON_SVG` (Task 1), `__MCP_VERSION__` define (Task 1).
- Produces: `npm run build:mcpb -w mcp` → `mcp/dist-mcpb/stage/{manifest.json,icon.png,server/index.js}` and `mcp/dist-mcpb/garminconnect-mcp-<version>.mcpb`.

- [ ] **Step 1: Dev dependencies** — `npm install --save-dev @anthropic-ai/mcpb@^2.1.2 @resvg/resvg-js@^2.6.2 -w mcp`. Confirm root `package.json` still has `"dependencies": {}` and `mcp/package.json` `dependencies` is unchanged.

- [ ] **Step 2: Self-contained second build** — `mcp/tsup.config.ts` exports an array; the first entry is Task 1's config unchanged, the second:

```ts
  {
    // The Desktop Extension's server: EVERYTHING inlined (SDK, ajv, the library) so it runs from an
    // extension folder with no node_modules. The npm build above keeps SDK/ajv external.
    entry: { index: "src/cli.ts" },
    outDir: "dist-bundle",
    format: ["esm"],
    target: "node18",
    platform: "node",
    clean: true,
    sourcemap: false,
    define: { __MCP_VERSION__: JSON.stringify(version) },
    noExternal: [/.*/],
    // CommonJS dependencies (ajv) call require(); give the ESM bundle one.
    banner: { js: "import { createRequire as __gcCreateRequire } from 'node:module'; const require = __gcCreateRequire(import.meta.url);" },
  },
```

If `node mcp/dist-bundle/index.js --help` fails with a SyntaxError at `#!`, the hashbang ended up after the banner: strip the hashbang from this build with an esbuild plugin or `onSuccess` rewrite, and note it in the report.

- [ ] **Step 3: Manifest template** — `mcp/extension/manifest.template.json` (`version`/`description` are overwritten by the build):

```json
{
  "manifest_version": "0.4",
  "name": "garminconnect-mcp",
  "display_name": "Garmin Connect (unofficial)",
  "version": "0.0.0",
  "description": "",
  "long_description": "Talk to Claude to build Garmin workouts (running, cycling, swimming, strength, HIIT and more), schedule them and send them to your watch, and to read your sleep, HRV, stress, training readiness, activities and the rest of your Garmin Connect data.\n\nSign in once through a page that opens in your browser; your password goes only to Garmin. Everything runs on your computer.\n\nUnofficial: not made by, or affiliated with, Garmin.",
  "author": { "name": "ificko", "url": "https://github.com/DynamicsNinja" },
  "homepage": "https://github.com/DynamicsNinja/garminconnect-js/tree/main/mcp#readme",
  "repository": { "type": "git", "url": "https://github.com/DynamicsNinja/garminconnect-js" },
  "support": "https://github.com/DynamicsNinja/garminconnect-js/issues",
  "icon": "icon.png",
  "license": "MIT",
  "keywords": ["garmin", "garmin-connect", "workouts", "fitness", "running", "training"],
  "server": {
    "type": "node",
    "entry_point": "server/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/index.js"],
      "env": {
        "GARMIN_MCP_GROUPS": "${user_config.groups}",
        "GARMIN_MCP_DOWNLOAD_DIR": "${user_config.download_dir}",
        "GARMIN_MCP_ENABLE_GRAPHQL": "${user_config.enable_graphql}"
      }
    }
  },
  "user_config": {
    "groups": {
      "type": "string",
      "title": "Tool groups",
      "description": "Optional. Comma-separated groups to load, e.g. workouts,metrics,wellness,activities. Empty loads everything. Fewer groups use less of Claude's context.",
      "required": false,
      "default": ""
    },
    "download_dir": {
      "type": "directory",
      "title": "Download folder",
      "description": "Optional. Where downloaded activity and workout files are saved. Empty uses Downloads/garmin.",
      "required": false
    },
    "enable_graphql": {
      "type": "boolean",
      "title": "Raw GraphQL tool",
      "description": "Expose the unrestricted Garmin GraphQL tool. Off unless you need it.",
      "required": false,
      "default": false
    }
  },
  "tools": [
    { "name": "sign_in_to_garmin", "description": "Sign in to Garmin Connect through a page in your browser." },
    { "name": "preview_workout", "description": "Show a workout in readable form without saving it." },
    { "name": "create_workout", "description": "Save a workout to your Garmin workout library." },
    { "name": "update_workout", "description": "Replace an existing workout." },
    { "name": "search_exercises", "description": "Find Garmin exercise names for strength and HIIT steps." }
  ],
  "tools_generated": true,
  "compatibility": {
    "platforms": ["darwin", "win32", "linux"],
    "runtimes": { "node": ">=18.0.0" }
  },
  "privacy_policies": ["https://github.com/DynamicsNinja/garminconnect-js/blob/main/mcp/PRIVACY.md"]
}
```

If `mcpb validate` rejects a field (e.g. `support`), remove that field and say so in the report — do not loosen validation.

- [ ] **Step 4: Build script** — `mcp/scripts/build-mcpb.ts`:

```ts
/**
 * Builds the Claude Desktop Extension: stages manifest.json, icon.png and server/index.js, validates
 * the manifest, and packs garminconnect-mcp-<version>.mcpb with Anthropic's mcpb CLI.
 *
 *   npm run build:mcpb -w mcp   (after `npm run build -w mcp`, which produces dist-bundle/)
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { SERVER_ICON_SVG } from "../src/icon.js";

const MCP = fileURLToPath(new URL("..", import.meta.url));
const OUT = path.join(MCP, "dist-mcpb");
const STAGE = path.join(OUT, "stage");
const pkg = JSON.parse(readFileSync(path.join(MCP, "package.json"), "utf8")) as { version: string; description: string };

/** The mcpb CLI entry, found by walking up to the nearest node_modules (workspaces hoist it). */
function mcpbCli(): string {
  for (let dir = MCP; ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, "node_modules", "@anthropic-ai", "mcpb", "package.json");
    if (existsSync(manifest)) {
      const bin = (JSON.parse(readFileSync(manifest, "utf8")) as { bin: Record<string, string> }).bin["mcpb"]!;
      return path.join(path.dirname(manifest), bin);
    }
    if (path.dirname(dir) === dir) throw new Error("@anthropic-ai/mcpb is not installed");
  }
}

const bundle = path.join(MCP, "dist-bundle", "index.js");
if (!existsSync(bundle)) throw new Error("dist-bundle/index.js is missing: run `npm run build -w mcp` first");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(STAGE, "server"), { recursive: true });
cpSync(bundle, path.join(STAGE, "server", "index.js"));
writeFileSync(path.join(STAGE, "icon.png"), new Resvg(SERVER_ICON_SVG, { fitTo: { mode: "width", value: 512 } }).render().asPng());

const template = JSON.parse(readFileSync(path.join(MCP, "extension", "manifest.template.json"), "utf8")) as Record<string, unknown>;
const manifest = { ...template, version: pkg.version, description: pkg.description };
writeFileSync(path.join(STAGE, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const cli = mcpbCli();
execFileSync(process.execPath, [cli, "validate", path.join(STAGE, "manifest.json")], { stdio: "inherit" });
const file = path.join(OUT, `garminconnect-mcp-${pkg.version}.mcpb`);
execFileSync(process.execPath, [cli, "pack", STAGE, file], { stdio: "inherit" });
console.log(`Built ${path.relative(process.cwd(), file)}`);
```

If `mcpb pack`'s argument order differs in 2.1.x (`mcpb pack --help`), adapt and note it.

- [ ] **Step 5: Scripts and ignores** — `mcp/package.json` scripts:
  `"build:mcpb": "tsx scripts/build-mcpb.ts"`,
  `"check": "npm run typecheck && npm run build && npm run build:mcpb && npm test"`.
  `.gitignore`: add `mcp/dist-bundle/` and `mcp/dist-mcpb/`.

- [ ] **Step 6: Tests** — `mcp/tests/mcpb.test.ts`:

```ts
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

// `npm run check -w mcp` builds the extension before testing; a bare vitest run skips instead.
const OUT = new URL("../dist-mcpb/", import.meta.url);
const STAGE = new URL("stage/", OUT);
const built = existsSync(STAGE);
const describeBuilt = built ? describe : describe.skip;

describeBuilt("Desktop Extension (.mcpb)", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

  it("stages exactly the manifest, the icon and the bundled server", () => {
    const list = (dir: string, prefix = ""): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? list(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
      );
    expect(list(STAGE.pathname.replace(/^\/([A-Za-z]:)/, "$1")).sort()).toEqual(["icon.png", "manifest.json", "server/index.js"]);
  });

  it("has a manifest whose version matches the package, and a real PNG icon", () => {
    const manifest = JSON.parse(readFileSync(new URL("manifest.json", STAGE), "utf8")) as Record<string, unknown>;
    expect(manifest["version"]).toBe(pkg.version);
    expect(manifest["manifest_version"]).toBe("0.4");
    const png = readFileSync(new URL("icon.png", STAGE));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("packs a zip named for the version", () => {
    const file = new URL(`garminconnect-mcp-${pkg.version}.mcpb`, OUT);
    expect(readFileSync(file).subarray(0, 2).toString()).toBe("PK");
  });

  it("runs from an empty folder with no node_modules and lists its tools", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gc-mcpb-"));
    const tokens = mkdtempSync(path.join(os.tmpdir(), "gc-mcpb-tokens-"));
    try {
      cpSync(new URL("server/index.js", STAGE), path.join(dir, "index.js"));
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(dir, "index.js")],
        env: { ...(process.env as Record<string, string>), GARMIN_MCP_TOKEN_DIR: tokens, GARMIN_MCP_GROUPS: "${user_config.groups}" },
      });
      const client = new Client({ name: "mcpb-test", version: "0" });
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(client.getServerVersion()?.version).toBe(pkg.version);
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["sign_in_to_garmin", "create_workout", "get_sleep_data"]));
      await client.close();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      rmSync(tokens, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 60_000);
});
```

(If the `pathname` conversion is awkward on Windows, use `fileURLToPath(STAGE)` instead.)

- [ ] **Step 7:** `npm run check` (root; runs `check -w mcp`, which now builds and validates the `.mcpb`) → PASS, including the four mcpb tests (not skipped). Report the `.mcpb` size.

- [ ] **Step 8: Commit** — `feat(mcp): build the Claude Desktop Extension (.mcpb)`, push.

---

### Task 5: Docs, privacy note, release workflow, and the manual install check

**Files:**
- Create: `mcp/PRIVACY.md`
- Modify: `mcp/README.md`, `AGENTS.md` (§9), `CHANGELOG.md` (Unreleased), `.github/workflows/publish.yml`

- [ ] **Step 1: `mcp/PRIVACY.md`**

```markdown
# Privacy — garminconnect-mcp

This extension/server runs entirely on your computer.

- **What it sends, and where:** only requests to Garmin Connect (`connectapi.garmin.com`,
  `sso.garmin.com`, `connect.garmin.com`), to read or change your Garmin data when you ask Claude
  to. Nothing is sent anywhere else. There is no analytics or telemetry.
- **Your password:** typed only into the local sign-in page (served on `127.0.0.1`) or the
  `garminconnect-mcp login` terminal prompt, and sent only to Garmin's sign-in service. It is never
  stored, logged, or shown to Claude.
- **What it stores:** your Garmin session tokens in a folder on this computer
  (`~/.garminconnect-mcp/tokens` by default), and files you ask it to download (default
  `~/Downloads/garmin`). Delete the token folder to sign out.
- **What Claude sees:** the results of the tools Claude calls — for example your sleep data when you
  ask about sleep. How Claude handles conversation data is covered by Anthropic's privacy policy.

Unofficial: not made by, or affiliated with, Garmin. Garmin's own privacy policy applies to the data
Garmin holds: https://www.garmin.com/privacy/
```

- [ ] **Step 2: README** — in `mcp/README.md`, make "Set up" start with:

```markdown
## Set up

### Easiest: the Claude Desktop Extension

1. Download `garminconnect-mcp-<version>.mcpb` from the
   [latest release](https://github.com/DynamicsNinja/garminconnect-js/releases/latest).
2. Double-click it (or drag it onto Claude Desktop's Settings → Extensions) and choose **Install**.
3. Ask Claude something about your Garmin data. The first time, Claude opens a Garmin sign-in page
   in your browser; sign in there (with your MFA code if you use one) and tell Claude you're done.

Optional settings (tool groups, download folder) are under Settings → Extensions → Garmin Connect.
```

Rename the existing numbered npm steps to "### Other ways to install: npm", keeping their content, and
add to "Troubleshooting": "**Sign-in page didn't open**: Claude's reply includes the link; open it in
any browser on this computer. It expires after 15 minutes — ask Claude to sign in again."
Add `sign_in_to_garmin` to "What it can do". Link `PRIVACY.md` under "Good to know".

- [ ] **Step 3: AGENTS.md §9** — add bullets: the `.mcpb` build (`npm run build:mcpb -w mcp`, self-contained `dist-bundle`, manifest from `extension/manifest.template.json` + `package.json`, icon rasterized from `SERVER_ICON_SVG`); `sign_in_to_garmin` + the localhost page and its safety rules (127.0.0.1, random key, Host check, never stores the password); `loadConfig` ignores empty/`${...}` values.

- [ ] **Step 4: CHANGELOG** — under `## [Unreleased]`:

```markdown
### Added (`@dynamicsninja/garminconnect-mcp`)

- **A Claude Desktop Extension** (`garminconnect-mcp-<version>.mcpb`, attached to each GitHub
  Release): double-click to install, with an icon and settings for tool groups, download folder and
  GraphQL. Nothing else to install.
- **`sign_in_to_garmin`**: signs in without a terminal through a page served only on this computer
  (supports MFA; the password goes only to Garmin and is never stored). The "not logged in" message
  now points to it.

### Fixed (`@dynamicsninja/garminconnect-mcp`)

- Empty or unsubstituted settings (as a Desktop Extension may pass them) are treated as unset, and
  `GARMIN_MCP_ENABLE_GRAPHQL` accepts `true` as well as `1`.
```

- [ ] **Step 5: publish.yml** — change `permissions.contents` to `write` (keep `id-token: write`), and after the "Publish mcp" step add:

```yaml
      # The Claude Desktop Extension, attached to this tag's GitHub Release.
      - name: Build Desktop Extension
        run: npm run build:mcpb -w mcp
      - name: Attach it to the GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          file="$(ls mcp/dist-mcpb/*.mcpb)"
          if gh release view "$GITHUB_REF_NAME" >/dev/null 2>&1; then
            gh release upload "$GITHUB_REF_NAME" "$file" --clobber
          else
            gh release create "$GITHUB_REF_NAME" "$file" --verify-tag --generate-notes
          fi
```

(`npm publish -w mcp` already ran `prepublishOnly` = `check`, which builds `dist-bundle`; the explicit `build:mcpb` step re-stages from it. If `dist-bundle` could be missing on that path, run `npm run build -w mcp` first.)

- [ ] **Step 6:** `npm run check` → PASS (doc-links covers the new README links). Commit `docs(mcp): Desktop Extension setup, privacy note, and release attachment`, push.

- [ ] **Step 7: Manual install check on the maintainer's Windows machine (controller does this with the user).** Open `mcp/dist-mcpb/garminconnect-mcp-<version>.mcpb` (it is in the repo after `npm run check`), ask the user to install it in Claude Desktop and disable/remove the hand-configured `garmin` entry first (two servers with the same tools would confuse Claude). Verify with the user: the icon shows; tools appear; `sign_in_to_garmin` opens the page; sign-in works; a read (e.g. sleep) works. If Claude Desktop reports it has no Node runtime for the extension, note it in the README as a requirement (Node ≥ 18) and in the changelog.
