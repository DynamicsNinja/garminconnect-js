# Hosted MCP server (`garmin.ficdev.xyz/mcp`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the existing Garmin MCP tools over streamable HTTP at `https://garmin.ficdev.xyz/mcp`, with an OAuth 2.1 authorization server so anyone can add it as a claude.ai custom connector, without the server ever storing Garmin tokens.

**Architecture:** A new `mcp/src/http/` module inside the existing `mcp` workspace. Garmin tokens travel only inside AES-GCM-sealed OAuth tokens the MCP client holds. A small SQLite grant table (`node:sqlite`, no tokens, no emails) adds single-use codes, refresh rotation with reuse detection, and revocation. Tool definitions are the same factories as the stdio server. A `FilesStrategy` swaps disk paths for inline content, and an `AsyncLocalStorage` session gives each request its own Garmin client. The whole thing is bundled into one `dist-http/http.mjs` and shipped as a Docker image that Dokploy runs behind Traefik.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` 1.30.1 (its streamable-HTTP transport plus individual OAuth handlers), Express 5 and `express-rate-limit` 8 (already installed through the SDK), `node:sqlite` (Node ≥ 22.13), `node:crypto`, vitest, tsup, Docker.

**Spec:** `docs/superpowers/specs/2026-10-07-hosted-mcp-design.md`

## Refinements to the spec (decided while planning; Task 13 writes them back into the spec)

1. **No npm bin for the hosted server.** `tests/mcp-package.test.ts` pins `mcp`'s `bin` and `dependencies`. The hosted entry is built to `mcp/dist-http/http.mjs` (everything inlined, like the extension bundle) and run only from the Docker image. Express, `express-rate-limit` and `@types/express` become **devDependencies** of `mcp`, needed at build time only.
2. **OAuth endpoints are the SDK's individual handlers mounted under `/mcp/oauth/*`.** The SDK's `mcpAuthRouter` resolves every endpoint against the domain root (`new URL("/token", base)`), so it can't put them under `/mcp`. We mount `authorizationHandler`/`tokenHandler`/`clientRegistrationHandler`/`revocationHandler` ourselves and pass our own metadata to `mcpAuthMetadataRouter`.
3. **The sealed `client_id` carries the whole registration**, including a `client_secret` when a confidential client registers. The SDK's client authentication then works with no storage.
4. **Refresh grace window:** the generation just before the current one is accepted for 60 s after a rotation, without revoking. Two racing refreshes (claude.ai web and mobile, or a client retry) must not disconnect the user.
5. **A tool-call auth error revokes the grant only for a dead Garmin session**, meaning a `GarminAuthError` whose message ends in `(401)` or says "log in again". A 403 is often Cloudflare and is transient, so it doesn't revoke. `Session.reset` gains an optional `error` to carry this.
6. **Deploys go through the Dokploy API** (`POST /api/application.deploy` with `x-api-key`), not a webhook, because the API is documented. Secrets: `DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_APPLICATION_ID`.
7. **An extra endpoint, `POST /mcp/oauth/signin`**, receives the sign-in form. `/mcp/oauth/authorize` (the SDK handler) only validates and renders it.

## Global Constraints

- `garminconnect-js` keeps **zero runtime dependencies**. The only library change is the public `GarminClient#refreshTokens()`.
- `@dynamicsninja/garminconnect-mcp`'s `bin` stays `{ "garminconnect-mcp": "dist/cli.js" }` and its `dependencies` stay exactly `@modelcontextprotocol/sdk` + `ajv` (pinned by `tests/mcp-package.test.ts`).
- The stdio server and Desktop Extension behave exactly as today. Every existing test passes unchanged.
- CI runs `npm run check` on **Node 18, 20 and 22**. Code under `mcp/src/http/` must import cleanly on Node 18, so `node:sqlite` is loaded only through `await import("node:sqlite")`, and SQLite tests `skipIf` it is unavailable. The local dev Node here is 22.11, where `node:sqlite` still needs a flag, so those tests skip locally too.
- The MCP server imports the library only as `garminconnect-js`, `/exercises`, `/manifest` (ESLint rule).
- Never log or persist: Garmin tokens, emails, passwords, Garmin payloads, OAuth tokens, query strings.
- Lifetimes and limits (verbatim from the spec):
  - access token 1 h; auth code 60 s; form/MFA state 10 min; refresh when Garmin OAuth2 expires within 2 h;
  - purge grants idle 35 days and pending grants older than 10 min;
  - sign-in 5/IP/15 min; token 30/IP/min; register 10/IP/hour; `/mcp` 120/grant/min;
  - body 15 MB on `/mcp`, 16 KB elsewhere; uploads 10 MB decoded; downloads 5 MB.
- Write scripts that touch Garmin keep the `GARMIN_TEST_PROFILE_ID` safety gate.
- Commit directly on `main` and push after each task (repo rule). Releases (tags) need the maintainer's go-ahead.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Behind Traefik, rate limits must key on the real client IP** (`X-Forwarded-For` with `trust proxy`). Otherwise one person's typos lock *everyone* out of sign-in for 15 minutes. Test in Task 10.
2. **Two refreshes racing with the same refresh token must not disconnect the user.** The 60 s grace for the previous generation covers it. Tests in Task 6 (store) and Task 9 (provider).
3. **Custom-scheme and query-carrying redirect URIs** (`cursor://…/callback`, `https://x/cb?a=1`) must survive the redirect intact, and the CSP `form-action` must allow them. Tests in Task 8 (pages) and Task 9 (provider).
4. **A redeploy, a key rotation or a restart mid-sign-in must not break an in-flight form, code or token.** Everything is sealed, so a fresh provider with the same or rotated keys must accept it. Test in Task 9.
5. **An expired form, a wrong MFA code, or an MFA code entered after the form's 10 minutes** must show a friendly page that allows a retry, never a 500. Tests in Task 9.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/client.ts` | modify | public `refreshTokens()` |
| `mcp/src/files.ts` | modify | `FilesStrategy` interface + `localFiles()` |
| `mcp/src/method-tools.ts` | modify | use `deps.files` instead of calling disk helpers directly |
| `mcp/src/server.ts` | modify | `buildTools` / `serverForTools` split; `files` in deps; reset carries the error; session login hint |
| `mcp/src/session.ts` | modify | `Session.loginHint?`, `reset({ error })` |
| `mcp/src/errors.ts` | modify | hint parameter |
| `mcp/src/tools.ts` | modify | `HOSTED_TOOL_FACTORIES` |
| `mcp/src/signin-page.ts` | modify | export `html` and `escape` for reuse |
| `mcp/src/http/inline-files.ts` | create | the hosted `FilesStrategy` |
| `mcp/src/http/seal.ts` | create | `Sealer`, `parseSealKeys` |
| `mcp/src/http/grants.ts` | create | `GrantStore`, `MemoryGrantStore`, `SqliteGrantStore`, `checkGeneration` |
| `mcp/src/http/garmin-auth.ts` | create | `GarminAuth` (login/resume/profileId/refresh) + `isDeadSession` |
| `mcp/src/http/request-session.ts` | create | per-request `Session` over `AsyncLocalStorage` |
| `mcp/src/http/pages.ts` | create | sign-in, MFA and error HTML plus headers |
| `mcp/src/http/provider.ts` | create | `HostedOAuthProvider` |
| `mcp/src/http/app.ts` | create | `createHttpApp()` Express wiring |
| `mcp/src/http/config.ts` | create | `loadHostedConfig()` |
| `mcp/src/http/main.ts` | create | process entry: serve, purge timer, `revoke` admin command |
| `mcp/tsup.config.ts` | modify | third bundle `dist-http/http.mjs` |
| `mcp/Dockerfile`, `.dockerignore` | create | image |
| `mcp/scripts/smoke-http.ts` | create | live OAuth + tools against the test account |
| `mcp/tests/http/*.test.ts`, `mcp/tests/http/fakes.ts`, `mcp/tests/http/oauth-dance.ts` | create | tests |
| `.github/workflows/ci.yml`, `publish.yml` | modify | docker job; deploy step |
| `mcp/README.md`, `mcp/PRIVACY.md`, `mcp/HOSTING.md`, `AGENTS.md`, `README.md`, spec | modify/create | docs |

---

### Task 1: Library: `GarminClient#refreshTokens()`

**Files:**
- Modify: `src/client.ts` (the `#ensureFresh` method, about lines 130-176)
- Test: `tests/client.test.ts`
- Modify: `AGENTS.md` (§3 `GarminClient` table)

**Interfaces:**
- Produces: `GarminClient#refreshTokens(options?: { withinMs?: number }): Promise<Tokens>`. It refreshes the OAuth2 token if it expires within `max(60 s, withinMs)`, persists through the `TokenStore`, shares the in-flight refresh, and throws `GarminAuthError` with no tokens.

- [ ] **Step 1: Write the failing tests.** In `tests/client.test.ts`, add inside `describe("GarminClient", …)`, after the test `"does not refresh a valid token"`:

```ts
  describe("refreshTokens", () => {
    it("returns the tokens unchanged when they are not near expiry", async () => {
      const client = new GarminClient();
      client.setTokens(tokensWith(future));
      const tokens = await client.refreshTokens();
      expect(tokens.oauth2.access_token).toBe("old-access");
      expect(exchangeCount).toBe(0);
    });

    it("refreshes a token that expires inside the window, and persists it", async () => {
      const store = new MemoryTokenStore();
      const client = new GarminClient({ tokenStore: store });
      client.setTokens(tokensWith(Math.floor(Date.now() / 1000) + 1800)); // 30 min left
      const tokens = await client.refreshTokens({ withinMs: 2 * 3600_000 });
      expect(tokens.oauth2.access_token).toBe("fresh-access");
      expect(exchangeCount).toBe(1);
      expect((await store.load())?.oauth2.access_token).toBe("fresh-access");
    });

    it("leaves a token with 30 minutes left alone at the default window", async () => {
      const client = new GarminClient();
      client.setTokens(tokensWith(Math.floor(Date.now() / 1000) + 1800));
      await client.refreshTokens();
      expect(exchangeCount).toBe(0);
    });

    it("shares one exchange with a concurrent API call", async () => {
      const client = new GarminClient();
      client.setTokens(tokensWith(past));
      await Promise.all([client.refreshTokens(), client.connectapi("/thing")]);
      expect(exchangeCount).toBe(1);
    });

    it("throws GarminAuthError when no tokens are loaded", async () => {
      await expect(new GarminClient().refreshTokens()).rejects.toThrow(GarminAuthError);
    });
  });
```

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run tests/client.test.ts -t refreshTokens`
Expected: FAIL, `client.refreshTokens is not a function`.

- [ ] **Step 3: Implement.** In `src/client.ts`, give `#ensureFresh` a margin and add the public method just above it:

```ts
  /**
   * Refreshes the OAuth2 access token now if it has expired or expires within `withinMs`
   * (never less than the 60 s every call already uses), and returns the current tokens.
   * Ordinary calls refresh on their own; this is for servers that carry tokens outside a
   * TokenStore and must capture the refreshed pair themselves. Shares an in-flight refresh.
   */
  async refreshTokens(options: { withinMs?: number } = {}): Promise<Tokens> {
    const withinSeconds = Math.max(60, Math.ceil((options.withinMs ?? 0) / 1000));
    return this.#ensureFresh(withinSeconds);
  }

  async #ensureFresh(marginSeconds = 60): Promise<Tokens> {
    const tokens = this.#tokens;
    if (!tokens) {
      throw new GarminAuthError("Not authenticated: call login() or loadTokens() first");
    }
    if (!isExpired(tokens.oauth2, marginSeconds)) return tokens;
```

(Leave the rest of `#ensureFresh` exactly as it is. Every existing caller passes no argument, so its behaviour is unchanged.)

- [ ] **Step 4: Run the tests to verify they pass.**
Run: `npx vitest run tests/client.test.ts`
Expected: PASS (every test in the file).

- [ ] **Step 5: Document it.** In `AGENTS.md` §3, add a row to the `GarminClient` table after the `getTokens` row:

```md
| `refreshTokens` | `(options?: { withinMs?: number }): Promise<Tokens>` | Refreshes the OAuth2 token if it expires within `withinMs` (min 60 s) and returns the current tokens, persisting through the `TokenStore`; shares an in-flight refresh. For servers that carry tokens outside a store (the hosted MCP server seals them into OAuth tokens). Ordinary calls never need it. |
```

- [ ] **Step 6: Full gate and commit.**
Run: `npm run typecheck; npm test`
Expected: PASS.

```bash
git add src/client.ts tests/client.test.ts AGENTS.md
git commit -m "feat: GarminClient#refreshTokens for servers that carry tokens themselves" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 2: `FilesStrategy` seam (no behaviour change)

**Files:**
- Modify: `mcp/src/files.ts`, `mcp/src/method-tools.ts`, `mcp/src/server.ts` (`ServerDeps`)
- Test: `mcp/tests/files.test.ts`, `mcp/tests/method-tools.test.ts`

**Interfaces:**
- Produces (in `mcp/src/files.ts`):

```ts
export interface FilesStrategy {
  uploadSchema(): { properties: Record<string, object>; required: string[] };
  readUpload(input: Record<string, unknown>): Promise<{ blob: Blob; filename: string }>;
  deliverDownload(baseName: string, bytes: Uint8Array): Promise<CallToolResult>;
}
export function localFiles(downloadDir: string): FilesStrategy;
```
- `ServerDeps` gains `files?: FilesStrategy`. When absent, method tools use `localFiles(deps.config.downloadDir)`.

- [ ] **Step 1: Write the failing tests.** Append to `mcp/tests/files.test.ts` (add `localFiles` to its import from `../src/files.js`):

```ts
describe("localFiles", () => {
  it("asks for an absolute filePath, exactly as before", () => {
    expect(localFiles("/tmp").uploadSchema()).toEqual({
      properties: { filePath: { type: "string", description: "Absolute path to a local .fit, .gpx or .tcx file (~ is expanded)" } },
      required: ["filePath"],
    });
  });
});
```

Append inside `describe("methodTools", …)` in `mcp/tests/method-tools.test.ts`:

```ts
  it("takes upload inputs and download delivery from the injected files strategy", async () => {
    const files = {
      uploadSchema: () => ({ properties: { content: { type: "string" } }, required: ["content"] }),
      readUpload: async () => ({ blob: new Blob(["x"]), filename: "x.gpx" }),
      deliverDownload: async (name: string) => ({ content: [{ type: "text" as const, text: `delivered ${name}` }] }),
    };
    const { fetchImpl } = fakeFetch({ "GET /download-service/files/activity/": () => new Response(new Uint8Array([1, 2])) });
    const tools = methodTools({ ...deps(fetchImpl), files });
    const upload = tools.find((t) => t.tool.name === "import_activity")!;
    expect(upload.tool.inputSchema.properties).toHaveProperty("content");
    expect(upload.tool.inputSchema.properties).not.toHaveProperty("filePath");
    const download = tools.find((t) => t.tool.name === "download_activity")!;
    expect(textOf(await download.run({ activityId: 7 }))).toBe("delivered download_activity-7");
  });
```

If the download route fragment doesn't match what `downloadActivity` requests, run the test once, read the `fakeFetch: no route for GET …` error, and use that path's fragment.

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run --root mcp tests/files.test.ts tests/method-tools.test.ts`
Expected: FAIL, `localFiles` is not exported / `files` is ignored.

- [ ] **Step 3: Implement.** Add to `mcp/src/files.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { jsonResult } from "./results.js";

/**
 * How upload tools get their file and download tools hand theirs back. The stdio server reads and
 * writes the user's disk (`localFiles`); the hosted server cannot, and moves the bytes inside the
 * MCP messages instead (`http/inline-files.ts`).
 */
export interface FilesStrategy {
  /** Input-schema properties that stand in for a method's `file`/`filename` parameters. */
  uploadSchema(): { properties: Record<string, object>; required: string[] };
  readUpload(input: Record<string, unknown>): Promise<{ blob: Blob; filename: string }>;
  deliverDownload(baseName: string, bytes: Uint8Array): Promise<CallToolResult>;
}

export function localFiles(downloadDir: string): FilesStrategy {
  return {
    uploadSchema: () => ({
      properties: {
        filePath: { type: "string", description: "Absolute path to a local .fit, .gpx or .tcx file (~ is expanded)" },
      },
      required: ["filePath"],
    }),
    readUpload: (input) => readUpload(input["filePath"]),
    deliverDownload: async (baseName, bytes) => jsonResult(await saveDownload(downloadDir, baseName, bytes)),
  };
}
```

In `mcp/src/server.ts`, add to `ServerDeps` (and `import type { FilesStrategy } from "./files.js";`):

```ts
  /** Where upload/download tools get and put files; the stdio default is the local disk. */
  files?: FilesStrategy;
```

In `mcp/src/method-tools.ts`:
- Change the import to `import { localFiles, type FilesStrategy } from "./files.js";`.
- In `inputSchemaOf(m: ManifestMethod, files: FilesStrategy)`, replace the `role === "file"` block body with:

```ts
    if (p.role === "file") {
      const upload = files.uploadSchema();
      Object.assign(properties, upload.properties);
      required.push(...upload.required);
      continue;
    }
```
- In `argsFor(m, input, files: FilesStrategy)`, replace `await readUpload(input["filePath"])` with `await files.readUpload(input)`.
- In `toolFor`, add `const files = deps.files ?? localFiles(deps.config.downloadDir);` at the top. Pass `files` to `inputSchemaOf` and `argsFor`, and replace the binary-out branch with:

```ts
      if (m.io === "binary-out") return files.deliverDownload(downloadName(m, input), result as Uint8Array);
```

- [ ] **Step 4: Run all mcp tests.**
Run: `npm test -w mcp`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Commit.**

```bash
git add mcp/src/files.ts mcp/src/method-tools.ts mcp/src/server.ts mcp/tests/files.test.ts mcp/tests/method-tools.test.ts
git commit -m "refactor(mcp): a FilesStrategy seam for upload and download tools" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 3: `inlineFiles`, the hosted files strategy

**Files:**
- Create: `mcp/src/http/inline-files.ts`
- Test: `mcp/tests/http/inline-files.test.ts`

**Interfaces:**
- Consumes: `FilesStrategy`, `sniffExtension`, `UPLOAD_EXTENSIONS` from `mcp/src/files.ts`.
- Produces: `export const inlineFiles: FilesStrategy`, `MAX_UPLOAD_BYTES = 10 MiB`, `MAX_DOWNLOAD_BYTES = 5 MiB`.

- [ ] **Step 1: Write the failing tests.** Create `mcp/tests/http/inline-files.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { inlineFiles, MAX_DOWNLOAD_BYTES, MAX_UPLOAD_BYTES } from "../../src/http/inline-files.js";

const GPX = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Run</name></trk></gpx>`;
const FIT = (() => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(".FIT"), 8);
  return b;
})();

describe("inlineFiles uploads", () => {
  it("asks for filename + content + encoding instead of a path", () => {
    const s = inlineFiles.uploadSchema();
    expect(Object.keys(s.properties)).toEqual(["filename", "content", "encoding"]);
    expect(s.required).toEqual(["filename", "content"]);
  });

  it("reads utf8 text", async () => {
    const { blob, filename } = await inlineFiles.readUpload({ filename: "run.gpx", content: GPX });
    expect(filename).toBe("run.gpx");
    expect(await blob.text()).toBe(GPX);
  });

  it("reads base64 binary", async () => {
    const { blob } = await inlineFiles.readUpload({ filename: "ride.FIT", content: Buffer.from(FIT).toString("base64"), encoding: "base64" });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(FIT);
  });

  it("keeps only the base name of a path-like filename", async () => {
    expect((await inlineFiles.readUpload({ filename: "../../etc/run.gpx", content: GPX })).filename).toBe("run.gpx");
  });

  it("rejects other extensions, empty content and oversize files", async () => {
    await expect(inlineFiles.readUpload({ filename: "notes.txt", content: "x" })).rejects.toThrow(/\.fit, \.gpx and \.tcx/);
    await expect(inlineFiles.readUpload({ filename: "noext", content: "x" })).rejects.toThrow(/\.fit, \.gpx and \.tcx/);
    await expect(inlineFiles.readUpload({ filename: "run.gpx", content: "" })).rejects.toThrow(/empty/);
    await expect(inlineFiles.readUpload({ filename: "run.gpx", content: "a".repeat(MAX_UPLOAD_BYTES + 1) })).rejects.toThrow(/limit/);
  });
});

describe("inlineFiles downloads", () => {
  it("returns text formats as a text resource", async () => {
    const r = await inlineFiles.deliverDownload("download_course_gpx-5", new TextEncoder().encode(GPX));
    expect(r.content[0]).toEqual({ type: "text", text: `download_course_gpx-5.gpx (${GPX.length} bytes)` });
    expect(r.content[1]).toEqual({
      type: "resource",
      resource: { uri: "garmin://download/download_course_gpx-5.gpx", mimeType: "application/gpx+xml", text: GPX },
    });
  });

  it("returns binary formats as a base64 blob resource", async () => {
    const r = await inlineFiles.deliverDownload("download_activity-7", FIT);
    expect(r.content[1]).toEqual({
      type: "resource",
      resource: { uri: "garmin://download/download_activity-7.fit", mimeType: "application/vnd.ant.fit", blob: Buffer.from(FIT).toString("base64") },
    });
  });

  it("refuses files over the download limit", async () => {
    await expect(inlineFiles.deliverDownload("big", new Uint8Array(MAX_DOWNLOAD_BYTES + 1))).rejects.toThrow(/limit/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run --root mcp tests/http/inline-files.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Create `mcp/src/http/inline-files.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { sniffExtension, UPLOAD_EXTENSIONS, type FilesStrategy } from "../files.js";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;

const MIME: Record<string, string> = {
  gpx: "application/gpx+xml",
  tcx: "application/vnd.garmin.tcx+xml",
  kml: "application/vnd.google-earth.kml+xml",
  csv: "text/csv",
  xml: "application/xml",
  json: "application/json",
  fit: "application/vnd.ant.fit",
  zip: "application/zip",
  bin: "application/octet-stream",
};
const TEXT = new Set(["gpx", "tcx", "kml", "csv", "xml", "json"]);
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** The hosted server cannot see the user's disk: files travel inside the MCP messages. */
export const inlineFiles: FilesStrategy = {
  uploadSchema: () => ({
    properties: {
      filename: { type: "string", description: "File name ending in .fit, .gpx or .tcx, e.g. morning-run.gpx" },
      content: { type: "string", description: "The file's contents: plain text for .gpx/.tcx, base64 for .fit" },
      encoding: { type: "string", enum: ["utf8", "base64"], description: "How content is encoded. Default utf8; use base64 for .fit" },
    },
    required: ["filename", "content"],
  }),

  async readUpload(input) {
    const raw = typeof input["filename"] === "string" ? input["filename"].trim() : "";
    const filename = raw.split(/[\\/]/).pop() ?? "";
    const dot = filename.lastIndexOf(".");
    const ext = dot > 0 ? filename.slice(dot).toLowerCase() : "";
    if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new Error(`Only .fit, .gpx and .tcx files can be uploaded; got "${filename || "no filename"}"`);
    }
    const content = typeof input["content"] === "string" ? input["content"] : "";
    if (!content) throw new Error("content is empty");
    const bytes = Buffer.from(content, input["encoding"] === "base64" ? "base64" : "utf8");
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw new Error(`The file is ${mb(bytes.length)}; the limit is ${mb(MAX_UPLOAD_BYTES)}`);
    }
    return { blob: new Blob([bytes]), filename };
  },

  async deliverDownload(baseName, bytes): Promise<CallToolResult> {
    if (bytes.length > MAX_DOWNLOAD_BYTES) {
      throw new Error(`The file is ${mb(bytes.length)}, over the ${mb(MAX_DOWNLOAD_BYTES)} limit for returning it in a chat`);
    }
    const ext = sniffExtension(bytes);
    const name = `${baseName}.${ext}`;
    const uri = `garmin://download/${encodeURIComponent(name)}`;
    const mimeType = MIME[ext] ?? "application/octet-stream";
    const resource = TEXT.has(ext)
      ? { uri, mimeType, text: Buffer.from(bytes).toString("utf8") }
      : { uri, mimeType, blob: Buffer.from(bytes).toString("base64") };
    return { content: [{ type: "text", text: `${name} (${bytes.length} bytes)` }, { type: "resource", resource }] };
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass.**
Run: `npx vitest run --root mcp tests/http/inline-files.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add mcp/src/http/inline-files.ts mcp/tests/http/inline-files.test.ts
git commit -m "feat(mcp): inline files strategy for the hosted server" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 4: Server split, session hint, hosted tool list

**Files:**
- Modify: `mcp/src/server.ts`, `mcp/src/session.ts` (the `Session` interface only), `mcp/src/errors.ts`, `mcp/src/tools.ts`
- Test: `mcp/tests/server.test.ts`, `mcp/tests/errors.test.ts`

**Interfaces:**
- Produces:
  - `buildTools(deps: ServerDeps, factories: readonly ToolFactory[]): ToolDef[]` (throws on a duplicate name)
  - `serverForTools(tools: readonly ToolDef[], deps: ServerDeps): Server`
  - `createServer(deps, factories)`, unchanged, now `serverForTools(buildTools(…))`
- `Session` gains `readonly loginHint?: string`, and `reset(options?: { rejected?: boolean; error?: unknown })`.
- `describeError(error: unknown, hint: string = LOGIN_HINT)` and `errorResult(error: unknown, hint?: string)`.
- `HOSTED_TOOL_FACTORIES: readonly ToolFactory[] = [workoutTools, methodTools]`.
- On `GarminAuthError` the CallTool handler calls `deps.session.reset({ rejected: true, error })` and returns `errorResult(error, deps.session.loginHint)`.

- [ ] **Step 1: Write the failing tests.** Append inside `describe("createServer", …)` in `mcp/tests/server.test.ts` (extend the imports: `buildTools, serverForTools` from `../src/server.js`, `HOSTED_TOOL_FACTORIES, TOOL_FACTORIES` from `../src/tools.js`):

```ts
  it("tells the user the session's own login hint and passes the error to reset", async () => {
    const seen: unknown[] = [];
    const session = { loginHint: "reconnect the connector", get: async () => { throw new Error("unused"); }, reset: (o?: { error?: unknown }) => { seen.push(o?.error); } };
    const boom = new GarminAuthError("Not authorized for x (401)");
    const client = await connect({ config: testConfig(), session }, [tool("boom", () => { throw boom; })]);
    const result = await client.callTool({ name: "boom", arguments: {} });
    expect(textOf(result)).toContain("reconnect the connector");
    expect(textOf(result)).not.toContain("sign_in_to_garmin");
    expect(seen).toEqual([boom]);
  });

  it("builds tools once and can serve them from many servers", () => {
    const tools = buildTools(deps(), [tool("hello", () => textResult("hi"))]);
    expect(serverForTools(tools, deps())).not.toBe(serverForTools(tools, deps()));
    expect(() => buildTools(deps(), [tool("a", () => textResult("")), tool("a", () => textResult(""))])).toThrow(/Duplicate/);
  });

  it("offers no sign-in tool on the hosted server", () => {
    const hosted = buildTools(deps(), HOSTED_TOOL_FACTORIES).map((t) => t.tool.name);
    const local = buildTools(deps(), TOOL_FACTORIES).map((t) => t.tool.name);
    expect(local).toContain("sign_in_to_garmin");
    expect(hosted).not.toContain("sign_in_to_garmin");
    expect(hosted).toEqual(local.filter((n) => n !== "sign_in_to_garmin"));
  });
```

Append to `mcp/tests/errors.test.ts` (import `describeError` and `GarminAuthError` if they aren't already):

```ts
it("uses a caller-supplied hint for auth errors", () => {
  expect(describeError(new GarminAuthError("x"), "reconnect it")).toBe("Garmin session expired or was rejected (x): reconnect it.");
});
```

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run --root mcp tests/server.test.ts tests/errors.test.ts`
Expected: FAIL, `buildTools` not exported, hint ignored.

- [ ] **Step 3: Implement.**

`mcp/src/session.ts`, inside `interface Session`:

```ts
  /** What to tell the user when Garmin rejects the session. Defaults to the sign-in tool hint. */
  readonly loginHint?: string;
  reset(options?: { rejected?: boolean; error?: unknown }): void;
```

(Replace the existing `reset` signature line; keep its doc comment. Add `error` to the doc: "`error` is what Garmin threw, for sessions that need to tell a dead session from a transient refusal.")

`mcp/src/errors.ts`:

```ts
export function describeError(error: unknown, hint: string = LOGIN_HINT): string {
  if (error instanceof NotLoggedInError) {
    return error.reason ? `Not logged in to Garmin (${error.reason}): ${hint}.` : `Not logged in to Garmin: ${hint}.`;
  }
  if (error instanceof GarminAuthError) {
    return `Garmin session expired or was rejected (${error.message}): ${hint}.`;
  }
  // …the remaining branches unchanged…
}

export function errorResult(error: unknown, hint?: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: describeError(error, hint) }] };
}
```

`mcp/src/server.ts`: replace `createServer` with:

```ts
export function buildTools(deps: ServerDeps, factories: readonly ToolFactory[]): ToolDef[] {
  const tools = factories.flatMap((factory) => factory(deps));
  const names = new Set<string>();
  for (const def of tools) {
    if (names.has(def.tool.name)) throw new Error(`Duplicate tool name ${def.tool.name}`);
    names.add(def.tool.name);
  }
  return tools;
}

/** One MCP `Server` over prebuilt tools; the hosted server makes one per HTTP request. */
export function serverForTools(tools: readonly ToolDef[], deps: ServerDeps): Server {
  const byName = new Map(tools.map((def) => [def.tool.name, def]));
  const server = new Server(
    // …the same server info object as today…
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map((t) => t.tool) }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const def = byName.get(request.params.name);
    if (!def) return errorResult(new Error(`Unknown tool "${request.params.name}"`));
    try {
      return await def.run(request.params.arguments ?? {});
    } catch (error) {
      // After `login` in a terminal, the next call must use the NEW tokens, not the cached client;
      // and with configured credentials, a rejected session signs in again.
      if (error instanceof GarminAuthError) deps.session.reset({ rejected: true, error });
      return errorResult(error, deps.session.loginHint);
    }
  });
  return server;
}

export function createServer(deps: ServerDeps, factories: readonly ToolFactory[]): Server {
  return serverForTools(buildTools(deps, factories), deps);
}
```

`mcp/src/tools.ts`, append:

```ts
/** The hosted (HTTP) server: OAuth replaces `sign_in_to_garmin`, so it is not offered. */
export const HOSTED_TOOL_FACTORIES: readonly ToolFactory[] = [workoutTools, methodTools];
```

- [ ] **Step 4: Run all mcp tests, plus the typecheck.**
Run: `npm run typecheck -w mcp; npm test -w mcp`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add mcp/src/server.ts mcp/src/session.ts mcp/src/errors.ts mcp/src/tools.ts mcp/tests/server.test.ts mcp/tests/errors.test.ts
git commit -m "refactor(mcp): build tools once, serve per request; session-supplied login hint" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 5: `Sealer`

**Files:**
- Create: `mcp/src/http/seal.ts`
- Test: `mcp/tests/http/seal.test.ts`

**Interfaces:**
- Produces:

```ts
export type Purpose = "client" | "authreq" | "mfa" | "code" | "access" | "refresh";
export interface Unsealed<T> { data: T; exp?: number }
export function parseSealKeys(raw: string | undefined): Buffer[];
export class Sealer {
  constructor(keys: Buffer[], now?: () => number /* epoch seconds */);
  seal(purpose: Purpose, data: unknown, ttlSeconds?: number): string;     // base64url
  unseal<T>(purpose: Purpose, token: unknown): Unsealed<T> | null;
  pseudonym(value: string): string;                                       // HMAC, base64url
}
```

- [ ] **Step 1: Write the failing tests.** Create `mcp/tests/http/seal.test.ts`:

```ts
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSealKeys, Sealer } from "../../src/http/seal.js";

const k1 = randomBytes(32);
const k2 = randomBytes(32);

describe("Sealer", () => {
  it("round-trips data for the same purpose", () => {
    const s = new Sealer([k1]);
    expect(s.unseal("access", s.seal("access", { a: 1 }))).toEqual({ data: { a: 1 } });
  });

  it("refuses another purpose, tampering, garbage and non-strings", () => {
    const s = new Sealer([k1]);
    const t = s.seal("refresh", { a: 1 });
    expect(s.unseal("access", t)).toBeNull();
    const flipped = t.slice(0, 20) + (t[20] === "A" ? "B" : "A") + t.slice(21);
    expect(s.unseal("refresh", flipped)).toBeNull();
    expect(s.unseal("refresh", "not-a-token")).toBeNull();
    expect(s.unseal("refresh", 42)).toBeNull();
  });

  it("expires sealed data after its ttl", () => {
    let now = 1000;
    const s = new Sealer([k1], () => now);
    const t = s.seal("code", "x", 60);
    expect(s.unseal("code", t)).toEqual({ data: "x", exp: 1060 });
    now = 1060;
    expect(s.unseal("code", t)).toBeNull();
  });

  it("opens tokens sealed with an older key after rotation, and seals with the newest", () => {
    const old = new Sealer([k1]).seal("access", "x");
    const rotated = new Sealer([k2, k1]);
    expect(rotated.unseal("access", old)).toEqual({ data: "x" });
    expect(new Sealer([k2]).unseal("access", rotated.seal("access", "y"))).toEqual({ data: "y" });
    expect(new Sealer([k2]).unseal("access", old)).toBeNull();
  });

  it("makes a stable pseudonym that depends on the key", () => {
    expect(new Sealer([k1]).pseudonym("42")).toBe(new Sealer([k1]).pseudonym("42"));
    expect(new Sealer([k1]).pseudonym("42")).not.toBe(new Sealer([k2]).pseudonym("42"));
    expect(new Sealer([k1]).pseudonym("42")).not.toContain("42");
  });
});

describe("parseSealKeys", () => {
  it("parses comma-separated base64 keys", () => {
    expect(parseSealKeys(`${k1.toString("base64")}, ${k2.toString("base64")}`)).toEqual([k1, k2]);
  });
  it("refuses a missing or short key", () => {
    expect(() => parseSealKeys(undefined)).toThrow(/SEAL_KEYS is not set/);
    expect(() => parseSealKeys(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run --root mcp tests/http/seal.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Create `mcp/src/http/seal.ts`:

```ts
/**
 * Everything the hosted server hands out — client ids, sign-in form state, codes, access and
 * refresh tokens — is JSON sealed with AES-256-GCM: the MCP client stores it but cannot read or
 * alter it, and the server needs no storage to read it back. The purpose is bound in as AAD, so
 * a token sealed for one use can never pass as another. The first key seals; every key unseals,
 * so a key can be rotated without signing everyone out.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export type Purpose = "client" | "authreq" | "mfa" | "code" | "access" | "refresh";

export interface Unsealed<T> {
  data: T;
  exp?: number;
}

const VERSION = 1;
const IV = 12;
const TAG = 16;
const MAX_TOKEN = 16_384;

export function parseSealKeys(raw: string | undefined): Buffer[] {
  const keys = (raw ?? "").split(",").map((k) => k.trim()).filter(Boolean).map((k) => Buffer.from(k, "base64"));
  if (keys.length === 0) throw new Error("SEAL_KEYS is not set: generate one with `openssl rand -base64 32`");
  keys.forEach((key, i) => {
    if (key.length !== 32) throw new Error(`SEAL_KEYS entry ${i + 1} is ${key.length} bytes; each key must be 32 bytes of base64`);
  });
  return keys;
}

export class Sealer {
  readonly #keys: Buffer[];
  readonly #now: () => number;

  constructor(keys: Buffer[], now: () => number = () => Math.floor(Date.now() / 1000)) {
    if (keys.length === 0) throw new Error("Sealer needs at least one key");
    this.#keys = keys;
    this.#now = now;
  }

  seal(purpose: Purpose, data: unknown, ttlSeconds?: number): string {
    const body: { d: unknown; e?: number } = { d: data };
    if (ttlSeconds !== undefined) body.e = this.#now() + ttlSeconds;
    const iv = randomBytes(IV);
    const cipher = createCipheriv("aes-256-gcm", this.#keys[0]!, iv);
    cipher.setAAD(Buffer.from(purpose));
    const ct = Buffer.concat([cipher.update(deflateRawSync(Buffer.from(JSON.stringify(body)))), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]).toString("base64url");
  }

  /** `null` for anything tampered with, sealed for another purpose or under an unknown key, or expired. */
  unseal<T>(purpose: Purpose, token: unknown): Unsealed<T> | null {
    if (typeof token !== "string" || token.length > MAX_TOKEN) return null;
    const raw = Buffer.from(token, "base64url");
    if (raw.length <= 1 + IV + TAG || raw[0] !== VERSION) return null;
    const iv = raw.subarray(1, 1 + IV);
    const tag = raw.subarray(1 + IV, 1 + IV + TAG);
    const ct = raw.subarray(1 + IV + TAG);
    for (const key of this.#keys) {
      let body: { d: T; e?: number };
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(Buffer.from(purpose));
        decipher.setAuthTag(tag);
        body = JSON.parse(inflateRawSync(Buffer.concat([decipher.update(ct), decipher.final()])).toString("utf8")) as { d: T; e?: number };
      } catch {
        continue; // another key, or tampered
      }
      if (body.e !== undefined && body.e <= this.#now()) return null;
      return body.e === undefined ? { data: body.d } : { data: body.d, exp: body.e };
    }
    return null;
  }

  /** A stable keyed pseudonym, so the grant table never holds a Garmin id. */
  pseudonym(value: string): string {
    return createHmac("sha256", this.#keys[0]!).update(`garmin-user:${value}`).digest("base64url");
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass.**
Run: `npx vitest run --root mcp tests/http/seal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add mcp/src/http/seal.ts mcp/tests/http/seal.test.ts
git commit -m "feat(mcp): AES-GCM sealing for hosted OAuth tokens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 6: Grant store (memory + SQLite)

**Files:**
- Create: `mcp/src/http/grants.ts`
- Test: `mcp/tests/http/grants.test.ts`

**Interfaces:**
- Produces:

```ts
export type GrantState = "pending" | "active" | "revoked";
export interface Grant { grantId: string; userHash: string; clientName: string | null; state: GrantState; generation: number; rotatedAt: number | null; created: number; lastUsed: number }
export type GenerationVerdict = "current" | "grace" | "reused" | "missing" | "revoked";
export type RotateResult = { ok: true; generation: number } | { ok: false; reason: "missing" | "revoked" | "reused" };
export const IDLE_LIMIT_S = 35 * 86_400, PENDING_LIMIT_S = 600, REUSE_GRACE_S = 60;
export function checkGeneration(grant: Grant | undefined, generation: number, now: number): GenerationVerdict;
export interface GrantStore {
  create(userHash: string, clientName: string | null, now: number): Grant;   // state "pending"
  get(grantId: string): Grant | undefined;
  activate(grantId: string, now: number): boolean;                            // pending → active, once
  rotate(grantId: string, generation: number, now: number): RotateResult;     // revokes on reuse
  touch(grantId: string, now: number): void;
  revoke(grantId: string): boolean;
  revokeUser(userHash: string, exceptGrantId?: string): number;
  revokeAll(): number;
  purge(now: number): number;
  count(): { active: number; total: number };
  close(): void;
}
export class MemoryGrantStore implements GrantStore;
export class SqliteGrantStore implements GrantStore { static open(path: string): Promise<SqliteGrantStore> }
```

- [ ] **Step 1: Write the failing tests.** Create `mcp/tests/http/grants.test.ts`. It runs one contract against both stores; SQLite skips where `node:sqlite` is unavailable (Node 18/20, and 22 before 22.13):

```ts
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkGeneration, IDLE_LIMIT_S, MemoryGrantStore, PENDING_LIMIT_S, REUSE_GRACE_S, SqliteGrantStore, type GrantStore } from "../../src/http/grants.js";

const sqliteAvailable = await import("node:sqlite").then(() => true, () => false);
const tmpDb = () => path.join(mkdtempSync(path.join(os.tmpdir(), "grants-")), "grants.db");

function contract(name: string, open: () => Promise<GrantStore>) {
  describe(name, () => {
    it("creates pending grants that activate exactly once", async () => {
      const s = await open();
      const g = s.create("u1", "Claude", 100);
      expect(s.get(g.grantId)).toMatchObject({ userHash: "u1", clientName: "Claude", state: "pending", generation: 0, rotatedAt: null });
      expect(s.activate(g.grantId, 101)).toBe(true);
      expect(s.activate(g.grantId, 102)).toBe(false);
      expect(s.get(g.grantId)?.state).toBe("active");
    });

    it("bumps the generation and revokes on a stale one", async () => {
      const s = await open();
      const g = s.create("u1", null, 100);
      s.activate(g.grantId, 100);
      expect(s.rotate(g.grantId, 0, 200)).toEqual({ ok: true, generation: 1 });
      expect(s.rotate(g.grantId, 1, 300)).toEqual({ ok: true, generation: 2 });
      expect(s.rotate(g.grantId, 0, 300 + REUSE_GRACE_S + 1)).toEqual({ ok: false, reason: "reused" });
      expect(s.get(g.grantId)?.state).toBe("revoked");
      expect(s.rotate(g.grantId, 2, 400)).toEqual({ ok: false, reason: "revoked" });
      expect(s.rotate("nope", 0, 400)).toEqual({ ok: false, reason: "missing" });
    });

    it("accepts the previous generation inside the grace window without bumping", async () => {
      const s = await open();
      const g = s.create("u1", null, 100);
      s.activate(g.grantId, 100);
      s.rotate(g.grantId, 0, 200);
      expect(s.rotate(g.grantId, 0, 200 + REUSE_GRACE_S)).toEqual({ ok: true, generation: 1 });
      expect(s.get(g.grantId)).toMatchObject({ state: "active", generation: 1 });
    });

    it("revokes one, all of a user's except one, and all", async () => {
      const s = await open();
      const a = s.create("u1", null, 1), b = s.create("u1", null, 1), c = s.create("u2", null, 1);
      [a, b, c].forEach((g) => s.activate(g.grantId, 1));
      expect(s.revokeUser("u1", b.grantId)).toBe(1);
      expect(s.get(a.grantId)?.state).toBe("revoked");
      expect(s.get(b.grantId)?.state).toBe("active");
      expect(s.revoke(b.grantId)).toBe(true);
      expect(s.revoke(b.grantId)).toBe(false);
      expect(s.count()).toEqual({ active: 1, total: 3 });
      expect(s.revokeAll()).toBe(1);
    });

    it("purges idle grants and abandoned pending ones", async () => {
      const s = await open();
      const now = 10_000_000;
      const idle = s.create("u", null, now - IDLE_LIMIT_S - 10);
      s.activate(idle.grantId, now - IDLE_LIMIT_S - 10);
      const abandoned = s.create("u", null, now - PENDING_LIMIT_S - 10);
      const fresh = s.create("u", null, now);
      s.activate(fresh.grantId, now);
      s.touch(fresh.grantId, now);
      expect(s.purge(now)).toBe(2);
      expect(s.get(idle.grantId)).toBeUndefined();
      expect(s.get(abandoned.grantId)).toBeUndefined();
      expect(s.get(fresh.grantId)).toBeDefined();
    });
  });
}

contract("MemoryGrantStore", async () => new MemoryGrantStore());
describe.skipIf(!sqliteAvailable)("sqlite", () => {
  contract("SqliteGrantStore", () => SqliteGrantStore.open(tmpDb()));
  it("persists across reopen", async () => {
    const file = tmpDb();
    const s = await SqliteGrantStore.open(file);
    const g = s.create("u", "Claude", 5);
    s.close();
    expect((await SqliteGrantStore.open(file)).get(g.grantId)?.clientName).toBe("Claude");
  });
});

describe("checkGeneration", () => {
  const base = { grantId: "g", userHash: "u", clientName: null, created: 0, lastUsed: 0 };
  it("classifies every case", () => {
    expect(checkGeneration(undefined, 0, 0)).toBe("missing");
    expect(checkGeneration({ ...base, state: "pending", generation: 0, rotatedAt: null }, 0, 0)).toBe("revoked");
    expect(checkGeneration({ ...base, state: "active", generation: 2, rotatedAt: 100 }, 2, 100)).toBe("current");
    expect(checkGeneration({ ...base, state: "active", generation: 2, rotatedAt: 100 }, 1, 100 + REUSE_GRACE_S)).toBe("grace");
    expect(checkGeneration({ ...base, state: "active", generation: 2, rotatedAt: 100 }, 1, 101 + REUSE_GRACE_S)).toBe("reused");
    expect(checkGeneration({ ...base, state: "active", generation: 2, rotatedAt: 100 }, 0, 100)).toBe("reused");
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run --root mcp tests/http/grants.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Create `mcp/src/http/grants.ts`:

```ts
/**
 * One row per connection a user makes. It holds NO Garmin tokens and no email: those live only
 * inside the sealed OAuth tokens the client holds. The row exists so codes are single-use, a
 * replayed refresh token can be detected (rotation generation), and a connection can be revoked.
 */
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite"; // type only: the module is loaded lazily (Node 18/20 lack it)

export type GrantState = "pending" | "active" | "revoked";

export interface Grant {
  grantId: string;
  userHash: string;
  clientName: string | null;
  state: GrantState;
  generation: number;
  rotatedAt: number | null;
  created: number;
  lastUsed: number;
}

export type GenerationVerdict = "current" | "grace" | "reused" | "missing" | "revoked";
export type RotateResult = { ok: true; generation: number } | { ok: false; reason: "missing" | "revoked" | "reused" };

export const IDLE_LIMIT_S = 35 * 86_400;
export const PENDING_LIMIT_S = 600;
/** Two refreshes racing with the same token (web + mobile, a retry) must not disconnect anyone. */
export const REUSE_GRACE_S = 60;

export const newGrantId = (): string => randomBytes(16).toString("base64url");

export function checkGeneration(grant: Grant | undefined, generation: number, now: number): GenerationVerdict {
  if (!grant) return "missing";
  if (grant.state !== "active") return "revoked";
  if (generation === grant.generation) return "current";
  if (generation === grant.generation - 1 && grant.rotatedAt !== null && now - grant.rotatedAt <= REUSE_GRACE_S) return "grace";
  return "reused";
}

export interface GrantStore {
  create(userHash: string, clientName: string | null, now: number): Grant;
  get(grantId: string): Grant | undefined;
  /** pending → active, once. `false` means the code was already exchanged. */
  activate(grantId: string, now: number): boolean;
  /** Compare-and-bump the refresh generation; a stale one revokes the grant (a replayed refresh token). */
  rotate(grantId: string, generation: number, now: number): RotateResult;
  touch(grantId: string, now: number): void;
  revoke(grantId: string): boolean;
  revokeUser(userHash: string, exceptGrantId?: string): number;
  revokeAll(): number;
  /** Deletes grants idle for 35 days and pending ones older than 10 minutes. */
  purge(now: number): number;
  count(): { active: number; total: number };
  close(): void;
}

/** Shared by both stores: given the verdict, what `rotate` returns and whether to bump. */
function rotation(store: GrantStore, grantId: string, generation: number, now: number, bump: () => void): RotateResult {
  const grant = store.get(grantId);
  const verdict = checkGeneration(grant, generation, now);
  if (verdict === "missing" || verdict === "revoked") return { ok: false, reason: verdict };
  if (verdict === "reused") {
    store.revoke(grantId);
    return { ok: false, reason: "reused" };
  }
  if (verdict === "grace") return { ok: true, generation: grant!.generation };
  bump();
  return { ok: true, generation: generation + 1 };
}

export class MemoryGrantStore implements GrantStore {
  readonly #grants = new Map<string, Grant>();

  create(userHash: string, clientName: string | null, now: number): Grant {
    const grant: Grant = { grantId: newGrantId(), userHash, clientName, state: "pending", generation: 0, rotatedAt: null, created: now, lastUsed: now };
    this.#grants.set(grant.grantId, grant);
    return { ...grant };
  }
  get(grantId: string): Grant | undefined {
    const g = this.#grants.get(grantId);
    return g ? { ...g } : undefined;
  }
  activate(grantId: string, now: number): boolean {
    const g = this.#grants.get(grantId);
    if (g?.state !== "pending") return false;
    g.state = "active";
    g.lastUsed = now;
    return true;
  }
  rotate(grantId: string, generation: number, now: number): RotateResult {
    return rotation(this, grantId, generation, now, () => {
      const g = this.#grants.get(grantId)!;
      g.generation += 1;
      g.rotatedAt = now;
      g.lastUsed = now;
    });
  }
  touch(grantId: string, now: number): void {
    const g = this.#grants.get(grantId);
    if (g) g.lastUsed = now;
  }
  revoke(grantId: string): boolean {
    const g = this.#grants.get(grantId);
    if (!g || g.state === "revoked") return false;
    g.state = "revoked";
    return true;
  }
  revokeUser(userHash: string, exceptGrantId?: string): number {
    let n = 0;
    for (const g of this.#grants.values()) {
      if (g.userHash === userHash && g.grantId !== exceptGrantId && g.state !== "revoked") {
        g.state = "revoked";
        n++;
      }
    }
    return n;
  }
  revokeAll(): number {
    let n = 0;
    for (const g of this.#grants.values()) if (g.state !== "revoked") (g.state = "revoked"), n++;
    return n;
  }
  purge(now: number): number {
    let n = 0;
    for (const [id, g] of this.#grants) {
      if (g.lastUsed < now - IDLE_LIMIT_S || (g.state === "pending" && g.created < now - PENDING_LIMIT_S)) {
        this.#grants.delete(id);
        n++;
      }
    }
    return n;
  }
  count(): { active: number; total: number } {
    const all = [...this.#grants.values()];
    return { active: all.filter((g) => g.state === "active").length, total: all.length };
  }
  close(): void {}
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS grants (
  grant_id TEXT PRIMARY KEY,
  user_hash TEXT NOT NULL,
  client_name TEXT,
  state TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0,
  rotated_at INTEGER,
  created INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS grants_user ON grants (user_hash);`;

type Row = Record<string, unknown>;
const toGrant = (r: Row): Grant => ({
  grantId: String(r["grant_id"]),
  userHash: String(r["user_hash"]),
  clientName: r["client_name"] == null ? null : String(r["client_name"]),
  state: r["state"] as GrantState,
  generation: Number(r["generation"]),
  rotatedAt: r["rotated_at"] == null ? null : Number(r["rotated_at"]),
  created: Number(r["created"]),
  lastUsed: Number(r["last_used"]),
});

export class SqliteGrantStore implements GrantStore {
  readonly #db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** Needs Node >= 22.13 (`node:sqlite` without a flag); the Docker image has it. */
  static async open(file: string): Promise<SqliteGrantStore> {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(SCHEMA);
    return new SqliteGrantStore(db);
  }

  create(userHash: string, clientName: string | null, now: number): Grant {
    const grant: Grant = { grantId: newGrantId(), userHash, clientName, state: "pending", generation: 0, rotatedAt: null, created: now, lastUsed: now };
    this.#db
      .prepare("INSERT INTO grants (grant_id, user_hash, client_name, state, generation, rotated_at, created, last_used) VALUES (?, ?, ?, 'pending', 0, NULL, ?, ?)")
      .run(grant.grantId, userHash, clientName, now, now);
    return grant;
  }
  get(grantId: string): Grant | undefined {
    const row = this.#db.prepare("SELECT * FROM grants WHERE grant_id = ?").get(grantId) as Row | undefined;
    return row ? toGrant(row) : undefined;
  }
  activate(grantId: string, now: number): boolean {
    return Number(this.#db.prepare("UPDATE grants SET state = 'active', last_used = ? WHERE grant_id = ? AND state = 'pending'").run(now, grantId).changes) === 1;
  }
  rotate(grantId: string, generation: number, now: number): RotateResult {
    // node:sqlite is synchronous and single-threaded here, so check-then-update cannot interleave.
    return rotation(this, grantId, generation, now, () => {
      this.#db.prepare("UPDATE grants SET generation = generation + 1, rotated_at = ?, last_used = ? WHERE grant_id = ?").run(now, now, grantId);
    });
  }
  touch(grantId: string, now: number): void {
    this.#db.prepare("UPDATE grants SET last_used = ? WHERE grant_id = ?").run(now, grantId);
  }
  revoke(grantId: string): boolean {
    return Number(this.#db.prepare("UPDATE grants SET state = 'revoked' WHERE grant_id = ? AND state != 'revoked'").run(grantId).changes) === 1;
  }
  revokeUser(userHash: string, exceptGrantId?: string): number {
    return Number(this.#db.prepare("UPDATE grants SET state = 'revoked' WHERE user_hash = ? AND grant_id != ? AND state != 'revoked'").run(userHash, exceptGrantId ?? "").changes);
  }
  revokeAll(): number {
    return Number(this.#db.prepare("UPDATE grants SET state = 'revoked' WHERE state != 'revoked'").run().changes);
  }
  purge(now: number): number {
    return Number(
      this.#db.prepare("DELETE FROM grants WHERE last_used < ? OR (state = 'pending' AND created < ?)").run(now - IDLE_LIMIT_S, now - PENDING_LIMIT_S).changes,
    );
  }
  count(): { active: number; total: number } {
    const r = this.#db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(state = 'active'), 0) AS active FROM grants").get() as Row;
    return { active: Number(r["active"]), total: Number(r["total"]) };
  }
  close(): void {
    this.#db.close();
  }
}
```

- [ ] **Step 4: Run the tests.**
Run: `npx vitest run --root mcp tests/http/grants.test.ts`
Expected: PASS. On Node 22.11 the `sqlite` block is reported as skipped; that's expected. Then run `npm run typecheck -w mcp` (PASS: `node:sqlite` types come from `@types/node` 22).

If a Node ≥ 22.13 is available (e.g. `npx -y node@22 --version`), also run `npx -y node@22 node_modules/vitest/vitest.mjs run --root mcp tests/http/grants.test.ts`. Expected: PASS with the sqlite block executed.

- [ ] **Step 5: Commit.**

```bash
git add mcp/src/http/grants.ts mcp/tests/http/grants.test.ts
git commit -m "feat(mcp): grant store (memory and node:sqlite) with rotation and reuse detection" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 7: `GarminAuth` and the per-request session

**Files:**
- Create: `mcp/src/http/garmin-auth.ts`, `mcp/src/http/request-session.ts`
- Test: `mcp/tests/http/garmin-auth.test.ts`, `mcp/tests/http/request-session.test.ts`

**Interfaces:**
- Consumes: `GarminClient#refreshTokens` (Task 1), `Session` (Task 4).
- Produces:

```ts
// garmin-auth.ts
export type SignInResult = { state: "success"; tokens: Tokens } | { state: "mfa_required"; mfaState: MfaState };
export interface GarminAuth {
  login(email: string, password: string): Promise<SignInResult>;
  resume(mfaState: MfaState, code: string): Promise<Tokens>;
  profileId(tokens: Tokens): Promise<string>;
  refresh(tokens: Tokens, withinMs: number): Promise<Tokens>;
}
export function garminAuth(options?: Omit<GarminClientOptions, "tokenStore">): GarminAuth;
export function isDeadSession(error: unknown): boolean;
// request-session.ts
export interface RequestContext { grantId: string; tokens: Tokens; onRejected(error: unknown): void }
export const RECONNECT_HINT: string;
export interface RequestSession extends Session { run<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> }
export function requestSession(clientOptions?: Omit<GarminClientOptions, "tokenStore">): RequestSession;
```

- [ ] **Step 1: Write the failing tests.** Create `mcp/tests/http/garmin-auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GarminAuthError } from "garminconnect-js";
import { garminAuth, isDeadSession } from "../../src/http/garmin-auth.js";
import { fakeFetch, PROFILE_ROUTE, TOKENS } from "../helpers.js";

describe("garminAuth", () => {
  it("reads the profile id with the given tokens", async () => {
    const { fetchImpl } = fakeFetch(PROFILE_ROUTE);
    expect(await garminAuth({ fetchImpl, retries: 0 }).profileId(TOKENS)).toBe("1");
  });

  it("returns fresh tokens untouched when nothing is near expiry", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    expect(await garminAuth({ fetchImpl, retries: 0 }).refresh(TOKENS, 0)).toEqual(TOKENS);
    expect(calls).toEqual([]);
  });
});

describe("isDeadSession", () => {
  it("is true only for a 401 or a 'log in again' auth error", () => {
    expect(isDeadSession(new GarminAuthError("Not authorized for x (401)"))).toBe(true);
    expect(isDeadSession(new GarminAuthError("Refresh token expired; log in again"))).toBe(true);
    expect(isDeadSession(new GarminAuthError("Not authorized for x (403)"))).toBe(false);
    expect(isDeadSession(new Error("Not authorized for x (401)"))).toBe(false);
  });
});
```

Create `mcp/tests/http/request-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { requestSession } from "../../src/http/request-session.js";
import { fakeFetch, PROFILE_ROUTE, TOKENS } from "../helpers.js";

describe("requestSession", () => {
  const { fetchImpl } = fakeFetch(PROFILE_ROUTE);

  it("gives each request a Garmin client over its own tokens", async () => {
    const session = requestSession({ fetchImpl, retries: 0 });
    const name = await session.run({ grantId: "g", tokens: TOKENS, onRejected: () => {} }, async () =>
      (await session.get()).displayName(),
    );
    expect(name).toBe("abc-display");
  });

  it("keeps concurrent requests apart and reuses the client within one", async () => {
    const session = requestSession({ fetchImpl, retries: 0 });
    const ctx = (id: string) => ({ grantId: id, tokens: TOKENS, onRejected: () => {} });
    const [a, b] = await Promise.all([
      session.run(ctx("a"), async () => [await session.get(), await session.get()] as const),
      session.run(ctx("b"), async () => [await session.get(), await session.get()] as const),
    ]);
    expect(a[0]).toBe(a[1]);
    expect(a[0]).not.toBe(b[0]);
  });

  it("refuses outside a request, and reports rejections to the request", async () => {
    const session = requestSession({ fetchImpl, retries: 0 });
    await expect(session.get()).rejects.toThrow(/No Garmin connection/);
    const seen: unknown[] = [];
    const boom = new Error("x");
    await session.run({ grantId: "g", tokens: TOKENS, onRejected: (e) => seen.push(e) }, async () => session.reset({ rejected: true, error: boom }));
    session.reset({ rejected: true, error: boom }); // outside a request: a no-op, not a throw
    expect(seen).toEqual([boom]);
    expect(session.loginHint).toMatch(/reconnect/i);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run --root mcp tests/http/garmin-auth.test.ts tests/http/request-session.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement.** Create `mcp/src/http/garmin-auth.ts`:

```ts
/** Every Garmin call the OAuth server makes, behind one interface so tests can fake Garmin's SSO. */
import { Garmin, GarminAuthError, GarminClient, type GarminClientOptions, type MfaState, type Tokens } from "garminconnect-js";

export type SignInResult = { state: "success"; tokens: Tokens } | { state: "mfa_required"; mfaState: MfaState };

export interface GarminAuth {
  login(email: string, password: string): Promise<SignInResult>;
  resume(mfaState: MfaState, code: string): Promise<Tokens>;
  profileId(tokens: Tokens): Promise<string>;
  /** Current tokens, refreshing the OAuth2 token first if it expires within `withinMs`. */
  refresh(tokens: Tokens, withinMs: number): Promise<Tokens>;
}

export function garminAuth(options: Omit<GarminClientOptions, "tokenStore"> = {}): GarminAuth {
  const withTokens = (tokens: Tokens) => {
    const client = new GarminClient(options);
    client.setTokens(tokens);
    return client;
  };
  const tokensOf = (client: GarminClient): Tokens => {
    const tokens = client.getTokens();
    if (!tokens) throw new GarminAuthError("Garmin returned no tokens");
    return tokens;
  };
  return {
    async login(email, password) {
      const client = new GarminClient(options);
      const result = await client.login(email, password);
      return result.state === "mfa_required" ? { state: "mfa_required", mfaState: result.mfaState } : { state: "success", tokens: tokensOf(client) };
    },
    async resume(mfaState, code) {
      const client = new GarminClient(options);
      await client.resumeLogin(mfaState, code);
      return tokensOf(client);
    },
    async profileId(tokens) {
      return String((await new Garmin(withTokens(tokens)).getUserProfile()).profileId);
    },
    refresh: (tokens, withinMs) => withTokens(tokens).refreshTokens({ withinMs }),
  };
}

/**
 * Garmin has really ended the session (the library's own rule for clearing saved tokens): a 401,
 * or its "log in again" refresh errors. A 403 is usually Cloudflare and passes; never revoke on it.
 */
export function isDeadSession(error: unknown): boolean {
  return error instanceof GarminAuthError && (error.message.endsWith("(401)") || /log in again/i.test(error.message));
}
```

Create `mcp/src/http/request-session.ts`:

```ts
/**
 * The hosted server's `Session`: tools are built once, and each HTTP request runs inside its own
 * AsyncLocalStorage context carrying that user's Garmin tokens (unsealed from the access token).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { Garmin, GarminClient, type GarminClientOptions, type Tokens } from "garminconnect-js";
import type { Session } from "../session.js";

export interface RequestContext {
  grantId: string;
  tokens: Tokens;
  onRejected(error: unknown): void;
}

export const RECONNECT_HINT =
  "reconnect the Garmin connector in your MCP client (in claude.ai: Settings → Connectors), then try again";

export interface RequestSession extends Session {
  run<T>(context: RequestContext, fn: () => Promise<T>): Promise<T>;
}

export function requestSession(clientOptions: Omit<GarminClientOptions, "tokenStore"> = {}): RequestSession {
  const storage = new AsyncLocalStorage<{ context: RequestContext; garmin?: Garmin }>();
  return {
    loginHint: RECONNECT_HINT,
    run: (context, fn) => storage.run({ context }, fn),
    async get() {
      const store = storage.getStore();
      if (!store) throw new Error("No Garmin connection for this request");
      if (!store.garmin) {
        const client = new GarminClient(clientOptions);
        client.setTokens(store.context.tokens);
        store.garmin = new Garmin(client);
      }
      return store.garmin;
    },
    reset(options) {
      if (options?.rejected) storage.getStore()?.context.onRejected(options.error);
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass.**
Run: `npx vitest run --root mcp tests/http/garmin-auth.test.ts tests/http/request-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add mcp/src/http/garmin-auth.ts mcp/src/http/request-session.ts mcp/tests/http/garmin-auth.test.ts mcp/tests/http/request-session.test.ts
git commit -m "feat(mcp): Garmin auth adapter and per-request session for the hosted server" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 8: Sign-in pages

**Files:**
- Modify: `mcp/src/signin-page.ts` (export `html`, `escape`)
- Create: `mcp/src/http/pages.ts`
- Test: `mcp/tests/http/pages.test.ts`

**Interfaces:**
- Produces:

```ts
export function formActionSource(redirectUri: string): string;
export function pageHeaders(redirectUri?: string): Record<string, string>;
export function credentialsPage(o: { action: string; request: string; clientName: string | null; email?: string; error?: string }): string;
export function mfaPage(o: { action: string; mfa: string; error?: string }): string;
export function errorPage(message: string): string;
```

- [ ] **Step 1: Write the failing tests.** Create `mcp/tests/http/pages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
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
```

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run --root mcp tests/http/pages.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** In `mcp/src/signin-page.ts` change `const escape = …` to `export const escape = …`, and `function html(` to `export function html(`. Nothing else changes.

Create `mcp/src/http/pages.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests.**
Run: `npx vitest run --root mcp tests/http/pages.test.ts tests/signin-page.test.ts`
Expected: PASS (the existing sign-in page tests are unaffected).

- [ ] **Step 5: Commit.**

```bash
git add mcp/src/signin-page.ts mcp/src/http/pages.ts mcp/tests/http/pages.test.ts
git commit -m "feat(mcp): hosted Garmin sign-in and MFA pages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 9: `HostedOAuthProvider`

**Files:**
- Create: `mcp/src/http/provider.ts`, `mcp/tests/http/fakes.ts`
- Test: `mcp/tests/http/provider.test.ts`

**Interfaces:**
- Consumes: `Sealer` (T5), `GrantStore`/`checkGeneration` (T6), `GarminAuth`/`isDeadSession` (T7), pages (T8).
- Produces:

```ts
export const ACCESS_TTL_S = 3600, CODE_TTL_S = 60, FORM_TTL_S = 600, REFRESH_WITHIN_MS = 2 * 3600_000, TOUCH_EVERY_S = 60;
export interface ProviderOptions { sealer: Sealer; grants: GrantStore; auth: GarminAuth; signInPath: string; now?: () => number }
export type SignInOutcome = { kind: "redirect"; location: string } | { kind: "page"; status: number; headers: Record<string, string>; body: string };
export interface AccessExtra { grantId: string; tokens: Tokens }   // AuthInfo.extra
export class HostedOAuthProvider implements OAuthServerProvider {
  constructor(options: ProviderOptions);
  handleSignIn(form: Record<string, string | undefined>): Promise<SignInOutcome>;
  // + the OAuthServerProvider members
}
```

- [ ] **Step 1: Write the shared fakes.** Create `mcp/tests/http/fakes.ts`:

```ts
import { GarminAuthError, type MfaState, type Tokens } from "garminconnect-js";
import type { Response } from "express";
import type { GarminAuth } from "../../src/http/garmin-auth.js";
import { TOKENS } from "../helpers.js";

/** Distinctive strings, so a test can prove none of them reach the database file. */
export const SECRET_TOKENS: Tokens = {
  oauth1: { oauth_token: "OAUTH1-TOKEN-SECRET", oauth_token_secret: "OAUTH1-SECRET-SECRET", domain: "garmin.com" },
  oauth2: { ...TOKENS.oauth2, access_token: "OAUTH2-ACCESS-SECRET", refresh_token: "OAUTH2-REFRESH-SECRET" },
};
export const PASSWORD = "right-password";
export const MFA_CODE = "123456";

export interface FakeAuth extends GarminAuth {
  refreshes: number;
  failRefresh: Error | null;
}

/** Any email works with PASSWORD; an email starting "mfa" needs MFA_CODE. Every user is profile 42. */
export function fakeAuth(): FakeAuth {
  const auth: FakeAuth = {
    refreshes: 0,
    failRefresh: null,
    async login(email, password) {
      if (password !== PASSWORD) throw new GarminAuthError("SSO error: INVALID_CREDENTIALS");
      if (email.startsWith("mfa")) return { state: "mfa_required", mfaState: { flow: "mobile", fake: true } as unknown as MfaState };
      return { state: "success", tokens: SECRET_TOKENS };
    },
    async resume(_state, code) {
      if (code !== MFA_CODE) throw new GarminAuthError("SSO error: INVALID_MFA_CODE");
      return SECRET_TOKENS;
    },
    async profileId() {
      return "42";
    },
    async refresh(tokens) {
      auth.refreshes++;
      if (auth.failRefresh) throw auth.failRefresh;
      return { ...tokens, oauth2: { ...tokens.oauth2, access_token: `REFRESHED-${auth.refreshes}` } };
    },
  };
  return auth;
}

export function fakeRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: "",
    status(code: number) { res.statusCode = code; return res; },
    set(headers: Record<string, string>) { Object.assign(res.headers, headers); return res; },
    send(body: string) { res.body = body; return res; },
  };
  return res as typeof res & Response;
}

export const hidden = (page: string, name: string): string | undefined =>
  new RegExp(`name="${name}" value="([^"]*)"`).exec(page)?.[1];
```

- [ ] **Step 2: Write the failing tests.** Create `mcp/tests/http/provider.test.ts`:

```ts
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { InvalidGrantError, InvalidTokenError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { GarminAuthError } from "garminconnect-js";
import { MemoryGrantStore } from "../../src/http/grants.js";
import { ACCESS_TTL_S, CODE_TTL_S, FORM_TTL_S, HostedOAuthProvider, REFRESH_WITHIN_MS, type AccessExtra } from "../../src/http/provider.js";
import { Sealer } from "../../src/http/seal.js";
import { fakeAuth, fakeRes, hidden, MFA_CODE, PASSWORD, SECRET_TOKENS, type FakeAuth } from "./fakes.js";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const key = randomBytes(32);

let clock: number;
let grants: MemoryGrantStore;
let auth: FakeAuth;
let provider: HostedOAuthProvider;
let client: OAuthClientInformationFull;

const make = (keys = [key]) =>
  new HostedOAuthProvider({ sealer: new Sealer(keys, () => clock), grants, auth, signInPath: "/mcp/oauth/signin", now: () => clock });

beforeEach(async () => {
  clock = 1_000_000;
  grants = new MemoryGrantStore();
  auth = fakeAuth();
  provider = make();
  client = await provider.clientsStore.registerClient!({ redirect_uris: [REDIRECT], client_name: "Claude", token_endpoint_auth_method: "none" });
});

async function formFor(redirectUri = REDIRECT, state = "st") {
  const res = fakeRes();
  await provider.authorize({ ...client, redirect_uris: [redirectUri] }, { redirectUri, codeChallenge: "CHALLENGE", state, scopes: [] }, res);
  return { res, request: hidden(res.body, "request")! };
}

async function signIn(email = "a@b.c") {
  const { request } = await formFor();
  const outcome = await provider.handleSignIn({ step: "credentials", request, email, password: PASSWORD });
  if (outcome.kind !== "redirect") throw new Error(`no redirect: ${outcome.body}`);
  return new URL(outcome.location).searchParams.get("code")!;
}

async function tokens(email?: string) {
  return provider.exchangeAuthorizationCode(client, await signIn(email));
}

describe("client registration", () => {
  it("round-trips a registration through the sealed client_id", async () => {
    expect(await provider.clientsStore.getClient(client.client_id)).toMatchObject({ client_name: "Claude", redirect_uris: [REDIRECT], client_id: client.client_id });
    expect(await provider.clientsStore.getClient("garbage")).toBeUndefined();
  });
});

describe("sign-in", () => {
  it("renders the form with sealed request state and a CSP that allows the redirect", async () => {
    const { res, request } = await formFor();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toContain("form-action 'self' https://claude.ai");
    expect(request).toBeTruthy();
    expect(res.body).toContain("Claude");
  });

  it("redirects with a code and the state, and leaves a pending grant", async () => {
    const { request } = await formFor();
    const outcome = await provider.handleSignIn({ step: "credentials", request, email: "a@b.c", password: PASSWORD });
    expect(outcome.kind).toBe("redirect");
    const url = new URL((outcome as { location: string }).location);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("st");
    expect(grants.count()).toEqual({ active: 0, total: 1 });
  });

  it("keeps query strings and custom schemes in the redirect", async () => {
    for (const redirectUri of ["https://x.example/cb?a=1", "cursor://anysphere.cursor-retrieval/oauth/callback"]) {
      const { request } = await formFor(redirectUri);
      const outcome = await provider.handleSignIn({ step: "credentials", request, email: "a@b.c", password: PASSWORD });
      const url = new URL((outcome as { location: string }).location);
      expect(url.href.startsWith(redirectUri)).toBe(true);
      expect(url.searchParams.get("code")).toBeTruthy();
      if (redirectUri.includes("?a=1")) expect(url.searchParams.get("a")).toBe("1");
    }
  });

  it("shows a wrong password on the form, with no grant", async () => {
    const { request } = await formFor();
    const outcome = await provider.handleSignIn({ step: "credentials", request, email: "a@b.c", password: "nope" });
    expect(outcome).toMatchObject({ kind: "page", status: 400 });
    expect((outcome as { body: string }).body).toContain("INVALID_CREDENTIALS");
    expect((outcome as { body: string }).body).toContain('value="a@b.c"');
    expect(grants.count().total).toBe(0);
  });

  it("goes through MFA, lets a wrong code be retried, then redirects", async () => {
    const { request } = await formFor();
    const first = await provider.handleSignIn({ step: "credentials", request, email: "mfa@b.c", password: PASSWORD });
    const mfa = hidden((first as { body: string }).body, "mfa")!;
    const wrong = await provider.handleSignIn({ step: "mfa", mfa, code: "000000" });
    expect(wrong).toMatchObject({ kind: "page", status: 400 });
    expect(hidden((wrong as { body: string }).body, "mfa")).toBe(mfa);
    expect(await provider.handleSignIn({ step: "mfa", mfa, code: MFA_CODE })).toMatchObject({ kind: "redirect" });
  });

  it("explains an expired form or MFA step instead of failing", async () => {
    const { request } = await formFor();
    const first = await provider.handleSignIn({ step: "credentials", request, email: "mfa@b.c", password: PASSWORD });
    const mfa = hidden((first as { body: string }).body, "mfa")!;
    clock += FORM_TTL_S;
    for (const form of [{ step: "credentials", request, email: "a@b.c", password: PASSWORD }, { step: "mfa", mfa, code: MFA_CODE }]) {
      const outcome = await provider.handleSignIn(form);
      expect(outcome).toMatchObject({ kind: "page", status: 400 });
      expect((outcome as { body: string }).body).toContain("expired");
    }
  });

  it("asks for both fields when one is missing", async () => {
    const { request } = await formFor();
    expect(await provider.handleSignIn({ step: "credentials", request, email: "", password: "" })).toMatchObject({ kind: "page", status: 400 });
  });

  it("disconnects the user's other connections when asked", async () => {
    const first = await tokens();
    const { request } = await formFor();
    await provider.handleSignIn({ step: "credentials", request, email: "a@b.c", password: PASSWORD, disconnectOthers: "1" });
    await expect(provider.verifyAccessToken(first.access_token)).rejects.toThrow(InvalidTokenError);
  });

  it("survives a restart and a key rotation between form, code and token", async () => {
    const { request } = await formFor(); // sealed under `key`
    const rotated = randomBytes(32);
    provider = make([rotated, key]); // new process, new key prepended
    const outcome = await provider.handleSignIn({ step: "credentials", request, email: "a@b.c", password: PASSWORD });
    const code = new URL((outcome as { location: string }).location).searchParams.get("code")!;
    const t = await make([rotated, key]).exchangeAuthorizationCode(client, code); // yet another process
    expect(await make([rotated, key]).verifyAccessToken(t.access_token)).toMatchObject({ clientId: client.client_id });
  });
});

describe("codes", () => {
  it("returns the PKCE challenge and exchanges once", async () => {
    const code = await signIn();
    expect(await provider.challengeForAuthorizationCode(client, code)).toBe("CHALLENGE");
    const t = await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT);
    expect(t).toMatchObject({ token_type: "bearer", expires_in: ACCESS_TTL_S });
    await expect(provider.exchangeAuthorizationCode(client, code)).rejects.toThrow(/already been used/);
  });

  it("refuses another client, another redirect, and an expired code", async () => {
    const other = await provider.clientsStore.registerClient!({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    const code = await signIn();
    await expect(provider.exchangeAuthorizationCode(other, code)).rejects.toThrow(InvalidGrantError);
    await expect(provider.exchangeAuthorizationCode(client, code, undefined, "https://evil.example/cb")).rejects.toThrow(InvalidGrantError);
    const late = await signIn();
    clock += CODE_TTL_S;
    await expect(provider.exchangeAuthorizationCode(client, late)).rejects.toThrow(InvalidGrantError);
  });
});

describe("access tokens", () => {
  it("verify to the grant and the Garmin tokens", async () => {
    const t = await tokens();
    const info = await provider.verifyAccessToken(t.access_token);
    expect(info.expiresAt).toBe(clock + ACCESS_TTL_S);
    expect((info.extra as unknown as AccessExtra).tokens).toEqual(SECRET_TOKENS);
  });

  it("stop working when expired or revoked", async () => {
    const t = await tokens();
    await provider.revokeToken!(client, { token: t.refresh_token! });
    await expect(provider.verifyAccessToken(t.access_token)).rejects.toThrow(/disconnected/);
    const u = await tokens();
    clock += ACCESS_TTL_S;
    await expect(provider.verifyAccessToken(u.access_token)).rejects.toThrow(InvalidTokenError);
  });
});

describe("refresh", () => {
  it("refreshes Garmin within the 2 h window and rotates", async () => {
    const t = await tokens();
    let windowSeen = 0;
    const refresh = auth.refresh;
    auth.refresh = async (tk, within) => ((windowSeen = within), refresh(tk, within));
    const next = await provider.exchangeRefreshToken(client, t.refresh_token!);
    expect(windowSeen).toBe(REFRESH_WITHIN_MS);
    const info = await provider.verifyAccessToken(next.access_token);
    expect((info.extra as unknown as AccessExtra).tokens.oauth2.access_token).toBe("REFRESHED-1");
  });

  it("tolerates a racing duplicate within the grace window, revokes a later replay", async () => {
    const t = await tokens();
    await provider.exchangeRefreshToken(client, t.refresh_token!);
    await expect(provider.exchangeRefreshToken(client, t.refresh_token!)).resolves.toBeDefined();
    clock += 61;
    await expect(provider.exchangeRefreshToken(client, t.refresh_token!)).rejects.toThrow(/already used/);
    await expect(provider.verifyAccessToken((await tokens()).access_token)).resolves.toBeDefined(); // a new sign-in still works
  });

  it("disconnects when Garmin says the session is dead", async () => {
    const t = await tokens();
    auth.failRefresh = new GarminAuthError("Refresh token expired; log in again");
    await expect(provider.exchangeRefreshToken(client, t.refresh_token!)).rejects.toThrow(/sign in again/);
    await expect(provider.verifyAccessToken(t.access_token)).rejects.toThrow(/disconnected/);
  });

  it("keeps the connection on a transient Garmin failure, so a retry works", async () => {
    const t = await tokens();
    auth.failRefresh = new GarminAuthError("Not authorized for x (403)");
    await expect(provider.exchangeRefreshToken(client, t.refresh_token!)).rejects.toThrow(ServerError);
    auth.failRefresh = null;
    await expect(provider.exchangeRefreshToken(client, t.refresh_token!)).resolves.toBeDefined();
  });

  it("refuses another client's refresh token", async () => {
    const other = await provider.clientsStore.registerClient!({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    const t = await tokens();
    await expect(provider.exchangeRefreshToken(other, t.refresh_token!)).rejects.toThrow(InvalidGrantError);
  });
});
```

- [ ] **Step 3: Run them to verify they fail.**
Run: `npx vitest run --root mcp tests/http/provider.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement.** Create `mcp/src/http/provider.ts`:

```ts
/**
 * The hosted OAuth 2.1 authorization server, as the MCP SDK's `OAuthServerProvider`. Nothing the
 * client receives is stored: client ids, sign-in form state, codes and tokens are sealed. The
 * grant table only makes codes single-use, rotates refresh tokens, and allows revocation.
 */
import type { Response } from "express";
import { InvalidGrantError, InvalidTokenError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { GarminRateLimitError, type MfaState, type Tokens } from "garminconnect-js";
import { isDeadSession, type GarminAuth } from "./garmin-auth.js";
import { checkGeneration, type GrantStore } from "./grants.js";
import { credentialsPage, errorPage, mfaPage, pageHeaders } from "./pages.js";
import type { Sealer } from "./seal.js";

export const ACCESS_TTL_S = 3600;
export const CODE_TTL_S = 60;
export const FORM_TTL_S = 600;
export const REFRESH_WITHIN_MS = 2 * 3600_000;
export const TOUCH_EVERY_S = 60;

interface AuthRequest {
  clientId: string;
  clientName: string | null;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
}
interface MfaPayload {
  request: AuthRequest;
  mfaState: MfaState;
  disconnectOthers: boolean;
}
interface CodePayload {
  grantId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  tokens: Tokens;
}
interface AccessPayload {
  grantId: string;
  clientId: string;
  tokens: Tokens;
}
interface RefreshPayload extends AccessPayload {
  generation: number;
}
export interface AccessExtra {
  grantId: string;
  tokens: Tokens;
}

export interface ProviderOptions {
  sealer: Sealer;
  grants: GrantStore;
  auth: GarminAuth;
  /** Where the sign-in form posts. */
  signInPath: string;
  now?: () => number;
}

export type SignInOutcome =
  | { kind: "redirect"; location: string }
  | { kind: "page"; status: number; headers: Record<string, string>; body: string };

const EXPIRED = "This sign-in page has expired. Start again from your MCP client (remove and re-add the connector if needed).";

function signInError(error: unknown): string {
  if (error instanceof GarminRateLimitError) return "Garmin is limiting sign-ins right now. Wait a few minutes and try again.";
  return `Sign-in failed: ${error instanceof Error ? error.message : String(error)}`;
}

export class HostedOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  readonly #sealer: Sealer;
  readonly #grants: GrantStore;
  readonly #auth: GarminAuth;
  readonly #signInPath: string;
  readonly #now: () => number;

  constructor(options: ProviderOptions) {
    this.#sealer = options.sealer;
    this.#grants = options.grants;
    this.#auth = options.auth;
    this.#signInPath = options.signInPath;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.clientsStore = {
      getClient: (clientId) => {
        const sealed = this.#sealer.unseal<Omit<OAuthClientInformationFull, "client_id">>("client", clientId);
        return sealed ? { ...sealed.data, client_id: clientId } : undefined;
      },
      // The whole registration (including a confidential client's secret) is sealed into the id.
      registerClient: (client) => {
        const info = { ...client, client_id_issued_at: this.#now() };
        return { ...info, client_id: this.#sealer.seal("client", info) };
      },
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const request: AuthRequest = {
      clientId: client.client_id,
      clientName: client.client_name ?? null,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      ...(params.state !== undefined && { state: params.state }),
    };
    res
      .status(200)
      .set(pageHeaders(params.redirectUri))
      .send(credentialsPage({ action: this.#signInPath, request: this.#sealer.seal("authreq", request, FORM_TTL_S), clientName: request.clientName }));
  }

  /** The sign-in form's POST: credentials, then (if Garmin asks) the MFA code. */
  async handleSignIn(form: Record<string, string | undefined>): Promise<SignInOutcome> {
    const action = this.#signInPath;
    if (form["step"] === "mfa") {
      const sealedMfa = form["mfa"];
      const mfa = this.#sealer.unseal<MfaPayload>("mfa", sealedMfa);
      if (!mfa) return this.#page(undefined, errorPage(EXPIRED), 400);
      const { request, mfaState, disconnectOthers } = mfa.data;
      try {
        const tokens = await this.#auth.resume(mfaState, (form["code"] ?? "").trim());
        return await this.#finish(request, tokens, disconnectOthers);
      } catch (error) {
        return this.#page(request, mfaPage({ action, mfa: sealedMfa!, error: signInError(error) }), 400);
      }
    }

    const sealedRequest = form["request"];
    const unsealed = this.#sealer.unseal<AuthRequest>("authreq", sealedRequest);
    if (!unsealed) return this.#page(undefined, errorPage(EXPIRED), 400);
    const request = unsealed.data;
    const email = (form["email"] ?? "").trim();
    const password = form["password"] ?? "";
    const disconnectOthers = form["disconnectOthers"] === "1";
    const retry = (error: string) =>
      this.#page(request, credentialsPage({ action, request: sealedRequest!, clientName: request.clientName, email, error }), 400);
    if (!email || !password) return retry("Enter your Garmin email (or username) and password.");
    try {
      const result = await this.#auth.login(email, password);
      if (result.state === "mfa_required") {
        const mfa = this.#sealer.seal("mfa", { request, mfaState: result.mfaState, disconnectOthers } satisfies MfaPayload, FORM_TTL_S);
        return this.#page(request, mfaPage({ action, mfa }));
      }
      return await this.#finish(request, result.tokens, disconnectOthers);
    } catch (error) {
      return retry(signInError(error));
    }
  }

  async #finish(request: AuthRequest, tokens: Tokens, disconnectOthers: boolean): Promise<SignInOutcome> {
    const userHash = this.#sealer.pseudonym(await this.#auth.profileId(tokens));
    const grant = this.#grants.create(userHash, request.clientName, this.#now());
    if (disconnectOthers) this.#grants.revokeUser(userHash, grant.grantId);
    const code: CodePayload = { grantId: grant.grantId, clientId: request.clientId, redirectUri: request.redirectUri, codeChallenge: request.codeChallenge, tokens };
    const location = new URL(request.redirectUri);
    location.searchParams.set("code", this.#sealer.seal("code", code, CODE_TTL_S));
    if (request.state !== undefined) location.searchParams.set("state", request.state);
    return { kind: "redirect", location: location.href };
  }

  #page(request: AuthRequest | undefined, body: string, status = 200): SignInOutcome {
    return { kind: "page", status, headers: pageHeaders(request?.redirectUri), body };
  }

  #code(client: OAuthClientInformationFull, code: string): CodePayload {
    const sealed = this.#sealer.unseal<CodePayload>("code", code);
    if (!sealed || sealed.data.clientId !== client.client_id) throw new InvalidGrantError("The authorization code is invalid or has expired");
    return sealed.data;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    return this.#code(client, code).codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string): Promise<OAuthTokens> {
    const payload = this.#code(client, code);
    if (redirectUri !== undefined && redirectUri !== payload.redirectUri) throw new InvalidGrantError("redirect_uri does not match the authorization request");
    if (!this.#grants.activate(payload.grantId, this.#now())) throw new InvalidGrantError("The authorization code has already been used");
    return this.#issue(payload.grantId, client.client_id, 0, payload.tokens);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const sealed = this.#sealer.unseal<RefreshPayload>("refresh", refreshToken);
    if (!sealed || sealed.data.clientId !== client.client_id) throw new InvalidGrantError("The refresh token is invalid");
    const { grantId, generation } = sealed.data;
    const verdict = checkGeneration(this.#grants.get(grantId), generation, this.#now());
    if (verdict === "missing" || verdict === "revoked") throw new InvalidGrantError("This connection was disconnected; sign in again");
    if (verdict === "reused") {
      this.#grants.revoke(grantId);
      throw new InvalidGrantError("This refresh token was already used, so the connection was disconnected for safety; sign in again");
    }
    let tokens: Tokens;
    try {
      tokens = await this.#auth.refresh(sealed.data.tokens, REFRESH_WITHIN_MS);
    } catch (error) {
      if (isDeadSession(error)) {
        this.#grants.revoke(grantId);
        throw new InvalidGrantError("Your Garmin session has ended; sign in again");
      }
      throw new ServerError("Garmin could not refresh the session right now; try again shortly");
    }
    const rotated = this.#grants.rotate(grantId, generation, this.#now());
    if (!rotated.ok) throw new InvalidGrantError("This connection was disconnected; sign in again");
    return this.#issue(grantId, client.client_id, rotated.generation, tokens);
  }

  #issue(grantId: string, clientId: string, generation: number, tokens: Tokens): OAuthTokens {
    return {
      access_token: this.#sealer.seal("access", { grantId, clientId, tokens } satisfies AccessPayload, ACCESS_TTL_S),
      token_type: "bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: this.#sealer.seal("refresh", { grantId, clientId, generation, tokens } satisfies RefreshPayload),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const sealed = this.#sealer.unseal<AccessPayload>("access", token);
    if (!sealed || sealed.exp === undefined) throw new InvalidTokenError("The access token is invalid or has expired");
    const grant = this.#grants.get(sealed.data.grantId);
    if (grant?.state !== "active") throw new InvalidTokenError("This connection was disconnected");
    const now = this.#now();
    if (now - grant.lastUsed >= TOUCH_EVERY_S) this.#grants.touch(grant.grantId, now);
    const extra: AccessExtra = { grantId: grant.grantId, tokens: sealed.data.tokens };
    return { token, clientId: sealed.data.clientId, scopes: [], expiresAt: sealed.exp, extra: { ...extra } };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const found =
      this.#sealer.unseal<AccessPayload>("access", request.token) ?? this.#sealer.unseal<RefreshPayload>("refresh", request.token);
    if (found && found.data.clientId === client.client_id) this.#grants.revoke(found.data.grantId);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass.**
Run: `npx vitest run --root mcp tests/http/provider.test.ts`
Expected: PASS. If `registerClient!({…})` fails to typecheck because `OAuthClientMetadata` needs more fields, add the fields the type error names (e.g. `grant_types: ["authorization_code", "refresh_token"]`) in the test's calls. Don't loosen the provider.

- [ ] **Step 6: Typecheck and commit.**
Run: `npm run typecheck -w mcp`
Expected: PASS.

```bash
git add mcp/src/http/provider.ts mcp/tests/http/fakes.ts mcp/tests/http/provider.test.ts
git commit -m "feat(mcp): stateless-secret OAuth provider for the hosted server" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 10: Express app and the end-to-end flow test

**Files:**
- Modify: `mcp/package.json` (devDependencies only)
- Create: `mcp/src/http/app.ts`, `mcp/tests/http/oauth-dance.ts`
- Test: `mcp/tests/http/flow.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–9.
- Produces:

```ts
export interface HttpAppDeps {
  publicUrl: URL; sealer: Sealer; grants: GrantStore; auth: GarminAuth; mcp: McpConfig; version: string;
  trustProxy?: boolean;
  garminClient?: Omit<GarminClientOptions, "tokenStore">;  // tests inject fetchImpl
  log?: (line: Record<string, unknown>) => void;
  now?: () => number;
}
export function createHttpApp(deps: HttpAppDeps): Express;
```
- `oauth-dance.ts` (also used by the Task 12 smoke script):

```ts
export function pkce(): { verifier: string; challenge: string };
export function register(base: string, redirectUri: string): Promise<string>;
export function authorizePage(base: string, clientId: string, redirectUri: string, challenge: string, state?: string): Promise<string>;
export function postSignIn(base: string, fields: Record<string, string>, headers?: Record<string, string>): Promise<Response>;
export function tokenRequest(base: string, fields: Record<string, string>): Promise<Response>;
export function signIn(base: string, o: { email: string; password: string; mfaCode?: () => Promise<string>; redirectUri?: string }): Promise<{ clientId: string; accessToken: string; refreshToken: string }>;
export function mcpClient(base: string, accessToken: string): Promise<Client>;
```

- [ ] **Step 1: Add the build-time dependencies.**
Run: `npm install -D -w mcp express@^5.2.1 express-rate-limit@^8.2.1 @types/express@^5`
Expected: `mcp/package.json` `devDependencies` gains the three entries; `dependencies` is unchanged. Run `npx vitest run tests/mcp-package.test.ts` from the root. Expected: PASS.

- [ ] **Step 2: Write the OAuth helper.** Create `mcp/tests/http/oauth-dance.ts`:

```ts
/** A scripted MCP-client side of the OAuth flow, for the flow test and the live smoke script. */
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const REDIRECT = "http://127.0.0.1/callback";

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

const hiddenField = (page: string, name: string) => new RegExp(`name="${name}" value="([^"]*)"`).exec(page)?.[1];

export async function register(base: string, redirectUri = REDIRECT): Promise<string> {
  const res = await fetch(`${base}/mcp/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "test client", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  });
  if (res.status !== 201) throw new Error(`register: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { client_id: string }).client_id;
}

export async function authorizePage(base: string, clientId: string, redirectUri: string, challenge: string, state = "st"): Promise<string> {
  const url = new URL(`${base}/mcp/oauth/authorize`);
  url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state }).toString();
  const res = await fetch(url);
  if (res.status !== 200) throw new Error(`authorize: ${res.status} ${await res.text()}`);
  return res.text();
}

export const postSignIn = (base: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  fetch(`${base}/mcp/oauth/signin`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields) });

export const tokenRequest = (base: string, fields: Record<string, string>) =>
  fetch(`${base}/mcp/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });

export async function signIn(base: string, o: { email: string; password: string; mfaCode?: () => Promise<string>; redirectUri?: string }) {
  const redirectUri = o.redirectUri ?? REDIRECT;
  const clientId = await register(base, redirectUri);
  const { verifier, challenge } = pkce();
  const page = await authorizePage(base, clientId, redirectUri, challenge);
  let res = await postSignIn(base, { step: "credentials", request: hiddenField(page, "request")!, email: o.email, password: o.password });
  if (res.status !== 302) {
    const mfa = hiddenField(await res.text(), "mfa");
    if (!mfa || !o.mfaCode) throw new Error(`sign-in did not redirect (HTTP ${res.status})`);
    res = await postSignIn(base, { step: "mfa", mfa, code: await o.mfaCode() });
    if (res.status !== 302) throw new Error(`MFA did not redirect (HTTP ${res.status})`);
  }
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
  const t = await tokenRequest(base, { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri });
  if (t.status !== 200) throw new Error(`token: ${t.status} ${await t.text()}`);
  const body = (await t.json()) as { access_token: string; refresh_token: string };
  return { clientId, accessToken: body.access_token, refreshToken: body.refresh_token };
}

export async function mcpClient(base: string, accessToken: string): Promise<Client> {
  const client = new Client({ name: "oauth-dance", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }));
  return client;
}
```

- [ ] **Step 3: Write the failing flow test.** Create `mcp/tests/http/flow.test.ts`:

```ts
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpApp } from "../../src/http/app.js";
import { MemoryGrantStore, SqliteGrantStore, type GrantStore } from "../../src/http/grants.js";
import { Sealer } from "../../src/http/seal.js";
import { fakeFetch, json, PROFILE_ROUTE, testConfig, textOf } from "../helpers.js";
import { fakeAuth, MFA_CODE, PASSWORD, SECRET_TOKENS } from "./fakes.js";
import { authorizePage, mcpClient, pkce, postSignIn, register, REDIRECT, signIn, tokenRequest } from "./oauth-dance.js";

const sqliteAvailable = await import("node:sqlite").then(() => true, () => false);
const servers: http.Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start(o: { grants?: GrantStore; routes?: Parameters<typeof fakeFetch>[0]; trustProxy?: boolean } = {}) {
  const server = http.createServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const grants = o.grants ?? new MemoryGrantStore();
  const { fetchImpl } = fakeFetch(o.routes ?? PROFILE_ROUTE);
  server.on("request", createHttpApp({
    publicUrl: new URL(base), sealer: new Sealer([randomBytes(32)]), grants, auth: fakeAuth(), mcp: testConfig(),
    version: "test", trustProxy: o.trustProxy, garminClient: { fetchImpl, retries: 0 }, log: () => {},
  }));
  return { base, grants };
}

describe("hosted MCP over HTTP", () => {
  it("answers health checks, and 405 for GET/DELETE /mcp", async () => {
    const { base } = await start();
    expect(await (await fetch(`${base}/mcp/healthz`)).text()).toBe("ok");
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
    expect((await fetch(`${base}/mcp`, { method: "DELETE" })).status).toBe(405);
  });

  it("challenges an unauthenticated client and publishes discovery metadata", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);
    const prm = (await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json()) as Record<string, unknown>;
    expect(prm).toMatchObject({ resource: `${base}/mcp`, authorization_servers: [`${base}/`] });
    const as = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(as).toMatchObject({
      authorization_endpoint: `${base}/mcp/oauth/authorize`,
      token_endpoint: `${base}/mcp/oauth/token`,
      registration_endpoint: `${base}/mcp/oauth/register`,
      revocation_endpoint: `${base}/mcp/oauth/revoke`,
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("signs in, lists the hosted tools and runs one", async () => {
    const { base } = await start();
    const { accessToken } = await signIn(base, { email: "a@b.c", password: PASSWORD });
    const client = await mcpClient(base, accessToken);
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name)).not.toContain("sign_in_to_garmin");
    expect(tools.find((t) => t.name === "import_activity")?.inputSchema.properties).toHaveProperty("content");
    expect(textOf(await client.callTool({ name: "get_user_profile", arguments: {} }))).toContain("abc-display");
    await client.close();
  });

  it("completes an MFA sign-in", async () => {
    const { base } = await start();
    const { accessToken } = await signIn(base, { email: "mfa@b.c", password: PASSWORD, mfaCode: async () => MFA_CODE });
    expect(accessToken).toBeTruthy();
  });

  it("rejects a wrong PKCE verifier and a reused code", async () => {
    const { base } = await start();
    const clientId = await register(base);
    const { verifier, challenge } = pkce();
    const page = await authorizePage(base, clientId, REDIRECT, challenge);
    const request = /name="request" value="([^"]*)"/.exec(page)![1]!;
    const res = await postSignIn(base, { step: "credentials", request, email: "a@b.c", password: PASSWORD });
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
    const fields = { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT };
    expect((await tokenRequest(base, { ...fields, code_verifier: pkce().verifier })).status).toBe(400);
    expect((await tokenRequest(base, { ...fields, code_verifier: verifier })).status).toBe(200);
    expect((await tokenRequest(base, { ...fields, code_verifier: verifier })).status).toBe(400);
  });

  it("rotates refresh tokens and disconnects on a late replay", async () => {
    const { base } = await start();
    const first = await signIn(base, { email: "a@b.c", password: PASSWORD });
    const refresh = (token: string) => tokenRequest(base, { grant_type: "refresh_token", refresh_token: token, client_id: first.clientId });
    const second = (await (await refresh(first.refreshToken)).json()) as { access_token: string; refresh_token: string };
    expect((await mcpClient(base, second.access_token)).getServerVersion()?.name).toBe("garminconnect-mcp");
    await refresh(second.refresh_token); // generation 2: the first refresh token is now two behind
    expect((await refresh(first.refreshToken)).status).toBe(400);
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${second.access_token}`, "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
  });

  it("disconnects when Garmin rejects the session during a tool call", async () => {
    const { base } = await start({ routes: { "GET /userprofile-service/socialProfile": () => json({ message: "no" }, 401) } });
    const { accessToken } = await signIn(base, { email: "a@b.c", password: PASSWORD });
    const client = await mcpClient(base, accessToken);
    const result = await client.callTool({ name: "get_user_profile", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/reconnect the Garmin connector/);
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
  });

  it("rate-limits sign-in per real client IP behind a proxy", async () => {
    const { base } = await start({ trustProxy: true });
    const attempt = (ip: string) => postSignIn(base, { step: "credentials", request: "x", email: "a", password: "b" }, { "x-forwarded-for": ip });
    for (let i = 0; i < 5; i++) expect((await attempt("203.0.113.1")).status).toBe(400);
    expect((await attempt("203.0.113.1")).status).toBe(429);
    expect((await attempt("203.0.113.2")).status).toBe(400);
  });

  it.skipIf(!sqliteAvailable)("never writes Garmin tokens, emails or passwords to the database", async () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), "flow-")), "grants.db");
    const grants = await SqliteGrantStore.open(file);
    const { base } = await start({ grants });
    const email = "secret-email@example.com";
    const { accessToken } = await signIn(base, { email, password: PASSWORD });
    await (await mcpClient(base, accessToken)).callTool({ name: "get_user_profile", arguments: {} });
    grants.close();
    const bytes = [file, `${file}-wal`].filter(existsSync).map((f) => readFileSync(f).toString("latin1")).join("");
    for (const secret of [email, PASSWORD, SECRET_TOKENS.oauth1.oauth_token_secret, SECRET_TOKENS.oauth2.access_token, SECRET_TOKENS.oauth2.refresh_token]) {
      expect(bytes).not.toContain(secret);
    }
  });
});
```

- [ ] **Step 4: Run it to verify it fails.**
Run: `npx vitest run --root mcp tests/http/flow.test.ts`
Expected: FAIL, `../../src/http/app.js` not found.

- [ ] **Step 5: Implement.** Create `mcp/src/http/app.ts`:

```ts
/**
 * The hosted server's HTTP surface. Traefik sends it `/mcp…` and the two OAuth `/.well-known`
 * documents. The OAuth endpoints are the SDK's own handlers, mounted under /mcp/oauth (the SDK's
 * all-in-one router would put them at the domain root, which belongs to another app).
 */
import express, { type Express, type Request, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { authorizationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { clientRegistrationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/register.js";
import { revocationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/revoke.js";
import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { mcpAuthMetadataRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { GarminClientOptions } from "garminconnect-js";
import { buildTools, serverForTools, type ServerDeps } from "../server.js";
import type { McpConfig } from "../session.js";
import { HOSTED_TOOL_FACTORIES } from "../tools.js";
import { isDeadSession, type GarminAuth } from "./garmin-auth.js";
import type { GrantStore } from "./grants.js";
import { inlineFiles } from "./inline-files.js";
import { errorPage, pageHeaders } from "./pages.js";
import { HostedOAuthProvider, type AccessExtra } from "./provider.js";
import { requestSession } from "./request-session.js";
import type { Sealer } from "./seal.js";

export interface HttpAppDeps {
  publicUrl: URL;
  sealer: Sealer;
  grants: GrantStore;
  auth: GarminAuth;
  mcp: McpConfig;
  version: string;
  trustProxy?: boolean;
  garminClient?: Omit<GarminClientOptions, "tokenStore">;
  log?: (line: Record<string, unknown>) => void;
  now?: () => number;
}

const DOCS = "https://github.com/DynamicsNinja/garminconnect-js/tree/main/mcp#readme";
const SIGN_IN_PATH = "/mcp/oauth/signin";

const accessOf = (req: Request): AccessExtra => {
  const extra = req.auth?.extra as AccessExtra | undefined;
  if (!extra) throw new Error("request reached /mcp without authentication");
  return extra;
};

/** Only the JSON-RPC method and tool name are logged: never arguments, results or tokens. */
function describeRpc(body: unknown): { rpc?: string; tool?: string } {
  const msg = Array.isArray(body) ? body[0] : body;
  if (typeof msg !== "object" || msg === null) return {};
  const { method, params } = msg as { method?: unknown; params?: { name?: unknown } };
  return {
    ...(typeof method === "string" && { rpc: method }),
    ...(method === "tools/call" && typeof params?.name === "string" && { tool: params.name }),
  };
}

export function createHttpApp(deps: HttpAppDeps): Express {
  const base = new URL(deps.publicUrl.origin);
  const at = (p: string) => new URL(p, base).href;
  const log = deps.log ?? ((line) => console.log(JSON.stringify({ t: new Date().toISOString(), ...line })));
  const provider = new HostedOAuthProvider({ sealer: deps.sealer, grants: deps.grants, auth: deps.auth, signInPath: SIGN_IN_PATH, now: deps.now });
  const metadata: OAuthMetadata = {
    issuer: base.href,
    service_documentation: DOCS,
    authorization_endpoint: at("/mcp/oauth/authorize"),
    token_endpoint: at("/mcp/oauth/token"),
    registration_endpoint: at("/mcp/oauth/register"),
    revocation_endpoint: at("/mcp/oauth/revoke"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    revocation_endpoint_auth_methods_supported: ["client_secret_post"],
  };

  const session = requestSession(deps.garminClient);
  const serverDeps: ServerDeps = { config: deps.mcp, session, version: deps.version, files: inlineFiles };
  const tools = buildTools(serverDeps, HOSTED_TOOL_FACTORIES);

  const app = express();
  app.disable("x-powered-by");
  if (deps.trustProxy) app.set("trust proxy", 1);

  app.get("/mcp/healthz", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata: metadata,
      resourceServerUrl: new URL("/mcp", base),
      resourceName: "Garmin Connect (unofficial)",
      serviceDocumentationUrl: new URL(DOCS),
    }),
  );
  app.use("/mcp/oauth/authorize", authorizationHandler({ provider, rateLimit: { windowMs: 60_000, limit: 60 } }));
  app.use("/mcp/oauth/token", tokenHandler({ provider, rateLimit: { windowMs: 60_000, limit: 30 } }));
  app.use(
    "/mcp/oauth/register",
    clientRegistrationHandler({ clientsStore: provider.clientsStore, clientIdGeneration: false, rateLimit: { windowMs: 3_600_000, limit: 10 } }),
  );
  app.use("/mcp/oauth/revoke", revocationHandler({ provider }));

  // Five tries per IP per 15 min also protects the server IP's standing with Garmin's login rate limits.
  const signInLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).set(pageHeaders()).send(errorPage("Too many sign-in attempts from your network. Wait 15 minutes and try again."));
    },
  });
  app.post(SIGN_IN_PATH, signInLimit, express.urlencoded({ extended: false, limit: "16kb" }), async (req, res) => {
    const outcome = await provider.handleSignIn((req.body ?? {}) as Record<string, string | undefined>);
    if (outcome.kind === "redirect") res.redirect(302, outcome.location);
    else res.status(outcome.status).set(outcome.headers).send(outcome.body);
  });

  const bearer = requireBearerAuth({ verifier: provider, resourceMetadataUrl: at("/.well-known/oauth-protected-resource/mcp") });
  const perGrant = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false, keyGenerator: (req) => accessOf(req).grantId });
  const handleMcp: RequestHandler = async (req, res) => {
    const { grantId, tokens } = accessOf(req);
    const started = Date.now();
    const server = serverForTools(tools, serverDeps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    res.on("finish", () => log({ grant: grantId.slice(0, 8), ...describeRpc(req.body), status: res.statusCode, ms: Date.now() - started }));
    await server.connect(transport);
    const onRejected = (error: unknown) => {
      if (isDeadSession(error)) deps.grants.revoke(grantId);
    };
    await session.run({ grantId, tokens, onRejected }, () => transport.handleRequest(req, res, req.body));
  };
  app.post("/mcp", bearer, perGrant, express.json({ limit: "15mb" }), handleMcp);

  const notAllowed: RequestHandler = (_req, res) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  };
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
  return app;
}
```

- [ ] **Step 6: Run the flow test.**
Run: `npx vitest run --root mcp tests/http/flow.test.ts`
Expected: PASS (the database-bytes test skips on Node < 22.13).

If `"disconnects when Garmin rejects the session during a tool call"` fails because the tool ran without the request's tokens (`No Garmin connection for this request`), then `AsyncLocalStorage` isn't reaching the SDK's handler. In that case, replace the per-request `serverForTools(tools, …)` with `createServer({ ...serverDeps, session: perRequestSession }, HOSTED_TOOL_FACTORIES)`, where `perRequestSession` is a plain `Session` closed over this request's `tokens`/`onRejected`. Keep the test unchanged.

If the express-rate-limit `keyGenerator` option or `limit` name is rejected by its types, read `node_modules/express-rate-limit/dist/index.d.ts` and use the names it declares.

- [ ] **Step 7: Full mcp gate and commit.**
Run: `npm run typecheck -w mcp; npm test -w mcp; npm run lint`
Expected: PASS.

```bash
git add mcp/package.json package-lock.json mcp/src/http/app.ts mcp/tests/http/oauth-dance.ts mcp/tests/http/flow.test.ts
git commit -m "feat(mcp): hosted streamable-HTTP server with OAuth under /mcp" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 11: Entry point, bundle, Docker image, CI

**Files:**
- Create: `mcp/src/http/config.ts`, `mcp/src/http/main.ts`, `mcp/Dockerfile`, `.dockerignore`
- Modify: `mcp/tsup.config.ts`, `.gitignore`, `.github/workflows/ci.yml`
- Test: `mcp/tests/http/config.test.ts`, `mcp/tests/http/dist-http.test.ts`

**Interfaces:**
- Produces: `loadHostedConfig(env?): HostedConfig` where `HostedConfig = { publicUrl: URL; keys: Buffer[]; dbPath: string; port: number; trustProxy: boolean; mcp: McpConfig }`. The bundle is `mcp/dist-http/http.mjs`: `node http.mjs` serves, `node http.mjs revoke <grant_id>|--all` revokes.

- [ ] **Step 1: Write the failing config test.** Create `mcp/tests/http/config.test.ts`:

```ts
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadHostedConfig } from "../../src/http/config.js";

const KEY = randomBytes(32).toString("base64");
const env = (extra: Record<string, string> = {}) => ({ PUBLIC_URL: "https://garmin.ficdev.xyz", SEAL_KEYS: KEY, DB_PATH: "/data/grants.db", ...extra });

describe("loadHostedConfig", () => {
  it("reads the required settings and defaults the rest", () => {
    const c = loadHostedConfig(env());
    expect(c.publicUrl.href).toBe("https://garmin.ficdev.xyz/");
    expect(c.keys).toHaveLength(1);
    expect(c).toMatchObject({ dbPath: "/data/grants.db", port: 3000, trustProxy: false });
    expect(c.mcp.enableGraphql).toBe(false);
  });

  it("honours PORT, TRUST_PROXY and the tool settings", () => {
    const c = loadHostedConfig(env({ PORT: "8080", TRUST_PROXY: "1", GARMIN_MCP_ENABLE_GRAPHQL: "true" }));
    expect(c).toMatchObject({ port: 8080, trustProxy: true });
    expect(c.mcp.enableGraphql).toBe(true);
  });

  it("allows plain http only for localhost", () => {
    expect(loadHostedConfig(env({ PUBLIC_URL: "http://127.0.0.1:3000" })).publicUrl.port).toBe("3000");
    expect(() => loadHostedConfig(env({ PUBLIC_URL: "http://garmin.ficdev.xyz" }))).toThrow(/https/);
  });

  it("names what is missing", () => {
    expect(() => loadHostedConfig({ SEAL_KEYS: KEY, DB_PATH: "/d" })).toThrow(/PUBLIC_URL/);
    expect(() => loadHostedConfig({ PUBLIC_URL: "https://x.y", DB_PATH: "/d" })).toThrow(/SEAL_KEYS/);
    expect(() => loadHostedConfig({ PUBLIC_URL: "https://x.y", SEAL_KEYS: KEY })).toThrow(/DB_PATH/);
    expect(() => loadHostedConfig(env({ PORT: "abc" }))).toThrow(/PORT/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**
Run: `npx vitest run --root mcp tests/http/config.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement config and main.** Create `mcp/src/http/config.ts`:

```ts
import { loadConfig, type McpConfig } from "../session.js";
import { parseSealKeys } from "./seal.js";

export interface HostedConfig {
  publicUrl: URL;
  keys: Buffer[];
  dbPath: string;
  port: number;
  trustProxy: boolean;
  /** Tool settings shared with stdio: GARMIN_MCP_GROUPS, GARMIN_MCP_ENABLE_GRAPHQL. */
  mcp: McpConfig;
}

export function loadHostedConfig(env: Record<string, string | undefined> = process.env): HostedConfig {
  const rawUrl = env["PUBLIC_URL"]?.trim();
  if (!rawUrl) throw new Error("PUBLIC_URL is not set (e.g. https://garmin.ficdev.xyz)");
  const publicUrl = new URL(rawUrl);
  const local = publicUrl.hostname === "localhost" || publicUrl.hostname === "127.0.0.1";
  if (publicUrl.protocol !== "https:" && !local) throw new Error("PUBLIC_URL must be https (plain http is allowed only for localhost)");
  const keys = parseSealKeys(env["SEAL_KEYS"]);
  const dbPath = env["DB_PATH"]?.trim();
  if (!dbPath) throw new Error("DB_PATH is not set (e.g. /data/grants.db)");
  const port = Number(env["PORT"] ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`PORT must be a port number, got ${env["PORT"]}`);
  return { publicUrl, keys, dbPath, port, trustProxy: env["TRUST_PROXY"] === "1", mcp: loadConfig(env) };
}
```

Create `mcp/src/http/main.ts`:

```ts
/**
 * The hosted server process (Docker: `node http.mjs`).
 *   node http.mjs                     serve
 *   node http.mjs revoke <grant_id>   disconnect one connection
 *   node http.mjs revoke --all        disconnect everyone
 */
import { describeError } from "../errors.js";
import { loadHostedConfig } from "./config.js";
import { createHttpApp } from "./app.js";
import { garminAuth } from "./garmin-auth.js";
import { SqliteGrantStore } from "./grants.js";
import { Sealer } from "./seal.js";

const version = __MCP_VERSION__;
const now = () => Math.floor(Date.now() / 1000);
const log = (line: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), ...line }));

try {
  const config = loadHostedConfig();
  const grants = await SqliteGrantStore.open(config.dbPath);

  if (process.argv[2] === "revoke") {
    const target = process.argv[3];
    if (!target) {
      console.error("usage: node http.mjs revoke <grant_id> | --all");
      process.exit(2);
    }
    const n = target === "--all" ? grants.revokeAll() : Number(grants.revoke(target));
    console.log(`Revoked ${n} connection(s).`);
    grants.close();
    process.exit(0);
  }

  const purged = grants.purge(now());
  setInterval(() => log({ msg: "purge", purged: grants.purge(now()) }), 86_400_000).unref();
  const app = createHttpApp({ publicUrl: config.publicUrl, sealer: new Sealer(config.keys), grants, auth: garminAuth(), mcp: config.mcp, version, trustProxy: config.trustProxy, log });
  const server = app.listen(config.port, "0.0.0.0", () => log({ msg: "listening", port: config.port, version, purged, ...grants.count() }));
  const stop = () => server.close(() => {
    grants.close();
    process.exit(0);
  });
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} catch (error) {
  console.error(describeError(error));
  process.exit(1);
}
```

- [ ] **Step 4: Run the config test.**
Run: `npx vitest run --root mcp tests/http/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the bundle.** Append a third entry to the array in `mcp/tsup.config.ts`:

```ts
  {
    // The hosted server (mcp/Dockerfile): everything inlined like the extension bundle, so the
    // runtime image needs no node_modules. Node 22 for node:sqlite (esbuild leaves node: imports external).
    entry: { http: "src/http/main.ts" },
    outDir: "dist-http",
    format: ["esm"],
    target: "node22",
    platform: "node",
    clean: true,
    sourcemap: false,
    define: { __MCP_VERSION__: JSON.stringify(version) },
    noExternal: [/.*/],
    outExtension: () => ({ js: ".mjs" }),
    banner: { js: "import { createRequire as __gcCreateRequire } from 'node:module'; const require = __gcCreateRequire(import.meta.url);" },
    esbuildOptions(options) {
      options.legalComments = "eof";
    },
  },
```

Add `mcp/dist-http/` to `.gitignore` next to `mcp/dist-bundle/`.

- [ ] **Step 6: Write the bundle test.** Create `mcp/tests/http/dist-http.test.ts`:

```ts
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `npm run check -w mcp` builds before it tests; a bare vitest run without a build skips.
const BUNDLE = fileURLToPath(new URL("../../dist-http/http.mjs", import.meta.url));
const sqliteAvailable = await import("node:sqlite").then(() => true, () => false);

describe.skipIf(!existsSync(BUNDLE) || !sqliteAvailable)("built hosted server", () => {
  it("starts from the single bundle and answers its health check", async () => {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const child = spawn(process.execPath, [BUNDLE], {
      env: { PATH: process.env["PATH"], PUBLIC_URL: `http://127.0.0.1:${port}`, PORT: String(port), SEAL_KEYS: randomBytes(32).toString("base64"), DB_PATH: path.join(mkdtempSync(path.join(os.tmpdir(), "dist-http-")), "g.db") },
      stdio: "ignore",
    });
    try {
      let body = "";
      for (let i = 0; i < 50 && body !== "ok"; i++) {
        await new Promise((r) => setTimeout(r, 100));
        body = await fetch(`http://127.0.0.1:${port}/mcp/healthz`).then((r) => r.text(), () => "");
      }
      expect(body).toBe("ok");
    } finally {
      child.kill();
    }
  }, 15_000);
});
```

- [ ] **Step 7: Build and run.**
Run: `npm run build -w mcp; npx vitest run --root mcp tests/http/dist-http.test.ts`
Expected: the build writes `mcp/dist-http/http.mjs`. The test PASSes, or reports skipped on Node < 22.13.

- [ ] **Step 8: Docker.** Create `.dockerignore` at the repo root:

```
.git
**/node_modules
dist
mcp/dist
mcp/dist-bundle
mcp/dist-mcpb
mcp/dist-http
tokens
tokens-real
export
.env
.env.*
.superpowers
*.log
```

Create `mcp/Dockerfile`:

```dockerfile
# The hosted MCP server (garmin.ficdev.xyz/mcp). Build from the REPO ROOT — the server inlines the
# library's ../src at build time:  docker build -f mcp/Dockerfile .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY mcp/package.json mcp/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build -w mcp

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/mcp/dist-http/http.mjs ./http.mjs
# A named volume copies this ownership on first use; a bind mount must be writable by uid 1000.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/mcp/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "http.mjs"]
```

If Docker is available locally, run: `docker build -f mcp/Dockerfile -t garminconnect-mcp-http .`
Expected: the build succeeds. If Docker isn't available, rely on the CI job below, and say so in the commit message body.

- [ ] **Step 9: CI job.** Append to `.github/workflows/ci.yml` under `jobs:`:

```yaml
  docker:
    # The hosted MCP server's image: it must build from a clean checkout and come up healthy.
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - run: docker build -f mcp/Dockerfile -t garminconnect-mcp-http .
      - name: Starts and answers its health check
        run: |
          docker run -d --name mcp -p 3000:3000 -e PUBLIC_URL=http://127.0.0.1:3000 \
            -e SEAL_KEYS="$(openssl rand -base64 32)" -e DB_PATH=/data/grants.db garminconnect-mcp-http
          for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3000/mcp/healthz && exit 0; sleep 1; done
          docker logs mcp; exit 1
```

- [ ] **Step 10: Full gate and commit.**
Run: `npm run check`
Expected: PASS.

```bash
git add mcp/src/http/config.ts mcp/src/http/main.ts mcp/tsup.config.ts mcp/tests/http/config.test.ts mcp/tests/http/dist-http.test.ts mcp/Dockerfile .dockerignore .gitignore .github/workflows/ci.yml
git commit -m "feat(mcp): hosted server entry point, single-file bundle and Docker image" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

After pushing, check that the CI `docker` job is green: `gh run watch` (or `gh run list --limit 1`).

---

### Task 12: Live smoke test (`npm run smoke:http`)

**Files:**
- Create: `mcp/scripts/smoke-http.ts`
- Modify: root `package.json` (`scripts`)

**Interfaces:**
- Consumes: `createHttpApp`, `garminAuth`, `MemoryGrantStore`, `Sealer`, `oauth-dance.ts`.

- [ ] **Step 1: Write the script.** Create `mcp/scripts/smoke-http.ts`:

```ts
/**
 * The hosted server end to end against the TEST account: a real Garmin sign-in through the
 * sign-in form, PKCE token exchange, tools over streamable HTTP, a workout round trip, refresh,
 * revocation. Runs the server in-process on 127.0.0.1 with an in-memory grant store.
 *
 *   npm run smoke:http        (needs GARMIN_EMAIL, GARMIN_PASSWORD, GARMIN_TEST_PROFILE_ID in .env)
 */
import "../../scripts/load-env.js";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline/promises";
import { createHttpApp } from "../src/http/app.js";
import { garminAuth } from "../src/http/garmin-auth.js";
import { MemoryGrantStore } from "../src/http/grants.js";
import { Sealer } from "../src/http/seal.js";
import { loadConfig } from "../src/session.js";
import { mcpClient, signIn, tokenRequest } from "../tests/http/oauth-dance.js";

const { GARMIN_EMAIL: email, GARMIN_PASSWORD: password, GARMIN_TEST_PROFILE_ID: expected } = process.env;
if (!email || !password || !expected) {
  console.error("Refusing to run: GARMIN_EMAIL, GARMIN_PASSWORD and GARMIN_TEST_PROFILE_ID must be set. Nothing was written.");
  process.exit(1);
}

const app = createHttpApp({ publicUrl: new URL("http://127.0.0.1"), sealer: new Sealer([randomBytes(32)]), grants: new MemoryGrantStore(), auth: garminAuth(), mcp: loadConfig({}), version: "smoke", log: () => {} });
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
// The metadata advertises PUBLIC_URL; this run talks to the port directly, so only the endpoints matter.

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const text = (r: unknown) => (r as { content: { text?: string }[] }).content.map((c) => c.text ?? "").join("\n");

try {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const session = await signIn(base, { email, password, mfaCode: () => rl.question("Garmin MFA code: ") });
  rl.close();
  check("signed in through the form and exchanged the code", Boolean(session.accessToken));

  const client = await mcpClient(base, session.accessToken);
  const profile = JSON.parse(text(await client.callTool({ name: "get_user_profile", arguments: {} }))) as { profileId: unknown };
  // SAFETY GATE: identical to every other write script here. Nothing below runs on another account.
  if (String(profile.profileId) !== String(expected)) {
    console.error(`Refusing to continue: profile ${String(profile.profileId)} is not the test account. Nothing was written.`);
    process.exit(1);
  }
  check("tools run with the sealed Garmin session", true, `profile ${String(profile.profileId)}`);

  const spec = { name: `http smoke ${new Date().toISOString()}`, sport: "running", steps: [{ type: "warmup", lapButton: true }, { type: "cooldown", time: 300 }] };
  const created = text(await client.callTool({ name: "create_workout", arguments: { spec } }));
  const workoutId = /Created workout (\d+)/.exec(created)?.[1];
  check("create_workout over HTTP", workoutId !== undefined, created.split("\n")[0]);
  if (workoutId) {
    const stored = JSON.parse(text(await client.callTool({ name: "get_workout_by_id", arguments: { workoutId } }))) as { workoutName?: string };
    check("read the stored workout back", stored.workoutName === spec.name);
    await client.callTool({ name: "delete_workout", arguments: { workoutId } });
  }
  await client.close();

  const refreshed = await tokenRequest(base, { grant_type: "refresh_token", refresh_token: session.refreshToken, client_id: session.clientId });
  const next = (await refreshed.json()) as { access_token?: string; refresh_token?: string };
  check("refresh issued new tokens", refreshed.status === 200 && Boolean(next.access_token));
  const again = await mcpClient(base, next.access_token!);
  check("the refreshed access token works", !(await again.callTool({ name: "get_user_profile", arguments: {} })).isError);
  await again.close();

  await fetch(`${base}/mcp/oauth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: next.refresh_token!, client_id: session.clientId }) });
  const after = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${next.access_token!}`, "content-type": "application/json" }, body: "{}" });
  check("revocation disconnects the access token", after.status === 401, String(after.status));
} finally {
  server.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

In root `package.json` `scripts`, add after `"smoke:mcp"`:

```json
    "smoke:http": "tsx --tsconfig mcp/tsconfig.json mcp/scripts/smoke-http.ts",
```

- [ ] **Step 2: Typecheck and lint.**
Run: `npm run typecheck -w mcp; npm run lint`
Expected: PASS.

- [ ] **Step 3: Run it live (the maintainer's call: it signs in to Garmin, writes and deletes one workout on the test account).**
Ask the user before running. Then: `npm run smoke:http`
Expected: every line `PASS`, ending `All checks passed.` If Garmin rate-limits the login (HTTP 429), wait and retry later. Don't loop.

- [ ] **Step 4: Commit.**

```bash
git add mcp/scripts/smoke-http.ts package.json
git commit -m "test(mcp): live smoke test for the hosted server" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 13: Deploy step and docs

**Files:**
- Modify: `.github/workflows/publish.yml`, `mcp/README.md`, `mcp/PRIVACY.md`, `AGENTS.md` (§9), `README.md`, `docs/superpowers/specs/2026-10-07-hosted-mcp-design.md`
- Create: `mcp/HOSTING.md`

- [ ] **Step 1: The deploy step.** Append to the `steps:` of `publish.yml`:

```yaml
      # The hosted server at garmin.ficdev.xyz/mcp ships with the release. Dokploy builds the
      # configured branch (main), so tag a commit on main. Skipped until the secrets exist.
      - name: Deploy the hosted MCP server (Dokploy)
        env:
          DOKPLOY_URL: ${{ secrets.DOKPLOY_URL }}
          DOKPLOY_API_KEY: ${{ secrets.DOKPLOY_API_KEY }}
          DOKPLOY_APPLICATION_ID: ${{ secrets.DOKPLOY_APPLICATION_ID }}
        run: |
          if [ -z "$DOKPLOY_URL" ] || [ -z "$DOKPLOY_API_KEY" ] || [ -z "$DOKPLOY_APPLICATION_ID" ]; then
            echo "Dokploy secrets not set; skipping the hosted deploy."; exit 0
          fi
          curl -fsS -X POST "$DOKPLOY_URL/api/application.deploy" \
            -H "x-api-key: $DOKPLOY_API_KEY" -H "content-type: application/json" \
            -d "{\"applicationId\":\"$DOKPLOY_APPLICATION_ID\"}"
```

- [ ] **Step 2: `mcp/HOSTING.md`, the operator runbook.** Create it with exactly these sections:
  - **What runs where**: the Traefik routing diagram from the spec §2.
  - **Dokploy setup**, as numbered steps:
    1. New Application, source = this GitHub repo, branch `main`, build type Dockerfile, Dockerfile path `mcp/Dockerfile`, build context `.`.
    2. Environment: `PUBLIC_URL=https://garmin.ficdev.xyz`, `SEAL_KEYS=<openssl rand -base64 32>`, `DB_PATH=/data/grants.db`, `PORT=3000`, `TRUST_PROXY=1`; optionally `GARMIN_MCP_GROUPS`, `GARMIN_MCP_ENABLE_GRAPHQL`.
    3. Mounts: a **named volume** at `/data` (not a bind mount; see the Dockerfile comment).
    4. Domains, all host `garmin.ficdev.xyz`, HTTPS on, container port 3000, **Strip Path off**: path `/mcp`; path `/.well-known/oauth-protected-resource`; path `/.well-known/oauth-authorization-server`.
    5. Auto Deploy **off**. Create an API key (Settings → Profile → API keys) and add the GitHub secrets `DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_APPLICATION_ID`.
    6. First deploy by hand (Deploy button). Check `curl https://garmin.ficdev.xyz/mcp/healthz` returns `ok` and `curl -i -X POST https://garmin.ficdev.xyz/mcp` returns `401` with a `resource_metadata` header.
  - **Operations**:
    - Revoke one connection: `node http.mjs revoke <grant_id>` (Dokploy → the app → Terminal; the grant id prefix is in the logs).
    - Revoke everyone: `node http.mjs revoke --all`.
    - Rotating the key: prepend a new key to `SEAL_KEYS`, redeploy, and drop the old one after 35 days.
    - Logs are JSON lines of grant prefix, RPC method, tool, status and ms.
  - **Known risk**: the spec §5 paragraph on the shared egress IP and Garmin's login rate limits.

- [ ] **Step 3: User and privacy docs.**
  - `mcp/README.md`: add a section near the top, **"Use it without installing"**. It covers:
    - The URL `https://garmin.ficdev.xyz/mcp`.
    - claude.ai: Settings → Connectors → Add custom connector → paste the URL → sign in to Garmin in the window that opens. It then shows up in Claude Desktop and mobile on the same account.
    - Claude Code: `claude mcp add --transport http garmin https://garmin.ficdev.xyz/mcp`.
    - Other MCP clients: add a streamable-HTTP server with that URL.
    - What differs from the local server: no `sign_in_to_garmin`; upload tools take `filename` + `content` (+ `encoding: "base64"` for `.fit`); downloads come back in the chat (5 MB cap).
    - How to disconnect: remove the connector, or tick "Disconnect my other Garmin connections" on the next sign-in.
  - `mcp/PRIVACY.md`: add a **"Hosted server (garmin.ficdev.xyz/mcp)"** section.
    - Stored: one row per connection with a random id, a keyed hash of your Garmin profile id, the client's name ("Claude"), state, a counter, and timestamps. It's deleted after 35 days unused.
    - Never stored: your password (sent once to Garmin), your email, your Garmin tokens (encrypted inside the token your MCP client keeps), and your Garmin data (passed through to your client, not kept).
    - Logs hold the connection id prefix, tool name, status and duration only.
  - `AGENTS.md` §9: add bullets.
    - The hosted entry `mcp/src/http/` (bundle `dist-http/http.mjs`, not published to npm; deployed by `mcp/Dockerfile`; runbook `mcp/HOSTING.md`).
    - `FilesStrategy` (`localFiles` / `inlineFiles`).
    - `HOSTED_TOOL_FACTORIES`.
    - "Garmin tokens never touch disk: they live sealed inside OAuth tokens; the grant table holds none."
    - `npm run smoke:http`.
  - `README.md`: under the MCP mention, add one line: "Or use it without installing anything: add `https://garmin.ficdev.xyz/mcp` as a custom connector in claude.ai (see [mcp/README.md](mcp/README.md))."

- [ ] **Step 4: Write the refinements back into the spec.** In `docs/superpowers/specs/2026-10-07-hosted-mcp-design.md`:
  - Set the status line to `Status: approved; implementation plan docs/superpowers/plans/2026-10-07-hosted-mcp.md`.
  - Add a final section `## 11. Refinements made while planning` that copies the seven numbered items from this plan's "Refinements to the spec".

- [ ] **Step 5: Run the doc tests and the full gate.**
Run: `npm run check`
Expected: PASS. The doc-link and agents-md tests run in the root suite. Fix any broken link they report.

- [ ] **Step 6: Commit.**

```bash
git add .github/workflows/publish.yml mcp/HOSTING.md mcp/README.md mcp/PRIVACY.md AGENTS.md README.md docs/superpowers/specs/2026-10-07-hosted-mcp-design.md
git commit -m "docs(mcp): hosted server setup, privacy, runbook; deploy on release" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 14: First deployment and acceptance (with the maintainer)

No code. Each step needs the maintainer, because it touches Dokploy, DNS/TLS and real accounts.

- [ ] **Step 1:** The maintainer follows `mcp/HOSTING.md` → Dokploy setup, steps 1–6. Expected: `/mcp/healthz` returns `ok`, and `POST /mcp` returns 401 with `resource_metadata`.
- [ ] **Step 2:** Check that the Next.js demo still serves `https://garmin.ficdev.xyz/` (the path domains must not have taken over `/`).
- [ ] **Step 3: claude.ai.** Settings → Connectors → Add custom connector → `https://garmin.ficdev.xyz/mcp`. Sign in to Garmin (MFA if prompted), then ask Claude "What was my sleep score last night?" Expected: the Garmin tools are listed and the answer uses real data.
- [ ] **Step 4: Mobile.** Open the Claude app on a phone with the same account. Expected: the connector is present and a read works.
- [ ] **Step 5: Claude Code.** `claude mcp add --transport http garmin https://garmin.ficdev.xyz/mcp`, then `/mcp` to authenticate, then ask for today's steps. Expected: works.
- [ ] **Step 6: The next day (> 1 h, ideally > 27 h later).** Use the connector again without signing in. Expected: works (spec success criteria 3).
- [ ] **Step 7:** In the Dokploy terminal: `node -e "const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync('/data/grants.db').prepare('select * from grants').all())"`. Expected: rows show only ids, hashes, client names, states and numbers (success criterion 4).
- [ ] **Step 8:** Report the results to the maintainer. The release tag that will trigger future deploys still needs their go-ahead.
