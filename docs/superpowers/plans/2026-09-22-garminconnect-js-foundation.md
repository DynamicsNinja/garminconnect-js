# garminconnect-js Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the auth + transport foundation of `garminconnect-js` — SSO login with serverless-safe MFA, OAuth1 signing, token persistence and automatic refresh — plus a first vertical slice of endpoints that proves the endpoint pattern end to end.

**Architecture:** Two layers in one package. The auth/transport layer (`src/auth`, `src/http`, `src/client.ts`) ports `garth`. The endpoint layer (`src/garmin.ts`, `src/services/*`) ports `python-garminconnect` as thin typed methods over `client.connectapi(path)`. Zero runtime dependencies; everything rests on Node 18+ built-ins (`fetch`, `node:crypto`, `FormData`, `Blob`).

**Tech Stack:** TypeScript 5 (strict), Vitest, MSW, tsup, ESLint, Prettier, npm.

**Spec:** `docs/superpowers/specs/2026-09-22-garminconnect-js-design.md`

## Scope of this plan vs. the next

The spec calls for full parity with python-garminconnect: **155 public methods**. Building all of them in one plan would be a single unreviewable slab of mechanical work.

- **This plan (Foundation)** delivers working software: log in, persist tokens, refresh automatically, and call 10 representative endpoints covering every shape the endpoint layer has to handle — display-name interpolation, date params, range params, POST with a JSON body, DELETE, and a binary download.
- **Plan 2 (Endpoint parity)**, written after this one lands, ports the remaining ~145 methods service by service. By then the pattern is proven and each service file is a repeat of Task 11 with different paths.

## Global Constraints

- Node >= 18. `engines.node: ">=18"`.
- **Zero runtime dependencies.** `dependencies` in `package.json` stays `{}` permanently. Dev-only: typescript, tsup, vitest, msw, eslint, prettier, @types/node.
- TypeScript `strict: true`. No `any` in exported signatures; use `unknown` and narrow.
- Node runtime only — never import anything requiring a browser or Edge runtime.
- Server-only: nothing in `src/` may be safe to import client-side; no React, no DOM.
- Method names are camelCase (`getSleepData` ports `get_sleep_data`).
- Domain is `garmin.com`, or `garmin.cn` when `isCn` is set.
- User agents, exactly: SSO pages use the iPhone Safari UA in Task 5; OAuth calls use `com.garmin.android.apps.connectmobile`; API calls use `GCM-iOS-5.22.1.4`.
- `CLIENT_ID = "GCM_ANDROID_DARK"`.
- `OAUTH_CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json"`.
- Every commit message uses Conventional Commits (`feat:`, `test:`, `chore:`, `fix:`).
- No real credentials, tokens, names, emails, user IDs, or GPS coordinates in any committed fixture.

---

### Task 1: Project scaffold and error hierarchy

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.npmrc`
- Create: `src/errors.ts`, `src/index.ts`
- Test: `tests/errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `GarminError`, `GarminAuthError`, `GarminRateLimitError`, `GarminConnectionError`, `GarminHttpError` — all used by every later task.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "garminconnect-js",
  "version": "0.1.0",
  "description": "TypeScript client for the Garmin Connect API, for Node and Next.js server runtimes",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=18" },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist", "README.md", "NOTICE"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:live": "vitest run --config vitest.live.config.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests",
    "format": "prettier --write ."
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^22.0.0",
    "msw": "^2.6.0",
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "noEmit": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src", "tests", "scripts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts` and `.gitignore`**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/live/**"],
    environment: "node",
  },
});
```

`.gitignore`:

```
node_modules/
dist/
.env
.env.local
*.log
tokens/
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: completes with no `dependencies` installed, only devDependencies.

- [ ] **Step 5: Write the failing test**

`tests/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  GarminAuthError,
  GarminConnectionError,
  GarminError,
  GarminHttpError,
  GarminRateLimitError,
} from "../src/errors.js";

describe("error hierarchy", () => {
  it("all errors extend GarminError and carry their name", () => {
    const errors = [
      new GarminError("base"),
      new GarminAuthError("auth"),
      new GarminConnectionError("conn"),
      new GarminRateLimitError("rate", 30),
      new GarminHttpError("http", 500, "https://x.test", "body"),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(GarminError);
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe(e.constructor.name);
      expect(e.stack).toBeDefined();
    }
  });

  it("GarminRateLimitError carries retryAfter seconds", () => {
    expect(new GarminRateLimitError("rate", 30).retryAfter).toBe(30);
    expect(new GarminRateLimitError("rate").retryAfter).toBeUndefined();
  });

  it("GarminHttpError carries status, url and body", () => {
    const e = new GarminHttpError("boom", 503, "https://x.test/a", "down");
    expect(e.status).toBe(503);
    expect(e.url).toBe("https://x.test/a");
    expect(e.body).toBe("down");
  });

  it("errors are catchable by subclass", () => {
    try {
      throw new GarminAuthError("nope");
    } catch (e) {
      expect(e).toBeInstanceOf(GarminAuthError);
      expect(e).not.toBeInstanceOf(GarminHttpError);
    }
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- tests/errors.test.ts`
Expected: FAIL — cannot resolve `../src/errors.js`.

- [ ] **Step 7: Write the implementation**

`src/errors.ts`:

```ts
export class GarminError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** 401/403, failed SSO, or an expired OAuth1 token. Re-login is required. */
export class GarminAuthError extends GarminError {}

/** Network failure or timeout. */
export class GarminConnectionError extends GarminError {}

/** 429. `retryAfter` is seconds, taken from the Retry-After header when present. */
export class GarminRateLimitError extends GarminError {
  constructor(
    message: string,
    readonly retryAfter?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Any other non-2xx response. */
export class GarminHttpError extends GarminError {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly body: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
```

`src/index.ts`:

```ts
export * from "./errors.js";
```

- [ ] **Step 8: Run test and typecheck**

Run: `npm test -- tests/errors.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/errors.ts src/index.ts tests/errors.test.ts
git commit -m "feat: scaffold package and error hierarchy"
```

---

### Task 2: OAuth1 HMAC-SHA1 signing

**Files:**
- Create: `src/auth/oauth1.ts`
- Test: `tests/auth/oauth1.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `percentEncode(value: string): string`
  - `signatureBaseString(method: string, url: string, params: Record<string, string>): string`
  - `buildOAuth1Header(args: OAuth1Args): string` where
    `interface OAuth1Args { method: string; url: string; consumerKey: string; consumerSecret: string; token?: string; tokenSecret?: string; bodyParams?: Record<string, string>; nonce?: string; timestamp?: number }`

`nonce` and `timestamp` are injectable so tests are deterministic; production calls omit them.

- [ ] **Step 1: Write the failing test**

`tests/auth/oauth1.test.ts`. The vectors are from RFC 5849 §1.2 and §3.4.1.

```ts
import { describe, expect, it } from "vitest";
import {
  buildOAuth1Header,
  percentEncode,
  signatureBaseString,
} from "../../src/auth/oauth1.js";

describe("percentEncode", () => {
  it("leaves unreserved characters alone", () => {
    expect(percentEncode("aZ0-._~")).toBe("aZ0-._~");
  });

  it("escapes the characters encodeURIComponent misses", () => {
    expect(percentEncode("!*'()")).toBe("%21%2A%27%28%29");
  });

  it("escapes reserved characters and space", () => {
    expect(percentEncode("a b&c=d")).toBe("a%20b%26c%3Dd");
  });

  it("encodes non-ASCII as UTF-8", () => {
    expect(percentEncode("é")).toBe("%C3%A9");
  });
});

describe("signatureBaseString", () => {
  // RFC 5849 section 3.4.1.1 worked example
  it("matches the RFC 5849 worked example", () => {
    const params = {
      b5: "=%3D",
      a3: "a",
      "c@": "",
      a2: "r b",
      oauth_consumer_key: "9djdj82h48djs9d2",
      oauth_token: "kkk9d7dh3k39sjv7",
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: "137131201",
      oauth_nonce: "7d8f3e4a",
      c2: "",
    };
    const base = signatureBaseString(
      "POST",
      "http://example.com/request",
      params,
    );
    expect(base).toBe(
      "POST&http%3A%2F%2Fexample.com%2Frequest&a2%3Dr%2520b%26a3%3Da%26b5" +
        "%3D%253D%25253D%26c%2540%3D%26c2%3D%26oauth_consumer_key%3D9djdj82h4" +
        "8djs9d2%26oauth_nonce%3D7d8f3e4a%26oauth_signature_method%3DHMAC-SHA1" +
        "%26oauth_timestamp%3D137131201%26oauth_token%3Dkkk9d7dh3k39sjv7",
    );
  });

  it("sorts params by encoded key, then by encoded value", () => {
    const base = signatureBaseString("GET", "https://x.test/p", {
      b: "2",
      a: "2",
      A: "1",
    });
    expect(base).toBe("GET&https%3A%2F%2Fx.test%2Fp&A%3D1%26a%3D2%26b%3D2");
  });

  it("normalizes the URL: lowercases scheme and host, drops the default port and query", () => {
    const base = signatureBaseString("GET", "HTTPS://X.TEST:443/p?q=1", {
      q: "1",
    });
    expect(base).toBe("GET&https%3A%2F%2Fx.test%2Fp&q%3D1");
  });
});

describe("buildOAuth1Header", () => {
  // Derived from the RFC 5849 section 1.2 temporary-credential example.
  // NOTE: the signature below is NOT the one RFC 5849 prints. The RFC's example
  // omits oauth_version from the signed parameter set; this signer always sends
  // and signs oauth_version="1.0", matching oauthlib (what Python garth uses
  // against real Garmin). Dropping oauth_version from this same parameter set
  // reproduces the RFC's published 74KNZJeDHnMBp0EMJ9ZHt/XKycU= exactly, which
  // is what confirms the algorithm rather than the literal.
  it("signs the RFC 5849 section 1.2 temporary-credential request", () => {
    const header = buildOAuth1Header({
      method: "POST",
      url: "https://photos.example.net/initiate",
      consumerKey: "dpf43f3p2l4k3l03",
      consumerSecret: "kd94hf93k423kf44",
      nonce: "wIjqoS",
      timestamp: 137131200,
      bodyParams: { oauth_callback: "http://printer.example.com/ready" },
    });
    expect(header).toContain('oauth_signature="msrTmwtDEKqeVXeJaufuiXOpbJI%3D"');
    expect(header).toMatch(/^OAuth /);
    expect(header).toContain('oauth_consumer_key="dpf43f3p2l4k3l03"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toContain('oauth_version="1.0"');
  });

  it("includes the token and signs with the token secret when given", () => {
    const withToken = buildOAuth1Header({
      method: "GET",
      url: "https://x.test/a",
      consumerKey: "ck",
      consumerSecret: "cs",
      token: "tk",
      tokenSecret: "ts",
      nonce: "n",
      timestamp: 1,
    });
    const withoutToken = buildOAuth1Header({
      method: "GET",
      url: "https://x.test/a",
      consumerKey: "ck",
      consumerSecret: "cs",
      nonce: "n",
      timestamp: 1,
    });
    expect(withToken).toContain('oauth_token="tk"');
    expect(withoutToken).not.toContain("oauth_token=");
    expect(withToken).not.toBe(withoutToken);
  });

  it("signs query-string params from the URL", () => {
    const a = buildOAuth1Header({
      method: "GET",
      url: "https://x.test/a?ticket=ST-1",
      consumerKey: "ck",
      consumerSecret: "cs",
      nonce: "n",
      timestamp: 1,
    });
    const b = buildOAuth1Header({
      method: "GET",
      url: "https://x.test/a?ticket=ST-2",
      consumerKey: "ck",
      consumerSecret: "cs",
      nonce: "n",
      timestamp: 1,
    });
    expect(a).not.toBe(b);
  });

  it("generates a distinct nonce per call when not injected", () => {
    const args = {
      method: "GET",
      url: "https://x.test/a",
      consumerKey: "ck",
      consumerSecret: "cs",
    };
    expect(buildOAuth1Header(args)).not.toBe(buildOAuth1Header(args));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/auth/oauth1.test.ts`
Expected: FAIL — cannot resolve `../../src/auth/oauth1.js`.

- [ ] **Step 3: Write the implementation**

`src/auth/oauth1.ts`:

```ts
import { createHmac, randomBytes } from "node:crypto";

/** RFC 3986 percent-encoding. `encodeURIComponent` leaves !*'() unescaped. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Scheme and host lowercased, default port dropped, query and fragment removed. */
function normalizeUrl(url: string): string {
  const u = new URL(url);
  const isDefaultPort =
    (u.protocol === "https:" && u.port === "443") ||
    (u.protocol === "http:" && u.port === "80");
  const port = u.port && !isDefaultPort ? `:${u.port}` : "";
  return `${u.protocol.toLowerCase()}//${u.hostname.toLowerCase()}${port}${u.pathname}`;
}

export function signatureBaseString(
  method: string,
  url: string,
  params: Record<string, string>,
): string {
  const encoded = Object.entries(params).map(
    ([k, v]) => [percentEncode(k), percentEncode(v)] as const,
  );
  encoded.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const normalized = encoded.map(([k, v]) => `${k}=${v}`).join("&");
  return [
    method.toUpperCase(),
    percentEncode(normalizeUrl(url)),
    percentEncode(normalized),
  ].join("&");
}

export interface OAuth1Args {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  /** form-encoded body params, which must be included in the signature */
  bodyParams?: Record<string, string>;
  /** injectable for deterministic tests */
  nonce?: string;
  timestamp?: number;
}

export function buildOAuth1Header(args: OAuth1Args): string {
  const nonce = args.nonce ?? randomBytes(16).toString("hex");
  const timestamp = args.timestamp ?? Math.floor(Date.now() / 1000);

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: args.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_version: "1.0",
  };
  if (args.token) oauthParams["oauth_token"] = args.token;

  const queryParams: Record<string, string> = {};
  for (const [k, v] of new URL(args.url).searchParams) queryParams[k] = v;

  const base = signatureBaseString(args.method, args.url, {
    ...queryParams,
    ...args.bodyParams,
    ...oauthParams,
  });

  const key = `${percentEncode(args.consumerSecret)}&${percentEncode(args.tokenSecret ?? "")}`;
  const signature = createHmac("sha1", key).update(base).digest("base64");

  const headerParams = { ...oauthParams, oauth_signature: signature };
  const parts = Object.entries(headerParams)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`);
  return `OAuth ${parts.join(", ")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/auth/oauth1.test.ts`
Expected: PASS, all cases.

If the RFC vector fails, the bug is almost always in `percentEncode` (the `!*'()` set) or in double-encoding the normalized params — compare the produced base string against the expected one character by character before touching the HMAC.

- [ ] **Step 5: Commit**

```bash
git add src/auth/oauth1.ts tests/auth/oauth1.test.ts
git commit -m "feat: add OAuth1 HMAC-SHA1 signing verified against RFC 5849 vectors"
```

---

### Task 3: Cookie jar

**Files:**
- Create: `src/http/cookie-jar.ts`
- Test: `tests/http/cookie-jar.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface SerializedCookie { name: string; value: string; domain: string; path: string; expires?: number; secure: boolean }`
  - `class CookieJar` with `setFromResponse(url: string, setCookieHeaders: string[]): void`, `cookieHeaderFor(url: string): string | undefined`, `toJSON(): SerializedCookie[]`, `static fromJSON(cookies: SerializedCookie[]): CookieJar`

- [ ] **Step 1: Write the failing test**

`tests/http/cookie-jar.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { CookieJar } from "../../src/http/cookie-jar.js";

describe("CookieJar", () => {
  it("stores a cookie and returns it for the same host", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/sso/x", ["SESSION=abc; Path=/"]);
    expect(jar.cookieHeaderFor("https://sso.garmin.com/sso/y")).toBe("SESSION=abc");
  });

  it("joins multiple cookies with '; '", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", ["A=1; Path=/", "B=2; Path=/"]);
    const header = jar.cookieHeaderFor("https://sso.garmin.com/");
    expect(header?.split("; ").sort()).toEqual(["A=1", "B=2"]);
  });

  it("returns undefined when nothing matches", () => {
    const jar = new CookieJar();
    expect(jar.cookieHeaderFor("https://sso.garmin.com/")).toBeUndefined();
  });

  it("a later Set-Cookie with the same name/domain/path replaces the earlier one", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", ["S=old; Path=/"]);
    jar.setFromResponse("https://sso.garmin.com/", ["S=new; Path=/"]);
    expect(jar.cookieHeaderFor("https://sso.garmin.com/")).toBe("S=new");
  });

  it("does not leak a host-only cookie to a different host", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", ["S=abc; Path=/"]);
    expect(jar.cookieHeaderFor("https://connectapi.garmin.com/")).toBeUndefined();
  });

  it("sends a Domain cookie to subdomains but not to a suffix impostor", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", [
      "S=abc; Path=/; Domain=.garmin.com",
    ]);
    expect(jar.cookieHeaderFor("https://connectapi.garmin.com/")).toBe("S=abc");
    expect(jar.cookieHeaderFor("https://garmin.com/")).toBe("S=abc");
    expect(jar.cookieHeaderFor("https://evilgarmin.com/")).toBeUndefined();
  });

  it("matches on path prefix at a segment boundary", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/sso/a", ["S=abc; Path=/sso"]);
    expect(jar.cookieHeaderFor("https://sso.garmin.com/sso")).toBe("S=abc");
    expect(jar.cookieHeaderFor("https://sso.garmin.com/sso/deep/er")).toBe("S=abc");
    expect(jar.cookieHeaderFor("https://sso.garmin.com/ssoother")).toBeUndefined();
    expect(jar.cookieHeaderFor("https://sso.garmin.com/other")).toBeUndefined();
  });

  it("defaults Path to the request directory when absent", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/sso/deep/page", ["S=abc"]);
    expect(jar.cookieHeaderFor("https://sso.garmin.com/sso/deep/other")).toBe("S=abc");
    expect(jar.cookieHeaderFor("https://sso.garmin.com/sso")).toBeUndefined();
  });

  it("withholds a Secure cookie from http", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", ["S=abc; Path=/; Secure"]);
    expect(jar.cookieHeaderFor("http://sso.garmin.com/")).toBeUndefined();
    expect(jar.cookieHeaderFor("https://sso.garmin.com/")).toBe("S=abc");
  });

  it("drops an expired cookie", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", [
      "S=abc; Path=/; Expires=Thu, 01 Jan 2026 00:00:10 GMT",
    ]);
    expect(jar.cookieHeaderFor("https://sso.garmin.com/")).toBe("S=abc");
    vi.setSystemTime(new Date("2026-01-01T00:00:20Z"));
    expect(jar.cookieHeaderFor("https://sso.garmin.com/")).toBeUndefined();
    vi.useRealTimers();
  });

  it("honours Max-Age", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", ["S=abc; Path=/; Max-Age=10"]);
    vi.setSystemTime(new Date("2026-01-01T00:00:20Z"));
    expect(jar.cookieHeaderFor("https://sso.garmin.com/")).toBeUndefined();
    vi.useRealTimers();
  });

  it("round-trips through JSON", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://sso.garmin.com/", ["S=abc; Path=/; Domain=.garmin.com"]);
    const revived = CookieJar.fromJSON(JSON.parse(JSON.stringify(jar.toJSON())));
    expect(revived.cookieHeaderFor("https://connectapi.garmin.com/")).toBe("S=abc");
  });

  it("two jars do not share state", () => {
    const a = new CookieJar();
    const b = new CookieJar();
    a.setFromResponse("https://sso.garmin.com/", ["S=a; Path=/"]);
    expect(b.cookieHeaderFor("https://sso.garmin.com/")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/http/cookie-jar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/http/cookie-jar.ts`:

```ts
export interface SerializedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** epoch milliseconds; absent means a session cookie */
  expires?: number;
  secure: boolean;
  /** true when no Domain attribute was sent: match this host exactly */
  hostOnly: boolean;
}

function defaultPath(pathname: string): string {
  if (!pathname.startsWith("/") || pathname === "/") return "/";
  const i = pathname.lastIndexOf("/");
  return i === 0 ? "/" : pathname.slice(0, i);
}

function domainMatches(requestHost: string, cookieDomain: string, hostOnly: boolean): boolean {
  if (hostOnly) return requestHost === cookieDomain;
  return (
    requestHost === cookieDomain || requestHost.endsWith("." + cookieDomain)
  );
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

export class CookieJar {
  #cookies: SerializedCookie[] = [];

  setFromResponse(url: string, setCookieHeaders: string[]): void {
    const u = new URL(url);
    for (const header of setCookieHeaders) {
      const cookie = this.#parse(header, u);
      if (!cookie) continue;
      this.#cookies = this.#cookies.filter(
        (c) =>
          !(
            c.name === cookie.name &&
            c.domain === cookie.domain &&
            c.path === cookie.path
          ),
      );
      this.#cookies.push(cookie);
    }
  }

  #parse(header: string, u: URL): SerializedCookie | null {
    const [pair, ...attrs] = header.split(";");
    if (!pair) return null;
    const eq = pair.indexOf("=");
    if (eq < 1) return null;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();

    let domain = u.hostname;
    let hostOnly = true;
    let path = defaultPath(u.pathname);
    let expires: number | undefined;
    let secure = false;
    let maxAge: number | undefined;

    for (const attr of attrs) {
      const [rawKey, ...rest] = attr.split("=");
      const key = rawKey?.trim().toLowerCase();
      const val = rest.join("=").trim();
      if (key === "domain" && val) {
        domain = val.replace(/^\./, "").toLowerCase();
        hostOnly = false;
      } else if (key === "path" && val.startsWith("/")) {
        path = val;
      } else if (key === "expires" && val) {
        const t = Date.parse(val);
        if (!Number.isNaN(t)) expires = t;
      } else if (key === "max-age" && val) {
        const n = Number(val);
        if (!Number.isNaN(n)) maxAge = n;
      } else if (key === "secure") {
        secure = true;
      }
    }
    // Max-Age wins over Expires per RFC 6265 section 5.3.
    if (maxAge !== undefined) expires = Date.now() + maxAge * 1000;

    return { name, value, domain, path, expires, secure, hostOnly };
  }

  cookieHeaderFor(url: string): string | undefined {
    const u = new URL(url);
    const now = Date.now();
    this.#cookies = this.#cookies.filter((c) => c.expires === undefined || c.expires > now);

    const matches = this.#cookies.filter(
      (c) =>
        domainMatches(u.hostname, c.domain, c.hostOnly) &&
        pathMatches(u.pathname, c.path) &&
        (!c.secure || u.protocol === "https:"),
    );
    if (matches.length === 0) return undefined;
    return matches.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  toJSON(): SerializedCookie[] {
    return this.#cookies.map((c) => ({ ...c }));
  }

  static fromJSON(cookies: SerializedCookie[]): CookieJar {
    const jar = new CookieJar();
    for (const c of cookies) jar.#cookies.push({ ...c });
    return jar;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/http/cookie-jar.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/http/cookie-jar.ts tests/http/cookie-jar.test.ts
git commit -m "feat: add cookie jar for the SSO flow"
```

---

### Task 4: Fetcher — cookies, timeout, retries, error mapping

**Files:**
- Create: `src/http/fetcher.ts`
- Test: `tests/http/fetcher.test.ts`

**Interfaces:**
- Consumes: `CookieJar` (Task 3); error classes (Task 1).
- Produces:
  - `interface FetcherOptions { timeoutMs?: number; retries?: number; backoffMs?: number; fetchImpl?: typeof fetch; jar?: CookieJar }`
  - `interface RequestOptions { method?: string; params?: Record<string, string | number | undefined>; // `BodyInit` is not an ambient global without the DOM lib; this resolves
  // structurally to `BodyInit | null | undefined` and still accepts FormData.
  body?: RequestInit["body"]; json?: unknown; headers?: Record<string, string>; referer?: boolean }`
  - `class Fetcher` with `readonly jar: CookieJar`, `request(url: string, options?: RequestOptions): Promise<Response>`, `lastUrl: string | undefined`

`Fetcher` throws `GarminRateLimitError` on 429, `GarminAuthError` on 401/403, `GarminHttpError` on other non-2xx, `GarminConnectionError` on network failure or timeout. It retries only on 408/500/502/503/504 and network errors.

- [ ] **Step 1: Write the failing test**

`tests/http/fetcher.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Fetcher } from "../../src/http/fetcher.js";
import {
  GarminAuthError,
  GarminConnectionError,
  GarminHttpError,
  GarminRateLimitError,
} from "../../src/errors.js";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("Fetcher", () => {
  it("sends query params and returns the response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await f.request("https://x.test/a", { params: { d: "2026-01-01" } });
    expect(await res.json()).toEqual({ ok: true });
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://x.test/a?d=2026-01-01");
  });

  it("omits undefined params", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await f.request("https://x.test/a", { params: { a: "1", b: undefined } });
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://x.test/a?a=1");
  });

  it("stores response cookies and replays them on the next request", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "set-cookie": "S=abc; Path=/", "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}));
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await f.request("https://x.test/a");
    await f.request("https://x.test/b");
    const headers = new Headers(fetchImpl.mock.calls[1]![1].headers);
    expect(headers.get("cookie")).toBe("S=abc");
  });

  it("sets a referer from the previous response when asked", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await f.request("https://x.test/first");
    await f.request("https://x.test/second", { referer: true });
    const headers = new Headers(fetchImpl.mock.calls[1]![1].headers);
    expect(headers.get("referer")).toBe("https://x.test/first");
  });

  it("serializes a json body and sets content-type", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await f.request("https://x.test/a", { method: "POST", json: { a: 1 } });
    const init = fetchImpl.mock.calls[0]![1];
    expect(init.body).toBe('{"a":1}');
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("retries 503 and succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const f = new Fetcher({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffMs: 1,
    });
    const res = await f.request("https://x.test/a");
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry budget and throws GarminHttpError", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    const f = new Fetcher({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 2,
      backoffMs: 1,
    });
    await expect(f.request("https://x.test/a")).rejects.toBeInstanceOf(GarminHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not retry a 400", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 400 }));
    const f = new Fetcher({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffMs: 1,
    });
    await expect(f.request("https://x.test/a")).rejects.toBeInstanceOf(GarminHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps 401 to GarminAuthError without retrying", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }));
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(f.request("https://x.test/a")).rejects.toBeInstanceOf(GarminAuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps 429 to GarminRateLimitError carrying retryAfter", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("slow", { status: 429, headers: { "retry-after": "12" } }),
    );
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(f.request("https://x.test/a")).rejects.toMatchObject({
      name: "GarminRateLimitError",
      retryAfter: 12,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps a network failure to GarminConnectionError after retrying", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const f = new Fetcher({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 1,
      backoffMs: 1,
    });
    await expect(f.request("https://x.test/a")).rejects.toBeInstanceOf(
      GarminConnectionError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("includes the status, url and body in GarminHttpError", async () => {
    const fetchImpl = vi.fn(async () => new Response("kaboom", { status: 418 }));
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(f.request("https://x.test/a")).rejects.toMatchObject({
      status: 418,
      url: "https://x.test/a",
      body: "kaboom",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/http/fetcher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/http/fetcher.ts`:

```ts
import {
  GarminAuthError,
  GarminConnectionError,
  GarminHttpError,
  GarminRateLimitError,
} from "../errors.js";
import { CookieJar } from "./cookie-jar.js";

const RETRY_STATUSES = new Set([408, 500, 502, 503, 504]);

export interface FetcherOptions {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  fetchImpl?: typeof fetch;
  jar?: CookieJar;
}

export interface RequestOptions {
  method?: string;
  params?: Record<string, string | number | undefined>;
  // `BodyInit` is not an ambient global without the DOM lib; this resolves
  // structurally to `BodyInit | null | undefined` and still accepts FormData.
  body?: RequestInit["body"];
  json?: unknown;
  headers?: Record<string, string>;
  referer?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Fetcher {
  readonly jar: CookieJar;
  lastUrl: string | undefined;

  readonly #timeoutMs: number;
  readonly #retries: number;
  readonly #backoffMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: FetcherOptions = {}) {
    this.jar = options.jar ?? new CookieJar();
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#retries = options.retries ?? 3;
    this.#backoffMs = options.backoffMs ?? 500;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  async request(url: string, options: RequestOptions = {}): Promise<Response> {
    const target = new URL(url);
    for (const [k, v] of Object.entries(options.params ?? {})) {
      if (v !== undefined) target.searchParams.set(k, String(v));
    }
    const finalUrl = target.toString();

    const headers = new Headers(options.headers ?? {});
    const cookie = this.jar.cookieHeaderFor(finalUrl);
    if (cookie) headers.set("cookie", cookie);
    if (options.referer && this.lastUrl) headers.set("referer", this.lastUrl);

    let body = options.body;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#retries; attempt++) {
      if (attempt > 0) await sleep(this.#backoffMs * 2 ** (attempt - 1));

      let res: Response;
      try {
        res = await this.#fetch(finalUrl, {
          method: options.method ?? "GET",
          headers,
          body,
          redirect: "follow",
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (cause) {
        lastError = cause;
        continue;
      }

      const setCookie = this.#readSetCookie(res);
      if (setCookie.length > 0) this.jar.setFromResponse(finalUrl, setCookie);
      this.lastUrl = res.url || finalUrl;

      if (res.ok) return res;

      if (RETRY_STATUSES.has(res.status) && attempt < this.#retries) {
        continue;
      }
      throw await this.#toError(res, finalUrl);
    }

    throw new GarminConnectionError(
      `Request to ${finalUrl} failed after ${this.#retries + 1} attempts`,
      { cause: lastError },
    );
  }

  #readSetCookie(res: Response): string[] {
    const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] })
      .getSetCookie;
    if (typeof getSetCookie === "function") return getSetCookie.call(res.headers);
    const single = res.headers.get("set-cookie");
    return single ? [single] : [];
  }

  async #toError(res: Response, url: string): Promise<Error> {
    const body = await res.text().catch(() => "");
    if (res.status === 429) {
      const raw = res.headers.get("retry-after");
      const retryAfter = raw && !Number.isNaN(Number(raw)) ? Number(raw) : undefined;
      return new GarminRateLimitError(`Rate limited by Garmin at ${url}`, retryAfter);
    }
    if (res.status === 401 || res.status === 403) {
      return new GarminAuthError(`Not authorized for ${url} (${res.status})`);
    }
    return new GarminHttpError(
      `Request to ${url} failed with ${res.status}`,
      res.status,
      url,
      body,
    );
  }
}
```

Note: `AbortSignal.timeout` rejects with a `TimeoutError`, which the `catch` treats like any network failure — so a timeout is retried and ultimately surfaces as `GarminConnectionError`. That is intended.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/http/fetcher.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/http/fetcher.ts tests/http/fetcher.test.ts
git commit -m "feat: add fetch wrapper with cookies, retries and error mapping"
```

---

### Task 5: Tokens and consumer credentials

**Files:**
- Create: `src/auth/tokens.ts`, `src/auth/consumer.ts`, `src/auth/constants.ts`
- Test: `tests/auth/tokens.test.ts`, `tests/auth/consumer.test.ts`

**Interfaces:**
- Consumes: `Fetcher` (Task 4).
- Produces:
  - `interface OAuth1Token { oauth_token: string; oauth_token_secret: string; mfa_token?: string; mfa_expiration_timestamp?: string; domain?: string }`
  - `interface OAuth2Token { scope: string; jti: string; token_type: string; access_token: string; refresh_token: string; expires_in: number; expires_at: number; refresh_token_expires_in: number; refresh_token_expires_at: number }`
  - `interface Tokens { oauth1: OAuth1Token; oauth2: OAuth2Token }`
  - `setExpirations(raw: RawOAuth2Token, nowMs?: number): OAuth2Token`
  - `isExpired(token: OAuth2Token, marginSeconds?: number, nowMs?: number): boolean`
  - `refreshExpired(token: OAuth2Token, nowMs?: number): boolean`
  - `authorizationHeader(token: OAuth2Token): string`
  - `interface ConsumerCredentials { consumer_key: string; consumer_secret: string }`
  - `fetchConsumer(fetcher: Fetcher, url?: string): Promise<ConsumerCredentials>` (module-level cached)
  - `resetConsumerCache(): void` (test seam)
  - constants: `CLIENT_ID`, `OAUTH_CONSUMER_URL`, `OAUTH_USER_AGENT`, `API_USER_AGENT`, `SSO_PAGE_HEADERS`

- [ ] **Step 1: Write the failing tests**

`tests/auth/tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  authorizationHeader,
  isExpired,
  setExpirations,
  type OAuth2Token,
} from "../../src/auth/tokens.js";

const raw = {
  scope: "CONNECT_READ",
  jti: "abc",
  token_type: "Bearer",
  access_token: "at",
  refresh_token: "rt",
  expires_in: 3600,
  refresh_token_expires_in: 7200,
};

describe("setExpirations", () => {
  it("computes absolute expiry seconds from the relative ones", () => {
    const now = 1_700_000_000_000;
    const token = setExpirations(raw, now);
    expect(token.expires_at).toBe(1_700_000_000 + 3600);
    expect(token.refresh_token_expires_at).toBe(1_700_000_000 + 7200);
  });

  it("preserves the original fields", () => {
    const token = setExpirations(raw, 0);
    expect(token.access_token).toBe("at");
    expect(token.token_type).toBe("Bearer");
  });
});

describe("isExpired", () => {
  const token = { ...raw, expires_at: 1_000, refresh_token_expires_at: 2_000 } as OAuth2Token;

  it("is false well before expiry", () => {
    expect(isExpired(token, 60, 900_000)).toBe(false);
  });

  it("is true after expiry", () => {
    expect(isExpired(token, 60, 1_100_000)).toBe(true);
  });

  it("is true inside the safety margin", () => {
    expect(isExpired(token, 60, 970_000)).toBe(true);
  });
});

describe("authorizationHeader", () => {
  it("title-cases the token type", () => {
    const token = setExpirations({ ...raw, token_type: "bearer" }, 0);
    expect(authorizationHeader(token)).toBe("Bearer at");
  });
});
```

`tests/auth/consumer.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Fetcher } from "../../src/http/fetcher.js";
import { fetchConsumer, resetConsumerCache } from "../../src/auth/consumer.js";

beforeEach(() => resetConsumerCache());

describe("fetchConsumer", () => {
  it("fetches and returns the consumer credentials", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ consumer_key: "ck", consumer_secret: "cs" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(fetchConsumer(f)).resolves.toEqual({
      consumer_key: "ck",
      consumer_secret: "cs",
    });
  });

  it("caches across calls so the network is hit once", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ consumer_key: "ck", consumer_secret: "cs" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await fetchConsumer(f);
    await fetchConsumer(f);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("accepts a custom url", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ consumer_key: "k", consumer_secret: "s" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await fetchConsumer(f, "https://mirror.test/c.json");
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://mirror.test/c.json");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/auth/tokens.test.ts tests/auth/consumer.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`src/auth/constants.ts`:

```ts
export const CLIENT_ID = "GCM_ANDROID_DARK";
export const OAUTH_CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json";

/** Must match the Android consumer key fetched from S3. */
export const OAUTH_USER_AGENT = "com.garmin.android.apps.connectmobile";
export const API_USER_AGENT = "GCM-iOS-5.22.1.4";

const SSO_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

/**
 * The SSO endpoints run in a WebView. Without browser-shaped headers,
 * Cloudflare challenges the request and login fails.
 */
export const SSO_PAGE_HEADERS: Record<string, string> = {
  "User-Agent": SSO_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Dest": "document",
};
```

`src/auth/tokens.ts`:

```ts
export interface OAuth1Token {
  oauth_token: string;
  oauth_token_secret: string;
  mfa_token?: string;
  mfa_expiration_timestamp?: string;
  domain?: string;
}

export interface RawOAuth2Token {
  scope: string;
  jti: string;
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_token_expires_in: number;
}

export interface OAuth2Token extends RawOAuth2Token {
  /** epoch seconds */
  expires_at: number;
  /** epoch seconds */
  refresh_token_expires_at: number;
}

export interface Tokens {
  oauth1: OAuth1Token;
  oauth2: OAuth2Token;
}

export function setExpirations(raw: RawOAuth2Token, nowMs: number = Date.now()): OAuth2Token {
  const now = Math.floor(nowMs / 1000);
  return {
    ...raw,
    expires_at: now + raw.expires_in,
    refresh_token_expires_at: now + raw.refresh_token_expires_in,
  };
}

export function isExpired(
  token: OAuth2Token,
  marginSeconds = 60,
  nowMs: number = Date.now(),
): boolean {
  return token.expires_at - marginSeconds <= Math.floor(nowMs / 1000);
}

export function refreshExpired(
  token: OAuth2Token,
  nowMs: number = Date.now(),
): boolean {
  return token.refresh_token_expires_at <= Math.floor(nowMs / 1000);
}

export function authorizationHeader(token: OAuth2Token): string {
  const type = token.token_type;
  const titled = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  return `${titled} ${token.access_token}`;
}
```

`src/auth/consumer.ts`:

```ts
import type { Fetcher } from "../http/fetcher.js";
import { OAUTH_CONSUMER_URL } from "./constants.js";

export interface ConsumerCredentials {
  consumer_key: string;
  consumer_secret: string;
}

let cached: ConsumerCredentials | undefined;

/**
 * The consumer key/secret come from a bucket controlled by garth's author.
 * Cached process-wide because they never change between calls.
 */
export async function fetchConsumer(
  fetcher: Fetcher,
  url: string = OAUTH_CONSUMER_URL,
): Promise<ConsumerCredentials> {
  if (cached) return cached;
  const res = await fetcher.request(url);
  cached = (await res.json()) as ConsumerCredentials;
  return cached;
}

/** Test seam. */
export function resetConsumerCache(): void {
  cached = undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/auth/tokens.test.ts tests/auth/consumer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/constants.ts src/auth/tokens.ts src/auth/consumer.ts tests/auth/tokens.test.ts tests/auth/consumer.test.ts
git commit -m "feat: add token models and consumer credential fetching"
```

---

### Task 6: SSO login — success path

**Files:**
- Create: `src/auth/sso.ts`
- Test: `tests/auth/sso.test.ts`
- Create: `tests/helpers/sso-server.ts`

**Interfaces:**
- Consumes: `Fetcher`, `buildOAuth1Header`, `fetchConsumer`, `setExpirations`, constants.
- Produces:
  - `interface SsoContext { fetcher: Fetcher; domain: string }`
  - `interface LoginParams { clientId: string; locale: string; service: string }`
  - `login(email: string, password: string, ctx: SsoContext): Promise<LoginResult>`
  - `getOauth1Token(ticket: string, ctx: SsoContext): Promise<OAuth1Token>`
  - `exchange(oauth1: OAuth1Token, ctx: SsoContext, opts?: { login?: boolean }): Promise<OAuth2Token>`
  - `type LoginResult = { state: "success"; oauth1: OAuth1Token; oauth2: OAuth2Token } | { state: "mfa_required"; mfaState: MfaState }` (the MFA half lands in Task 7)

- [ ] **Step 1: Write the MSW test server helper**

`tests/helpers/sso-server.ts`:

```ts
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export interface SsoScenario {
  /** "success" | "mfa" | "bad_credentials" */
  loginOutcome?: "success" | "mfa" | "bad_credentials";
  ticket?: string;
  mfaCode?: string;
}

export function makeSsoServer(scenario: SsoScenario = {}) {
  const ticket = scenario.ticket ?? "ST-12345";
  const outcome = scenario.loginOutcome ?? "success";
  const calls: string[] = [];

  const server = setupServer(
    http.get("https://thegarth.s3.amazonaws.com/oauth_consumer.json", () => {
      calls.push("consumer");
      return HttpResponse.json({ consumer_key: "ck", consumer_secret: "cs" });
    }),

    http.get("https://sso.garmin.com/sso/mobile/sso/en/sign-in", () => {
      calls.push("sign-in");
      return new HttpResponse("<html></html>", {
        headers: { "set-cookie": "SESSION=seed; Path=/" },
      });
    }),

    http.post("https://sso.garmin.com/sso/mobile/api/login", () => {
      calls.push("login");
      if (outcome === "success") {
        return HttpResponse.json({
          responseStatus: { type: "SUCCESSFUL" },
          serviceTicketId: ticket,
        });
      }
      if (outcome === "mfa") {
        return HttpResponse.json({
          responseStatus: { type: "MFA_REQUIRED" },
          customerMfaInfo: { mfaLastMethodUsed: "sms" },
        });
      }
      return HttpResponse.json({
        responseStatus: { type: "INVALID_USERNAME_PASSWORD", message: "Bad creds" },
      });
    }),

    http.post("https://sso.garmin.com/sso/mobile/api/mfa/verifyCode", async ({ request }) => {
      calls.push("mfa");
      const body = (await request.json()) as { mfaVerificationCode: string };
      if (scenario.mfaCode && body.mfaVerificationCode !== scenario.mfaCode) {
        return HttpResponse.json({
          responseStatus: { type: "INVALID_MFA_CODE", message: "Wrong code" },
        });
      }
      return HttpResponse.json({
        responseStatus: { type: "SUCCESSFUL" },
        serviceTicketId: ticket,
      });
    }),

    http.get("https://sso.garmin.com/sso/portal/sso/embed", () => {
      calls.push("embed");
      return new HttpResponse("", { headers: { "set-cookie": "LB=node1; Path=/" } });
    }),

    http.get(
      "https://connectapi.garmin.com/oauth-service/oauth/preauthorized",
      ({ request }) => {
        calls.push("preauthorized");
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.startsWith("OAuth ")) {
          return new HttpResponse("unsigned", { status: 401 });
        }
        return new HttpResponse(
          "oauth_token=o1tok&oauth_token_secret=o1sec&mfa_token=mfatok",
          { headers: { "content-type": "application/x-www-form-urlencoded" } },
        );
      },
    ),

    http.post(
      "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0",
      async ({ request }) => {
        calls.push("exchange");
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.includes('oauth_token="o1tok"')) {
          return new HttpResponse("unsigned", { status: 401 });
        }
        return HttpResponse.json({
          scope: "CONNECT_READ",
          jti: "jti-1",
          token_type: "Bearer",
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          refresh_token_expires_in: 7200,
        });
      },
    ),
  );

  return { server, calls };
}
```

- [ ] **Step 2: Write the failing test**

`tests/auth/sso.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Fetcher } from "../../src/http/fetcher.js";
import { login } from "../../src/auth/sso.js";
import { resetConsumerCache } from "../../src/auth/consumer.js";
import { GarminAuthError } from "../../src/errors.js";
import { makeSsoServer } from "../helpers/sso-server.js";

describe("login — success path", () => {
  let harness: ReturnType<typeof makeSsoServer>;

  beforeEach(() => {
    resetConsumerCache();
    harness = makeSsoServer({ loginOutcome: "success" });
    harness.server.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => harness.server.close());

  it("returns both tokens", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const result = await login("a@b.test", "pw", ctx);
    expect(result.state).toBe("success");
    if (result.state !== "success") throw new Error("unreachable");
    expect(result.oauth1.oauth_token).toBe("o1tok");
    expect(result.oauth1.oauth_token_secret).toBe("o1sec");
    expect(result.oauth1.mfa_token).toBe("mfatok");
    expect(result.oauth1.domain).toBe("garmin.com");
    expect(result.oauth2.access_token).toBe("access-1");
    expect(result.oauth2.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("walks the flow in order", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    await login("a@b.test", "pw", ctx);
    expect(harness.calls).toEqual([
      "sign-in",
      "login",
      "embed",
      "consumer",
      "preauthorized",
      "exchange",
    ]);
  });
});

describe("login — rejection", () => {
  let harness: ReturnType<typeof makeSsoServer>;

  beforeEach(() => {
    resetConsumerCache();
    harness = makeSsoServer({ loginOutcome: "bad_credentials" });
    harness.server.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => harness.server.close());

  it("throws GarminAuthError carrying the Garmin message", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    await expect(login("a@b.test", "wrong", ctx)).rejects.toThrow(GarminAuthError);
    await expect(login("a@b.test", "wrong", ctx)).rejects.toThrow(
      /INVALID_USERNAME_PASSWORD: Bad creds/,
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/auth/sso.test.ts`
Expected: FAIL — `../../src/auth/sso.js` not found. (If MSW is not installed yet, run `npm install -D msw` first.)

- [ ] **Step 4: Write the implementation**

`src/auth/sso.ts`:

```ts
import { GarminAuthError } from "../errors.js";
import type { Fetcher } from "../http/fetcher.js";
import type { SerializedCookie } from "../http/cookie-jar.js";
import { fetchConsumer } from "./consumer.js";
import { buildOAuth1Header } from "./oauth1.js";
import { CLIENT_ID, OAUTH_USER_AGENT, SSO_PAGE_HEADERS } from "./constants.js";
import {
  setExpirations,
  type OAuth1Token,
  type OAuth2Token,
  type RawOAuth2Token,
} from "./tokens.js";

const SSO_SUCCESSFUL = "SUCCESSFUL";
const SSO_MFA_REQUIRED = "MFA_REQUIRED";

export interface SsoContext {
  fetcher: Fetcher;
  domain: string;
}

export interface LoginParams {
  clientId: string;
  locale: string;
  service: string;
}

export interface MfaState {
  loginParams: LoginParams;
  mfaMethod: string;
  cookies: SerializedCookie[];
  domain: string;
}

export type LoginResult =
  | { state: "success"; oauth1: OAuth1Token; oauth2: OAuth2Token }
  | { state: "mfa_required"; mfaState: MfaState };

interface SsoResponse {
  responseStatus?: { type?: string; message?: string };
  serviceTicketId?: string;
  customerMfaInfo?: { mfaLastMethodUsed?: string };
}

function ssoUrl(domain: string, path: string): string {
  return `https://sso.${domain}/sso${path}`;
}

function requireSuccess(body: SsoResponse): SsoResponse {
  const type = body.responseStatus?.type ?? "UNKNOWN";
  if (type !== SSO_SUCCESSFUL) {
    const message = body.responseStatus?.message;
    throw new GarminAuthError(`SSO error: ${message ? `${type}: ${message}` : type}`);
  }
  return body;
}

export function loginParamsFor(domain: string): LoginParams {
  return {
    clientId: CLIENT_ID,
    locale: "en-US",
    service: `https://mobile.integration.${domain}/gcm/android`,
  };
}

export async function login(
  email: string,
  password: string,
  ctx: SsoContext,
): Promise<LoginResult> {
  const params = loginParamsFor(ctx.domain);

  // 1. Seed cookies.
  await ctx.fetcher.request(ssoUrl(ctx.domain, "/mobile/sso/en/sign-in"), {
    params: { clientId: CLIENT_ID },
    headers: { ...SSO_PAGE_HEADERS, "Sec-Fetch-Site": "none" },
  });

  // 2. Submit credentials.
  const res = await ctx.fetcher.request(ssoUrl(ctx.domain, "/mobile/api/login"), {
    method: "POST",
    params: { ...params },
    headers: SSO_PAGE_HEADERS,
    json: { username: email, password, rememberMe: false, captchaToken: "" },
  });
  const body = (await res.json()) as SsoResponse;
  const type = body.responseStatus?.type;

  if (type === SSO_MFA_REQUIRED) {
    return {
      state: "mfa_required",
      mfaState: {
        loginParams: params,
        mfaMethod: body.customerMfaInfo?.mfaLastMethodUsed ?? "email",
        cookies: ctx.fetcher.jar.toJSON(),
        domain: ctx.domain,
      },
    };
  }

  requireSuccess(body);
  const ticket = body.serviceTicketId;
  if (!ticket) throw new GarminAuthError("SSO succeeded but returned no service ticket");
  return completeLogin(ticket, ctx);
}

export async function completeLogin(
  ticket: string,
  ctx: SsoContext,
): Promise<{ state: "success"; oauth1: OAuth1Token; oauth2: OAuth2Token }> {
  // Best-effort: sets a Cloudflare load-balancer cookie pinning the backend.
  try {
    await ctx.fetcher.request(ssoUrl(ctx.domain, "/portal/sso/embed"), {
      headers: { ...SSO_PAGE_HEADERS, "Sec-Fetch-Site": "same-origin" },
      referer: true,
    });
  } catch {
    // Non-fatal; login works without it.
  }

  const oauth1 = await getOauth1Token(ticket, ctx);
  const oauth2 = await exchange(oauth1, ctx, { login: true });
  return { state: "success", oauth1, oauth2 };
}

export async function getOauth1Token(
  ticket: string,
  ctx: SsoContext,
): Promise<OAuth1Token> {
  const consumer = await fetchConsumer(ctx.fetcher);
  const loginUrl = `https://mobile.integration.${ctx.domain}/gcm/android`;
  const url =
    `https://connectapi.${ctx.domain}/oauth-service/oauth/preauthorized` +
    `?ticket=${encodeURIComponent(ticket)}` +
    `&login-url=${encodeURIComponent(loginUrl)}` +
    `&accepts-mfa-tokens=true`;

  const authorization = buildOAuth1Header({
    method: "GET",
    url,
    consumerKey: consumer.consumer_key,
    consumerSecret: consumer.consumer_secret,
  });

  const res = await ctx.fetcher.request(url, {
    headers: { authorization, "User-Agent": OAUTH_USER_AGENT },
  });

  const parsed = new URLSearchParams(await res.text());
  const oauth_token = parsed.get("oauth_token");
  const oauth_token_secret = parsed.get("oauth_token_secret");
  if (!oauth_token || !oauth_token_secret) {
    throw new GarminAuthError("OAuth1 exchange returned no token");
  }
  return {
    oauth_token,
    oauth_token_secret,
    mfa_token: parsed.get("mfa_token") ?? undefined,
    mfa_expiration_timestamp: parsed.get("mfa_expiration_timestamp") ?? undefined,
    domain: ctx.domain,
  };
}

export async function exchange(
  oauth1: OAuth1Token,
  ctx: SsoContext,
  opts: { login?: boolean } = {},
): Promise<OAuth2Token> {
  const consumer = await fetchConsumer(ctx.fetcher);
  const url = `https://connectapi.${ctx.domain}/oauth-service/oauth/exchange/user/2.0`;

  const bodyParams: Record<string, string> = {};
  if (opts.login) bodyParams["audience"] = "GARMIN_CONNECT_MOBILE_ANDROID_DI";
  if (oauth1.mfa_token) bodyParams["mfa_token"] = oauth1.mfa_token;

  const authorization = buildOAuth1Header({
    method: "POST",
    url,
    consumerKey: consumer.consumer_key,
    consumerSecret: consumer.consumer_secret,
    token: oauth1.oauth_token,
    tokenSecret: oauth1.oauth_token_secret,
    bodyParams,
  });

  const res = await ctx.fetcher.request(url, {
    method: "POST",
    headers: {
      authorization,
      "User-Agent": OAUTH_USER_AGENT,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(bodyParams).toString(),
  });

  return setExpirations((await res.json()) as RawOAuth2Token);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/auth/sso.test.ts`
Expected: PASS both describes.

- [ ] **Step 6: Commit**

```bash
git add src/auth/sso.ts tests/auth/sso.test.ts tests/helpers/sso-server.ts
git commit -m "feat: add SSO login success path with OAuth1 exchange"
```

---

### Task 7: MFA with serializable cross-request resume

**Files:**
- Modify: `src/auth/sso.ts` (add `resumeLogin`)
- Test: `tests/auth/sso-mfa.test.ts`

**Interfaces:**
- Consumes: `login`, `completeLogin`, `MfaState`, `CookieJar`.
- Produces: `resumeLogin(mfaState: MfaState, code: string, options?: { fetcher?: Fetcher }): Promise<{ state: "success"; oauth1: OAuth1Token; oauth2: OAuth2Token }>`

This is the spec's deliberate divergence from garth: `MfaState` is plain JSON, so the resume can happen in a different process from the login.

- [ ] **Step 1: Write the failing test**

`tests/auth/sso-mfa.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Fetcher } from "../../src/http/fetcher.js";
import { login, resumeLogin } from "../../src/auth/sso.js";
import { resetConsumerCache } from "../../src/auth/consumer.js";
import { GarminAuthError } from "../../src/errors.js";
import { makeSsoServer } from "../helpers/sso-server.js";

describe("MFA login", () => {
  let harness: ReturnType<typeof makeSsoServer>;

  beforeEach(() => {
    resetConsumerCache();
    harness = makeSsoServer({ loginOutcome: "mfa", mfaCode: "123456" });
    harness.server.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => harness.server.close());

  it("returns mfa_required with the method Garmin reported", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const result = await login("a@b.test", "pw", ctx);
    expect(result.state).toBe("mfa_required");
    if (result.state !== "mfa_required") throw new Error("unreachable");
    expect(result.mfaState.mfaMethod).toBe("sms");
    expect(result.mfaState.domain).toBe("garmin.com");
    expect(result.mfaState.loginParams.clientId).toBe("GCM_ANDROID_DARK");
  });

  it("mfaState survives JSON round-trip and carries the session cookies", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const result = await login("a@b.test", "pw", ctx);
    if (result.state !== "mfa_required") throw new Error("unreachable");

    const revived = JSON.parse(JSON.stringify(result.mfaState));
    expect(revived.cookies.some((c: { name: string }) => c.name === "SESSION")).toBe(true);
  });

  it("resumes in a FRESH client — the serverless case — and returns tokens", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const result = await login("a@b.test", "pw", ctx);
    if (result.state !== "mfa_required") throw new Error("unreachable");

    // Simulate a second HTTP request on a different instance: nothing but JSON survives.
    const transported = JSON.parse(JSON.stringify(result.mfaState));
    const resumed = await resumeLogin(transported, "123456");

    expect(resumed.state).toBe("success");
    expect(resumed.oauth1.oauth_token).toBe("o1tok");
    expect(resumed.oauth2.access_token).toBe("access-1");
  });

  it("replays the stored cookies on the verifyCode request", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const result = await login("a@b.test", "pw", ctx);
    if (result.state !== "mfa_required") throw new Error("unreachable");

    const fresh = new Fetcher();
    await resumeLogin(JSON.parse(JSON.stringify(result.mfaState)), "123456", {
      fetcher: fresh,
    });
    expect(fresh.jar.cookieHeaderFor("https://sso.garmin.com/sso/x")).toContain("SESSION=seed");
  });

  it("rejects a wrong code with GarminAuthError", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const result = await login("a@b.test", "pw", ctx);
    if (result.state !== "mfa_required") throw new Error("unreachable");

    await expect(resumeLogin(result.mfaState, "000000")).rejects.toThrow(GarminAuthError);
    await expect(resumeLogin(result.mfaState, "000000")).rejects.toThrow(/Wrong code/);
  });

  it("mfaState carries no password", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const result = await login("a@b.test", "hunter2", ctx);
    if (result.state !== "mfa_required") throw new Error("unreachable");
    expect(JSON.stringify(result.mfaState)).not.toContain("hunter2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/auth/sso-mfa.test.ts`
Expected: FAIL — `resumeLogin` is not exported.

- [ ] **Step 3: Add the implementation to `src/auth/sso.ts`**

Add this import at the top:

```ts
import { CookieJar } from "../http/cookie-jar.js";
import { Fetcher } from "../http/fetcher.js";
```

(Change the existing `import type { Fetcher }` line to a value import, since `resumeLogin` constructs one.)

Append:

```ts
export async function resumeLogin(
  mfaState: MfaState,
  code: string,
  options: { fetcher?: Fetcher } = {},
): Promise<{ state: "success"; oauth1: OAuth1Token; oauth2: OAuth2Token }> {
  const fetcher =
    options.fetcher ?? new Fetcher({ jar: CookieJar.fromJSON(mfaState.cookies) });
  if (options.fetcher) {
    // Restore the login session's cookies into the caller's fetcher.
    for (const cookie of mfaState.cookies) {
      fetcher.jar.setFromResponse(`https://${cookie.domain}${cookie.path}`, [
        `${cookie.name}=${cookie.value}; Path=${cookie.path}`,
      ]);
    }
  }
  const ctx: SsoContext = { fetcher, domain: mfaState.domain };

  const res = await fetcher.request(ssoUrl(ctx.domain, "/mobile/api/mfa/verifyCode"), {
    method: "POST",
    params: { ...mfaState.loginParams },
    headers: SSO_PAGE_HEADERS,
    json: {
      mfaMethod: mfaState.mfaMethod,
      mfaVerificationCode: code,
      rememberMyBrowser: false,
      reconsentList: [],
      mfaSetup: false,
    },
  });

  const body = requireSuccess((await res.json()) as SsoResponse);
  const ticket = body.serviceTicketId;
  if (!ticket) throw new GarminAuthError("MFA succeeded but returned no service ticket");
  return completeLogin(ticket, ctx);
}
```

- [ ] **Step 4: Run the full auth suite**

Run: `npm test -- tests/auth`
Expected: PASS — Task 6's tests still pass and the MFA tests now pass.

- [ ] **Step 5: Commit**

```bash
git add src/auth/sso.ts tests/auth/sso-mfa.test.ts
git commit -m "feat: add MFA login with JSON-serializable cross-request resume"
```

---

### Task 8: Token stores

**Files:**
- Create: `src/auth/token-store.ts`
- Test: `tests/auth/token-store.test.ts`

**Interfaces:**
- Consumes: `Tokens`, `OAuth1Token`, `OAuth2Token` (Task 5).
- Produces:
  - `interface TokenStore { load(): Promise<Tokens | null>; save(tokens: Tokens): Promise<void>; clear(): Promise<void> }`
  - `class MemoryTokenStore implements TokenStore`
  - `class FileTokenStore implements TokenStore` — constructor `(dir: string)`

`FileTokenStore` writes `oauth1_token.json` and `oauth2_token.json` in garth's exact on-disk shape so Python-produced tokens load directly.

- [ ] **Step 1: Write the failing test**

`tests/auth/token-store.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileTokenStore, MemoryTokenStore } from "../../src/auth/token-store.js";
import type { Tokens } from "../../src/auth/tokens.js";

const tokens: Tokens = {
  oauth1: {
    oauth_token: "o1",
    oauth_token_secret: "s1",
    mfa_token: "m1",
    domain: "garmin.com",
  },
  oauth2: {
    scope: "CONNECT_READ",
    jti: "j",
    token_type: "Bearer",
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    expires_at: 1_800_000_000,
    refresh_token_expires_in: 7200,
    refresh_token_expires_at: 1_800_003_600,
  },
};

describe("MemoryTokenStore", () => {
  it("returns null before anything is saved", async () => {
    await expect(new MemoryTokenStore().load()).resolves.toBeNull();
  });

  it("round-trips and clears", async () => {
    const store = new MemoryTokenStore();
    await store.save(tokens);
    await expect(store.load()).resolves.toEqual(tokens);
    await store.clear();
    await expect(store.load()).resolves.toBeNull();
  });
});

describe("FileTokenStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "gcjs-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when the directory has no tokens", async () => {
    await expect(new FileTokenStore(dir).load()).resolves.toBeNull();
  });

  it("round-trips through disk", async () => {
    const store = new FileTokenStore(dir);
    await store.save(tokens);
    await expect(store.load()).resolves.toEqual(tokens);
  });

  it("writes garth's two-file layout", async () => {
    await new FileTokenStore(dir).save(tokens);
    const o1 = JSON.parse(await readFile(join(dir, "oauth1_token.json"), "utf8"));
    const o2 = JSON.parse(await readFile(join(dir, "oauth2_token.json"), "utf8"));
    expect(o1.oauth_token).toBe("o1");
    expect(o1.oauth_token_secret).toBe("s1");
    expect(o2.access_token).toBe("at");
    expect(o2.expires_at).toBe(1_800_000_000);
  });

  it("loads tokens written by Python garth", async () => {
    await writeFile(
      join(dir, "oauth1_token.json"),
      JSON.stringify({
        oauth_token: "py1",
        oauth_token_secret: "pys1",
        mfa_token: null,
        mfa_expiration_timestamp: null,
        domain: "garmin.com",
      }),
    );
    await writeFile(
      join(dir, "oauth2_token.json"),
      JSON.stringify({ ...tokens.oauth2, access_token: "pyat" }),
    );
    const loaded = await new FileTokenStore(dir).load();
    expect(loaded?.oauth1.oauth_token).toBe("py1");
    expect(loaded?.oauth1.mfa_token).toBeUndefined();
    expect(loaded?.oauth2.access_token).toBe("pyat");
  });

  it("creates the directory when missing", async () => {
    const nested = join(dir, "a", "b");
    await new FileTokenStore(nested).save(tokens);
    await expect(new FileTokenStore(nested).load()).resolves.toEqual(tokens);
  });

  it("writes token files with owner-only permissions", async () => {
    await new FileTokenStore(dir).save(tokens);
    const mode = (await stat(join(dir, "oauth1_token.json"))).mode & 0o777;
    // Windows does not honour POSIX modes; assert only where it is meaningful.
    if (process.platform !== "win32") expect(mode).toBe(0o600);
  });

  it("clear removes both files and load returns null", async () => {
    const store = new FileTokenStore(dir);
    await store.save(tokens);
    await store.clear();
    await expect(store.load()).resolves.toBeNull();
  });

  it("returns null rather than throwing when only one file exists", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "oauth1_token.json"), JSON.stringify(tokens.oauth1));
    await expect(new FileTokenStore(dir).load()).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/auth/token-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/auth/token-store.ts`:

```ts
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OAuth1Token, OAuth2Token, Tokens } from "./tokens.js";

export interface TokenStore {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  #tokens: Tokens | null = null;

  async load(): Promise<Tokens | null> {
    return this.#tokens;
  }
  async save(tokens: Tokens): Promise<void> {
    this.#tokens = tokens;
  }
  async clear(): Promise<void> {
    this.#tokens = null;
  }
}

const OAUTH1_FILE = "oauth1_token.json";
const OAUTH2_FILE = "oauth2_token.json";

/** garth-compatible on-disk format: tokens written by Python garth load directly. */
export class FileTokenStore implements TokenStore {
  constructor(private readonly dir: string) {}

  async load(): Promise<Tokens | null> {
    try {
      const [raw1, raw2] = await Promise.all([
        readFile(join(this.dir, OAUTH1_FILE), "utf8"),
        readFile(join(this.dir, OAUTH2_FILE), "utf8"),
      ]);
      const parsed1 = JSON.parse(raw1) as Record<string, unknown>;
      const oauth1: OAuth1Token = {
        oauth_token: String(parsed1["oauth_token"]),
        oauth_token_secret: String(parsed1["oauth_token_secret"]),
        // Python writes null where TS wants undefined.
        mfa_token: (parsed1["mfa_token"] as string | null) ?? undefined,
        mfa_expiration_timestamp:
          (parsed1["mfa_expiration_timestamp"] as string | null) ?? undefined,
        domain: (parsed1["domain"] as string | null) ?? undefined,
      };
      return { oauth1, oauth2: JSON.parse(raw2) as OAuth2Token };
    } catch {
      return null;
    }
  }

  async save(tokens: Tokens): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await Promise.all([
      writeFile(join(this.dir, OAUTH1_FILE), JSON.stringify(tokens.oauth1, null, 2), {
        mode: 0o600,
      }),
      writeFile(join(this.dir, OAUTH2_FILE), JSON.stringify(tokens.oauth2, null, 2), {
        mode: 0o600,
      }),
    ]);
  }

  async clear(): Promise<void> {
    await Promise.all([
      rm(join(this.dir, OAUTH1_FILE), { force: true }),
      rm(join(this.dir, OAUTH2_FILE), { force: true }),
    ]);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/auth/token-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/token-store.ts tests/auth/token-store.test.ts
git commit -m "feat: add memory and garth-compatible file token stores"
```

---

### Task 9: GarminClient — bearer auth, auto-refresh, download, upload

**Files:**
- Create: `src/client.ts`
- Test: `tests/client.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces:
  - `interface GarminClientOptions { tokenStore?: TokenStore; isCn?: boolean; timeoutMs?: number; retries?: number; backoffMs?: number; fetchImpl?: typeof fetch }`
  - `class GarminClient` with:
    - `constructor(options?: GarminClientOptions)`
    - `login(email: string, password: string): Promise<LoginResult>`
    - `resumeLogin(mfaState: MfaState, code: string): Promise<void>`
    - `loadTokens(): Promise<boolean>`
    - `setTokens(tokens: Tokens): void`
    - `connectapi<T = unknown>(path: string, options?: ApiOptions): Promise<T | null>`
    - `download(path: string, options?: ApiOptions): Promise<Buffer>`
    - `upload(file: Blob, filename: string, path?: string): Promise<unknown>`
  - `interface ApiOptions { method?: string; params?: Record<string, string | number | undefined>; json?: unknown; headers?: Record<string, string> }`

- [ ] **Step 1: Write the failing test**

`tests/client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../src/client.js";
import { MemoryTokenStore } from "../src/auth/token-store.js";
import { GarminAuthError } from "../src/errors.js";
import { resetConsumerCache } from "../src/auth/consumer.js";
import type { Tokens } from "../src/auth/tokens.js";

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 10;

function tokensWith(expiresAt: number): Tokens {
  return {
    oauth1: { oauth_token: "o1tok", oauth_token_secret: "o1sec", domain: "garmin.com" },
    oauth2: {
      scope: "CONNECT_READ",
      jti: "j",
      token_type: "Bearer",
      access_token: "old-access",
      refresh_token: "rt",
      expires_in: 3600,
      expires_at: expiresAt,
      refresh_token_expires_in: 7200,
      refresh_token_expires_at: future,
    },
  };
}

let exchangeCount = 0;
let seenAuth: string[] = [];

const server = setupServer(
  http.get("https://thegarth.s3.amazonaws.com/oauth_consumer.json", () =>
    HttpResponse.json({ consumer_key: "ck", consumer_secret: "cs" }),
  ),
  http.post(
    "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0",
    () => {
      exchangeCount++;
      return HttpResponse.json({
        scope: "CONNECT_READ",
        jti: "j2",
        token_type: "Bearer",
        access_token: "fresh-access",
        refresh_token: "rt2",
        expires_in: 3600,
        refresh_token_expires_in: 7200,
      });
    },
  ),
  http.get("https://connectapi.garmin.com/thing", ({ request }) => {
    seenAuth.push(request.headers.get("authorization") ?? "");
    return HttpResponse.json({ ok: true });
  }),
  http.get("https://connectapi.garmin.com/empty", () => new HttpResponse(null, { status: 204 })),
  http.get("https://connectapi.garmin.com/file", () =>
    HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer),
  ),
  http.post("https://connectapi.garmin.com/upload-service/upload", async ({ request }) => {
    const form = await request.formData();
    const file = form.get("file") as File;
    return HttpResponse.json({ name: file.name, size: file.size });
  }),
  http.get("https://connectapi.garmin.com/forbidden", () => new HttpResponse("no", { status: 401 })),
);

beforeEach(() => {
  exchangeCount = 0;
  seenAuth = [];
  resetConsumerCache();
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => server.close());

describe("GarminClient", () => {
  it("throws GarminAuthError when no tokens are loaded", async () => {
    const client = new GarminClient();
    await expect(client.connectapi("/thing")).rejects.toThrow(GarminAuthError);
  });

  it("sends the bearer token on API calls", async () => {
    const client = new GarminClient();
    client.setTokens(tokensWith(future));
    await expect(client.connectapi("/thing")).resolves.toEqual({ ok: true });
    expect(seenAuth[0]).toBe("Bearer old-access");
  });

  it("loads tokens from the store", async () => {
    const store = new MemoryTokenStore();
    await store.save(tokensWith(future));
    const client = new GarminClient({ tokenStore: store });
    await expect(client.loadTokens()).resolves.toBe(true);
    await expect(client.connectapi("/thing")).resolves.toEqual({ ok: true });
  });

  it("loadTokens returns false on an empty store", async () => {
    const client = new GarminClient({ tokenStore: new MemoryTokenStore() });
    await expect(client.loadTokens()).resolves.toBe(false);
  });

  it("refreshes an expired access token before the call and persists it", async () => {
    const store = new MemoryTokenStore();
    await store.save(tokensWith(past));
    const client = new GarminClient({ tokenStore: store });
    await client.loadTokens();

    await client.connectapi("/thing");

    expect(exchangeCount).toBe(1);
    expect(seenAuth[0]).toBe("Bearer fresh-access");
    const saved = await store.load();
    expect(saved?.oauth2.access_token).toBe("fresh-access");
  });

  it("does not refresh a valid token", async () => {
    const client = new GarminClient();
    client.setTokens(tokensWith(future));
    await client.connectapi("/thing");
    expect(exchangeCount).toBe(0);
  });

  it("deduplicates concurrent refreshes into one exchange", async () => {
    const client = new GarminClient();
    client.setTokens(tokensWith(past));
    await Promise.all([
      client.connectapi("/thing"),
      client.connectapi("/thing"),
      client.connectapi("/thing"),
    ]);
    expect(exchangeCount).toBe(1);
  });

  it("returns null on 204", async () => {
    const client = new GarminClient();
    client.setTokens(tokensWith(future));
    await expect(client.connectapi("/empty")).resolves.toBeNull();
  });

  it("download returns a Buffer", async () => {
    const client = new GarminClient();
    client.setTokens(tokensWith(future));
    const buf = await client.download("/file");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect([...buf]).toEqual([1, 2, 3]);
  });

  it("upload posts multipart with the filename", async () => {
    const client = new GarminClient();
    client.setTokens(tokensWith(future));
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])]);
    await expect(client.upload(blob, "ride.fit")).resolves.toEqual({
      name: "ride.fit",
      size: 4,
    });
  });

  it("clears tokens and throws GarminAuthError when the API rejects auth", async () => {
    const store = new MemoryTokenStore();
    await store.save(tokensWith(future));
    const client = new GarminClient({ tokenStore: store });
    await client.loadTokens();
    await expect(client.connectapi("/forbidden")).rejects.toThrow(GarminAuthError);
  });

  it("uses the garmin.cn domain when isCn is set", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const client = new GarminClient({ isCn: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    client.setTokens(tokensWith(future));
    await client.connectapi("/thing");
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://connectapi.garmin.cn/thing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/client.test.ts`
Expected: FAIL — `../src/client.js` not found.

- [ ] **Step 3: Write the implementation**

`src/client.ts`:

```ts
import { GarminAuthError } from "./errors.js";
import { Fetcher } from "./http/fetcher.js";
import { API_USER_AGENT } from "./auth/constants.js";
import {
  exchange,
  login as ssoLogin,
  resumeLogin as ssoResumeLogin,
  type LoginResult,
  type MfaState,
  type SsoContext,
} from "./auth/sso.js";
import {
  authorizationHeader,
  isExpired,
  refreshExpired,
  type Tokens,
} from "./auth/tokens.js";
import { MemoryTokenStore, type TokenStore } from "./auth/token-store.js";

export interface GarminClientOptions {
  tokenStore?: TokenStore;
  isCn?: boolean;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ApiOptions {
  method?: string;
  params?: Record<string, string | number | undefined>;
  json?: unknown;
  headers?: Record<string, string>;
}

export class GarminClient {
  readonly domain: string;
  readonly tokenStore: TokenStore;

  #fetcher: Fetcher;
  #tokens: Tokens | null = null;
  #refreshing: Promise<void> | null = null;

  constructor(options: GarminClientOptions = {}) {
    this.domain = options.isCn ? "garmin.cn" : "garmin.com";
    this.tokenStore = options.tokenStore ?? new MemoryTokenStore();
    this.#fetcher = new Fetcher({
      timeoutMs: options.timeoutMs,
      retries: options.retries,
      backoffMs: options.backoffMs,
      fetchImpl: options.fetchImpl,
    });
  }

  get #ssoContext(): SsoContext {
    return { fetcher: this.#fetcher, domain: this.domain };
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const result = await ssoLogin(email, password, this.#ssoContext);
    if (result.state === "success") {
      await this.#persist({ oauth1: result.oauth1, oauth2: result.oauth2 });
    }
    return result;
  }

  async resumeLogin(mfaState: MfaState, code: string): Promise<void> {
    const result = await ssoResumeLogin(mfaState, code, { fetcher: this.#fetcher });
    await this.#persist({ oauth1: result.oauth1, oauth2: result.oauth2 });
  }

  /** Returns false when the store holds nothing. */
  async loadTokens(): Promise<boolean> {
    const tokens = await this.tokenStore.load();
    if (!tokens) return false;
    this.#tokens = tokens;
    return true;
  }

  setTokens(tokens: Tokens): void {
    this.#tokens = tokens;
  }

  getTokens(): Tokens | null {
    return this.#tokens;
  }

  async #persist(tokens: Tokens): Promise<void> {
    this.#tokens = tokens;
    await this.tokenStore.save(tokens);
  }

  async #ensureFresh(): Promise<Tokens> {
    const tokens = this.#tokens;
    if (!tokens) {
      throw new GarminAuthError("Not authenticated: call login() or loadTokens() first");
    }
    if (!isExpired(tokens.oauth2)) return tokens;

    if (refreshExpired(tokens.oauth2)) {
      await this.tokenStore.clear();
      this.#tokens = null;
      throw new GarminAuthError("Refresh token expired; log in again");
    }

    // Collapse concurrent refreshes into one exchange.
    this.#refreshing ??= (async () => {
      try {
        const oauth2 = await exchange(tokens.oauth1, this.#ssoContext);
        await this.#persist({ oauth1: tokens.oauth1, oauth2 });
      } catch (cause) {
        await this.tokenStore.clear();
        this.#tokens = null;
        throw new GarminAuthError("Token refresh failed; log in again", { cause });
      } finally {
        this.#refreshing = null;
      }
    })();
    await this.#refreshing;

    const refreshed = this.#tokens;
    if (!refreshed) throw new GarminAuthError("Token refresh failed; log in again");
    return refreshed;
  }

  async #apiRequest(path: string, options: ApiOptions = {}): Promise<Response> {
    const tokens = await this.#ensureFresh();
    return this.#fetcher.request(`https://connectapi.${this.domain}${path}`, {
      method: options.method,
      params: options.params,
      json: options.json,
      headers: {
        authorization: authorizationHeader(tokens.oauth2),
        "User-Agent": API_USER_AGENT,
        ...options.headers,
      },
    });
  }

  async connectapi<T = unknown>(path: string, options: ApiOptions = {}): Promise<T | null> {
    const res = await this.#apiRequest(path, options);
    if (res.status === 204) return null;
    const text = await res.text();
    if (text.length === 0) return null;
    return JSON.parse(text) as T;
  }

  async download(path: string, options: ApiOptions = {}): Promise<Buffer> {
    const res = await this.#apiRequest(path, options);
    return Buffer.from(await res.arrayBuffer());
  }

  async upload(
    file: Blob,
    filename: string,
    path = "/upload-service/upload",
  ): Promise<unknown> {
    const tokens = await this.#ensureFresh();
    const form = new FormData();
    form.append("file", file, filename);
    // Content-Type is deliberately unset so fetch adds the multipart boundary.
    const res = await this.#fetcher.request(`https://connectapi.${this.domain}${path}`, {
      method: "POST",
      body: form,
      headers: {
        authorization: authorizationHeader(tokens.oauth2),
        "User-Agent": API_USER_AGENT,
      },
    });
    return res.json();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/client.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Run the whole suite**

Run: `npm test && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/client.ts tests/client.test.ts
git commit -m "feat: add GarminClient with auto-refresh, download and upload"
```

---

### Task 10: Garmin facade — profile resolution and date handling

**Files:**
- Create: `src/garmin.ts`, `src/util/date.ts`
- Test: `tests/garmin.test.ts`, `tests/util/date.test.ts`

**Interfaces:**
- Consumes: `GarminClient` (Task 9).
- Produces:
  - `formatDate(value: string | Date): string`
  - `class Garmin` with `constructor(client: GarminClient)`, `readonly client`, `getUserProfile()`, `displayName()`, `fullName()`, `userName()`, `unitSystem()`
  - `interface SocialProfile { displayName: string; userName: string; fullName: string; profileId: number; [key: string]: unknown }`

`displayName()` is what every date-scoped endpoint interpolates into its path, so it is resolved once and cached on the instance.

- [ ] **Step 1: Write the failing tests**

`tests/util/date.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatDate } from "../../src/util/date.js";

describe("formatDate", () => {
  it("passes a well-formed string through", () => {
    expect(formatDate("2026-09-22")).toBe("2026-09-22");
  });

  it("formats a Date as YYYY-MM-DD in UTC", () => {
    expect(formatDate(new Date("2026-09-22T23:30:00Z"))).toBe("2026-09-22");
  });

  it("zero-pads month and day", () => {
    expect(formatDate(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01-05");
  });

  it("rejects a malformed string", () => {
    expect(() => formatDate("22-09-2026")).toThrow(/YYYY-MM-DD/);
    expect(() => formatDate("2026-9-2")).toThrow(/YYYY-MM-DD/);
  });

  it("rejects an impossible date", () => {
    expect(() => formatDate("2026-13-01")).toThrow(/valid date/);
  });

  it("rejects an invalid Date object", () => {
    expect(() => formatDate(new Date("nope"))).toThrow(/valid date/);
  });
});
```

`tests/garmin.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../src/client.js";
import { Garmin } from "../src/garmin.js";
import type { Tokens } from "../src/auth/tokens.js";

let profileCalls = 0;

const server = setupServer(
  http.get("https://connectapi.garmin.com/userprofile-service/socialProfile", () => {
    profileCalls++;
    return HttpResponse.json({
      displayName: "abc-display-name",
      userName: "testuser",
      fullName: "Test User",
      profileId: 1234,
      measurementSystem: "metric",
    });
  }),
);

const tokens: Tokens = {
  oauth1: { oauth_token: "o1", oauth_token_secret: "s1", domain: "garmin.com" },
  oauth2: {
    scope: "CONNECT_READ",
    jti: "j",
    token_type: "Bearer",
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token_expires_in: 7200,
    refresh_token_expires_at: Math.floor(Date.now() / 1000) + 7200,
  },
};

function makeGarmin(): Garmin {
  const client = new GarminClient();
  client.setTokens(tokens);
  return new Garmin(client);
}

beforeEach(() => {
  profileCalls = 0;
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => server.close());

describe("Garmin profile resolution", () => {
  it("returns the display name", async () => {
    await expect(makeGarmin().displayName()).resolves.toBe("abc-display-name");
  });

  it("returns full name, user name and unit system", async () => {
    const g = makeGarmin();
    await expect(g.fullName()).resolves.toBe("Test User");
    await expect(g.userName()).resolves.toBe("testuser");
    await expect(g.unitSystem()).resolves.toBe("metric");
  });

  it("fetches the profile only once", async () => {
    const g = makeGarmin();
    await g.displayName();
    await g.fullName();
    await g.userName();
    expect(profileCalls).toBe(1);
  });

  it("deduplicates concurrent profile lookups", async () => {
    const g = makeGarmin();
    await Promise.all([g.displayName(), g.displayName(), g.fullName()]);
    expect(profileCalls).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/util/date.test.ts tests/garmin.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`src/util/date.ts`:

```ts
import { GarminError } from "../errors.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalizes to the `YYYY-MM-DD` form Garmin expects. */
export function formatDate(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new GarminError("Expected a valid date");
    }
    return value.toISOString().slice(0, 10);
  }
  if (!ISO_DATE.test(value)) {
    throw new GarminError(`Expected a date in YYYY-MM-DD format, got "${value}"`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new GarminError(`Expected a valid date, got "${value}"`);
  }
  return value;
}
```

`src/garmin.ts`:

```ts
import type { GarminClient } from "./client.js";
import { GarminError } from "./errors.js";

export interface SocialProfile {
  displayName: string;
  userName: string;
  fullName: string;
  profileId: number;
  measurementSystem?: string;
  [key: string]: unknown;
}

export class Garmin {
  #profile: Promise<SocialProfile> | null = null;

  constructor(readonly client: GarminClient) {}

  /** Cached per instance; every date-scoped endpoint needs the display name. */
  getUserProfile(): Promise<SocialProfile> {
    this.#profile ??= (async () => {
      const profile = await this.client.connectapi<SocialProfile>(
        "/userprofile-service/socialProfile",
      );
      if (!profile) throw new GarminError("Garmin returned no user profile");
      return profile;
    })().catch((error: unknown) => {
      this.#profile = null; // allow a retry on the next call
      throw error;
    });
    return this.#profile;
  }

  async displayName(): Promise<string> {
    return (await this.getUserProfile()).displayName;
  }

  async fullName(): Promise<string> {
    return (await this.getUserProfile()).fullName;
  }

  async userName(): Promise<string> {
    return (await this.getUserProfile()).userName;
  }

  async unitSystem(): Promise<string | undefined> {
    return (await this.getUserProfile()).measurementSystem;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/util/date.test.ts tests/garmin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/garmin.ts src/util/date.ts tests/garmin.test.ts tests/util/date.test.ts
git commit -m "feat: add Garmin facade with cached profile resolution and date handling"
```

---

### Task 11: First endpoint slice

**Files:**
- Create: `src/services/wellness.ts`, `src/services/activities.ts`, `src/services/weight.ts`
- Modify: `src/garmin.ts` (mix the services into `Garmin`)
- Create: `src/types/wellness.ts`, `src/types/activities.ts`, `src/types/weight.ts`
- Test: `tests/services/endpoints.test.ts`

**Interfaces:**
- Consumes: `Garmin` (Task 10), `formatDate`, `GarminClient`.
- Produces these methods on `Garmin` — Plan 2 follows exactly this shape for the remaining services:
  - `getUserSummary(cdate: string | Date): Promise<UserSummary>`
  - `getStats(cdate: string | Date): Promise<UserSummary>` (alias of `getUserSummary`)
  - `getStepsData(cdate: string | Date): Promise<StepsEntry[]>`
  - `getHeartRates(cdate: string | Date): Promise<HeartRateData>`
  - `getSleepData(cdate: string | Date): Promise<SleepData>`
  - `getHrvData(cdate: string | Date): Promise<HrvData | null>`
  - `getBodyBattery(startdate: string | Date, enddate?: string | Date): Promise<BodyBatteryEntry[]>`
  - `getActivities(start?: number, limit?: number): Promise<Activity[]>`
  - `getActivity(activityId: number | string): Promise<Activity>`
  - `downloadActivity(activityId: number | string, format?: ActivityDownloadFormat): Promise<Buffer>`
  - `getWeighIns(startdate: string | Date, enddate: string | Date): Promise<WeighInRange>`
  - `addWeighIn(weight: number, unitKey?: "kg" | "lbs"): Promise<unknown>`
  - `deleteWeighIn(cdate: string | Date, weightPk: number): Promise<null>`

The endpoint paths below are taken from `python-garminconnect/garminconnect/__init__.py` on `master`. Before implementing, open that file and confirm each path still matches; if one differs, follow the Python source and note the difference in the commit message.

- [ ] **Step 1: Write the failing test**

`tests/services/endpoints.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import type { Tokens } from "../../src/auth/tokens.js";

const seen: { url: string; method: string; body?: unknown }[] = [];

function record(request: Request, body?: unknown) {
  seen.push({ url: request.url, method: request.method, body });
}

const API = "https://connectapi.garmin.com";

const server = setupServer(
  http.get(`${API}/userprofile-service/socialProfile`, () =>
    HttpResponse.json({
      displayName: "abc-display",
      userName: "testuser",
      fullName: "Test User",
      profileId: 1,
    }),
  ),
  http.get(`${API}/usersummary-service/usersummary/daily/abc-display`, ({ request }) => {
    record(request);
    return HttpResponse.json({ totalSteps: 8000, privacyProtected: false });
  }),
  http.get(`${API}/wellness-service/wellness/dailySummaryChart/abc-display`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ startGMT: "2026-09-22T00:00:00", steps: 100 }]);
  }),
  http.get(`${API}/wellness-service/wellness/dailyHeartRate/abc-display`, ({ request }) => {
    record(request);
    return HttpResponse.json({ restingHeartRate: 52 });
  }),
  http.get(`${API}/wellness-service/wellness/dailySleepData/abc-display`, ({ request }) => {
    record(request);
    return HttpResponse.json({ dailySleepDTO: { sleepTimeSeconds: 27000 } });
  }),
  http.get(`${API}/hrv-service/hrv/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ hrvSummary: { weeklyAvg: 45 } });
  }),
  http.get(`${API}/wellness-service/wellness/bodyBattery/reports/daily`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ date: "2026-09-22", charged: 70 }]);
  }),
  http.get(`${API}/activitylist-service/activities/search/activities`, ({ request }) => {
    record(request);
    return HttpResponse.json([{ activityId: 999, activityName: "Morning Run" }]);
  }),
  http.get(`${API}/activity-service/activity/999`, ({ request }) => {
    record(request);
    return HttpResponse.json({ activityId: 999, activityName: "Morning Run" });
  }),
  http.get(`${API}/download-service/files/activity/999`, ({ request }) => {
    record(request);
    return HttpResponse.arrayBuffer(new Uint8Array([70, 73, 84]).buffer);
  }),
  http.get(`${API}/download-service/export/gpx/activity/999`, ({ request }) => {
    record(request);
    return HttpResponse.arrayBuffer(new Uint8Array([60, 63]).buffer);
  }),
  http.get(`${API}/weight-service/weight/range/2026-09-01/2026-09-22`, ({ request }) => {
    record(request);
    return HttpResponse.json({ dailyWeightSummaries: [] });
  }),
  http.post(`${API}/weight-service/user-weight`, async ({ request }) => {
    record(request, await request.clone().json());
    return HttpResponse.json({ ok: true });
  }),
  http.delete(
    `${API}/weight-service/weight/2026-09-22/byversion/1700000000`,
    ({ request }) => {
      record(request);
      return new HttpResponse(null, { status: 204 });
    },
  ),
);

const tokens: Tokens = {
  oauth1: { oauth_token: "o1", oauth_token_secret: "s1", domain: "garmin.com" },
  oauth2: {
    scope: "CONNECT_READ",
    jti: "j",
    token_type: "Bearer",
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token_expires_in: 7200,
    refresh_token_expires_at: Math.floor(Date.now() / 1000) + 7200,
  },
};

function makeGarmin(): Garmin {
  const client = new GarminClient();
  client.setTokens(tokens);
  return new Garmin(client);
}

beforeEach(() => {
  seen.length = 0;
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => server.close());

describe("wellness endpoints", () => {
  it("getUserSummary interpolates the display name and sends calendarDate", async () => {
    const g = makeGarmin();
    await expect(g.getUserSummary("2026-09-22")).resolves.toEqual({
      totalSteps: 8000,
      privacyProtected: false,
    });
    expect(seen[0]!.url).toBe(
      `${API}/usersummary-service/usersummary/daily/abc-display?calendarDate=2026-09-22`,
    );
  });

  it("getStats is an alias of getUserSummary", async () => {
    const g = makeGarmin();
    await expect(g.getStats("2026-09-22")).resolves.toEqual(
      await g.getUserSummary("2026-09-22"),
    );
  });

  it("getUserSummary throws when Garmin marks the response privacy-protected", async () => {
    server.use(
      http.get(`${API}/usersummary-service/usersummary/daily/abc-display`, () =>
        HttpResponse.json({ privacyProtected: true }),
      ),
    );
    await expect(makeGarmin().getUserSummary("2026-09-22")).rejects.toThrow(
      /privacy|Authentication/i,
    );
  });

  it("getStepsData sends date and returns the array", async () => {
    const g = makeGarmin();
    await expect(g.getStepsData("2026-09-22")).resolves.toHaveLength(1);
    expect(seen[0]!.url).toBe(
      `${API}/wellness-service/wellness/dailySummaryChart/abc-display?date=2026-09-22`,
    );
  });

  it("getStepsData returns [] when Garmin sends 204", async () => {
    server.use(
      http.get(
        `${API}/wellness-service/wellness/dailySummaryChart/abc-display`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(makeGarmin().getStepsData("2026-09-22")).resolves.toEqual([]);
  });

  it("getHeartRates sends date", async () => {
    await makeGarmin().getHeartRates("2026-09-22");
    expect(seen[0]!.url).toBe(
      `${API}/wellness-service/wellness/dailyHeartRate/abc-display?date=2026-09-22`,
    );
  });

  it("getSleepData sends date and nonSleepBufferMinutes", async () => {
    await makeGarmin().getSleepData("2026-09-22");
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe("/wellness-service/wellness/dailySleepData/abc-display");
    expect(url.searchParams.get("date")).toBe("2026-09-22");
    expect(url.searchParams.get("nonSleepBufferMinutes")).toBe("60");
  });

  it("getHrvData puts the date in the path", async () => {
    await makeGarmin().getHrvData("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/hrv-service/hrv/2026-09-22`);
  });

  it("getBodyBattery defaults the end date to the start date", async () => {
    await makeGarmin().getBodyBattery("2026-09-22");
    const url = new URL(seen[0]!.url);
    expect(url.searchParams.get("startDate")).toBe("2026-09-22");
    expect(url.searchParams.get("endDate")).toBe("2026-09-22");
  });

  it("accepts a Date object anywhere a date string is accepted", async () => {
    await makeGarmin().getUserSummary(new Date("2026-09-22T10:00:00Z"));
    expect(seen[0]!.url).toContain("calendarDate=2026-09-22");
  });

  it("rejects a malformed date before making a request", async () => {
    await expect(makeGarmin().getUserSummary("22/09/2026")).rejects.toThrow(/YYYY-MM-DD/);
    expect(seen).toHaveLength(0);
  });
});

describe("activity endpoints", () => {
  it("getActivities sends start and limit with defaults", async () => {
    await makeGarmin().getActivities();
    const url = new URL(seen[0]!.url);
    expect(url.searchParams.get("start")).toBe("0");
    expect(url.searchParams.get("limit")).toBe("20");
  });

  it("getActivity fetches by id", async () => {
    await expect(makeGarmin().getActivity(999)).resolves.toMatchObject({ activityId: 999 });
  });

  it("downloadActivity defaults to FIT and returns a Buffer", async () => {
    const buf = await makeGarmin().downloadActivity(999);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(seen[0]!.url).toBe(`${API}/download-service/files/activity/999`);
  });

  it("downloadActivity uses the export path for GPX", async () => {
    await makeGarmin().downloadActivity(999, "GPX");
    expect(seen[0]!.url).toBe(`${API}/download-service/export/gpx/activity/999`);
  });
});

describe("weight endpoints", () => {
  it("getWeighIns builds a range path", async () => {
    await makeGarmin().getWeighIns("2026-09-01", "2026-09-22");
    expect(new URL(seen[0]!.url).pathname).toBe(
      "/weight-service/weight/range/2026-09-01/2026-09-22",
    );
  });

  it("addWeighIn posts grams for a kg value", async () => {
    await makeGarmin().addWeighIn(72.5, "kg");
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toMatchObject({ value: 72500, unitKey: "kg" });
  });

  it("addWeighIn converts lbs to grams", async () => {
    await makeGarmin().addWeighIn(160, "lbs");
    const body = seen[0]!.body as { value: number };
    expect(body.value).toBe(Math.round(160 * 453.592));
  });

  it("deleteWeighIn issues a DELETE and returns null on 204", async () => {
    await expect(makeGarmin().deleteWeighIn("2026-09-22", 1_700_000_000)).resolves.toBeNull();
    expect(seen[0]!.method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/services/endpoints.test.ts`
Expected: FAIL — the service modules do not exist.

- [ ] **Step 3: Write the response types**

`src/types/wellness.ts`:

```ts
export interface UserSummary {
  totalSteps?: number;
  totalDistanceMeters?: number;
  activeKilocalories?: number;
  privacyProtected?: boolean;
  [key: string]: unknown;
}

export interface StepsEntry {
  startGMT?: string;
  endGMT?: string;
  steps?: number;
  primaryActivityLevel?: string;
  [key: string]: unknown;
}

export interface HeartRateData {
  restingHeartRate?: number;
  maxHeartRate?: number;
  minHeartRate?: number;
  heartRateValues?: [number, number | null][];
  [key: string]: unknown;
}

export interface SleepData {
  dailySleepDTO?: Record<string, unknown>;
  sleepLevels?: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface HrvData {
  hrvSummary?: Record<string, unknown>;
  hrvReadings?: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface BodyBatteryEntry {
  date?: string;
  charged?: number;
  drained?: number;
  [key: string]: unknown;
}
```

`src/types/activities.ts`:

```ts
export interface Activity {
  activityId: number;
  activityName?: string;
  startTimeLocal?: string;
  distance?: number;
  duration?: number;
  activityType?: Record<string, unknown>;
  [key: string]: unknown;
}

export type ActivityDownloadFormat = "ORIGINAL" | "TCX" | "GPX" | "KML" | "CSV";
```

`src/types/weight.ts`:

```ts
export interface WeighInRange {
  dailyWeightSummaries?: Record<string, unknown>[];
  totalAverage?: Record<string, unknown>;
  [key: string]: unknown;
}
```

- [ ] **Step 4: Write the service modules**

`src/services/wellness.ts`:

```ts
import { GarminAuthError, GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import type {
  BodyBatteryEntry,
  HeartRateData,
  HrvData,
  SleepData,
  StepsEntry,
  UserSummary,
} from "../types/wellness.js";

/** Implemented against a host exposing `client` and `displayName()`. */
export interface WellnessHost {
  readonly client: GarminClient;
  displayName(): Promise<string>;
}

export async function getUserSummary(
  host: WellnessHost,
  cdate: string | Date,
): Promise<UserSummary> {
  const date = formatDate(cdate);
  const summary = await host.client.connectapi<UserSummary>(
    `/usersummary-service/usersummary/daily/${await host.displayName()}`,
    { params: { calendarDate: date } },
  );
  if (!summary) throw new GarminError("No user summary received from Garmin");
  if (summary.privacyProtected === true) {
    throw new GarminAuthError("User summary is privacy-protected");
  }
  return summary;
}

export async function getStepsData(
  host: WellnessHost,
  cdate: string | Date,
): Promise<StepsEntry[]> {
  const date = formatDate(cdate);
  const steps = await host.client.connectapi<StepsEntry[]>(
    `/wellness-service/wellness/dailySummaryChart/${await host.displayName()}`,
    { params: { date } },
  );
  return steps ?? [];
}

export async function getHeartRates(
  host: WellnessHost,
  cdate: string | Date,
): Promise<HeartRateData> {
  const date = formatDate(cdate);
  const data = await host.client.connectapi<HeartRateData>(
    `/wellness-service/wellness/dailyHeartRate/${await host.displayName()}`,
    { params: { date } },
  );
  if (!data) throw new GarminError("No heart rate data received from Garmin");
  return data;
}

export async function getSleepData(
  host: WellnessHost,
  cdate: string | Date,
): Promise<SleepData> {
  const date = formatDate(cdate);
  const data = await host.client.connectapi<SleepData>(
    `/wellness-service/wellness/dailySleepData/${await host.displayName()}`,
    { params: { date, nonSleepBufferMinutes: 60 } },
  );
  if (!data) throw new GarminError("No sleep data received from Garmin");
  return data;
}

export async function getHrvData(
  host: WellnessHost,
  cdate: string | Date,
): Promise<HrvData | null> {
  return host.client.connectapi<HrvData>(`/hrv-service/hrv/${formatDate(cdate)}`);
}

export async function getBodyBattery(
  host: WellnessHost,
  startdate: string | Date,
  enddate?: string | Date,
): Promise<BodyBatteryEntry[]> {
  const start = formatDate(startdate);
  const end = enddate === undefined ? start : formatDate(enddate);
  const data = await host.client.connectapi<BodyBatteryEntry[]>(
    "/wellness-service/wellness/bodyBattery/reports/daily",
    { params: { startDate: start, endDate: end } },
  );
  return data ?? [];
}
```

`src/services/activities.ts`:

```ts
import { GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import type { Activity, ActivityDownloadFormat } from "../types/activities.js";

export interface ActivitiesHost {
  readonly client: GarminClient;
}

export async function getActivities(
  host: ActivitiesHost,
  start = 0,
  limit = 20,
): Promise<Activity[]> {
  const activities = await host.client.connectapi<Activity[]>(
    "/activitylist-service/activities/search/activities",
    { params: { start, limit } },
  );
  return activities ?? [];
}

export async function getActivity(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<Activity> {
  const activity = await host.client.connectapi<Activity>(
    `/activity-service/activity/${activityId}`,
  );
  if (!activity) throw new GarminError(`No activity ${activityId} found`);
  return activity;
}

const DOWNLOAD_PATHS: Record<ActivityDownloadFormat, string> = {
  ORIGINAL: "/download-service/files/activity",
  TCX: "/download-service/export/tcx/activity",
  GPX: "/download-service/export/gpx/activity",
  KML: "/download-service/export/kml/activity",
  CSV: "/download-service/csvExporter",
};

export async function downloadActivity(
  host: ActivitiesHost,
  activityId: number | string,
  format: ActivityDownloadFormat = "ORIGINAL",
): Promise<Buffer> {
  const base = DOWNLOAD_PATHS[format];
  if (!base) {
    throw new GarminError(`Unknown download format "${format}"`);
  }
  return host.client.download(`${base}/${activityId}`);
}
```

`src/services/weight.ts`:

```ts
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import type { WeighInRange } from "../types/weight.js";

export interface WeightHost {
  readonly client: GarminClient;
}

const GRAMS_PER_LB = 453.592;

export async function getWeighIns(
  host: WeightHost,
  startdate: string | Date,
  enddate: string | Date,
): Promise<WeighInRange> {
  const start = formatDate(startdate);
  const end = formatDate(enddate);
  const data = await host.client.connectapi<WeighInRange>(
    `/weight-service/weight/range/${start}/${end}`,
    { params: { includeAll: "true" } },
  );
  return data ?? {};
}

export async function addWeighIn(
  host: WeightHost,
  weight: number,
  unitKey: "kg" | "lbs" = "kg",
): Promise<unknown> {
  // Garmin stores weight in grams regardless of the unit the caller used.
  const grams =
    unitKey === "kg" ? Math.round(weight * 1000) : Math.round(weight * GRAMS_PER_LB);
  return host.client.connectapi("/weight-service/user-weight", {
    method: "POST",
    json: {
      dateTimestamp: new Date().toISOString().slice(0, 19) + ".00",
      gmtTimestamp: new Date().toISOString().slice(0, 19) + ".00",
      unitKey,
      sourceType: "MANUAL",
      value: grams,
    },
  });
}

export async function deleteWeighIn(
  host: WeightHost,
  cdate: string | Date,
  weightPk: number,
): Promise<null> {
  await host.client.connectapi(
    `/weight-service/weight/${formatDate(cdate)}/byversion/${weightPk}`,
    { method: "DELETE" },
  );
  return null;
}
```

- [ ] **Step 5: Wire the services into `Garmin`**

Append these methods to the `Garmin` class in `src/garmin.ts`, and add the imports:

```ts
import * as activities from "./services/activities.js";
import * as weight from "./services/weight.js";
import * as wellness from "./services/wellness.js";
import type { ActivityDownloadFormat } from "./types/activities.js";
```

Inside `class Garmin`:

```ts
  // --- wellness ---
  getUserSummary(cdate: string | Date) {
    return wellness.getUserSummary(this, cdate);
  }
  /** Alias kept for parity with python-garminconnect's get_stats. */
  getStats(cdate: string | Date) {
    return wellness.getUserSummary(this, cdate);
  }
  getStepsData(cdate: string | Date) {
    return wellness.getStepsData(this, cdate);
  }
  getHeartRates(cdate: string | Date) {
    return wellness.getHeartRates(this, cdate);
  }
  getSleepData(cdate: string | Date) {
    return wellness.getSleepData(this, cdate);
  }
  getHrvData(cdate: string | Date) {
    return wellness.getHrvData(this, cdate);
  }
  getBodyBattery(startdate: string | Date, enddate?: string | Date) {
    return wellness.getBodyBattery(this, startdate, enddate);
  }

  // --- activities ---
  getActivities(start?: number, limit?: number) {
    return activities.getActivities(this, start, limit);
  }
  getActivity(activityId: number | string) {
    return activities.getActivity(this, activityId);
  }
  downloadActivity(activityId: number | string, format?: ActivityDownloadFormat) {
    return activities.downloadActivity(this, activityId, format);
  }

  // --- weight ---
  getWeighIns(startdate: string | Date, enddate: string | Date) {
    return weight.getWeighIns(this, startdate, enddate);
  }
  addWeighIn(weightValue: number, unitKey?: "kg" | "lbs") {
    return weight.addWeighIn(this, weightValue, unitKey);
  }
  deleteWeighIn(cdate: string | Date, weightPk: number) {
    return weight.deleteWeighIn(this, cdate, weightPk);
  }
```

- [ ] **Step 6: Export the public surface**

Replace `src/index.ts` with:

```ts
export * from "./errors.js";
export { GarminClient, type ApiOptions, type GarminClientOptions } from "./client.js";
export { Garmin, type SocialProfile } from "./garmin.js";
export {
  FileTokenStore,
  MemoryTokenStore,
  type TokenStore,
} from "./auth/token-store.js";
export type {
  OAuth1Token,
  OAuth2Token,
  Tokens,
} from "./auth/tokens.js";
export type { LoginResult, MfaState } from "./auth/sso.js";
export type * from "./types/wellness.js";
export type * from "./types/activities.js";
export type * from "./types/weight.js";
```

- [ ] **Step 7: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/services src/types src/garmin.ts src/index.ts tests/services/endpoints.test.ts
git commit -m "feat: add first endpoint slice covering wellness, activities and weight"
```

---

### Task 12: Fixture recording and live smoke test

**Files:**
- Create: `scripts/record-fixtures.ts`, `scripts/login.ts`
- Create: `tests/live/smoke.test.ts`, `vitest.live.config.ts`
- Create: `tests/helpers/scrub.ts`
- Test: `tests/helpers/scrub.test.ts`

**Interfaces:**
- Consumes: `GarminClient`, `Garmin`, `FileTokenStore`.
- Produces: `scrub(value: unknown): unknown` — removes personal data before a fixture is written.

- [ ] **Step 1: Write the failing scrub test**

`tests/helpers/scrub.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scrub } from "./scrub.js";

describe("scrub", () => {
  it("replaces name fields", () => {
    expect(scrub({ fullName: "Real Person", userName: "realuser" })).toEqual({
      fullName: "Test User",
      userName: "testuser",
    });
  });

  it("replaces the display name consistently", () => {
    expect(scrub({ displayName: "9f8e-real-guid" })).toEqual({
      displayName: "abc-display",
    });
  });

  it("redacts emails anywhere in a string", () => {
    expect(scrub({ note: "contact me at real@person.test please" })).toEqual({
      note: "contact me at redacted@example.test please",
    });
  });

  it("zeroes coordinates", () => {
    expect(scrub({ startLatitude: 46.05, startLongitude: 14.5 })).toEqual({
      startLatitude: 0,
      startLongitude: 0,
    });
  });

  it("redacts token-ish fields", () => {
    expect(
      scrub({ access_token: "real", refresh_token: "real", oauth_token_secret: "real" }),
    ).toEqual({
      access_token: "redacted",
      refresh_token: "redacted",
      oauth_token_secret: "redacted",
    });
  });

  it("recurses into arrays and nested objects", () => {
    expect(scrub({ items: [{ fullName: "Real Person" }] })).toEqual({
      items: [{ fullName: "Test User" }],
    });
  });

  it("leaves ordinary metric values alone", () => {
    expect(scrub({ totalSteps: 8123, restingHeartRate: 52 })).toEqual({
      totalSteps: 8123,
      restingHeartRate: 52,
    });
  });

  it("replaces numeric ids", () => {
    expect(scrub({ profileId: 987654321, userProfileId: 987654321 })).toEqual({
      profileId: 1,
      userProfileId: 1,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/helpers/scrub.test.ts`
Expected: FAIL — `./scrub.js` not found.

- [ ] **Step 3: Write the scrubber**

`tests/helpers/scrub.ts`:

```ts
const STRING_REPLACEMENTS: Record<string, string> = {
  fullName: "Test User",
  userName: "testuser",
  displayName: "abc-display",
  firstName: "Test",
  lastName: "User",
  access_token: "redacted",
  refresh_token: "redacted",
  oauth_token: "redacted",
  oauth_token_secret: "redacted",
  mfa_token: "redacted",
  jti: "redacted",
};

const NUMBER_REPLACEMENTS: Record<string, number> = {
  profileId: 1,
  userProfileId: 1,
  startLatitude: 0,
  startLongitude: 0,
  endLatitude: 0,
  endLongitude: 0,
  latitude: 0,
  longitude: 0,
};

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/** Removes personal data so a recorded fixture is safe to commit. */
export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value === null || typeof value !== "object") {
    return typeof value === "string" ? value.replace(EMAIL, "redacted@example.test") : value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string" && key in STRING_REPLACEMENTS) {
      out[key] = STRING_REPLACEMENTS[key];
    } else if (typeof val === "number" && key in NUMBER_REPLACEMENTS) {
      out[key] = NUMBER_REPLACEMENTS[key];
    } else {
      out[key] = scrub(val);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/helpers/scrub.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the login and recording scripts**

`scripts/login.ts` — run once to produce tokens on disk:

```ts
/**
 * One-time interactive login.
 *   GARMIN_EMAIL=… GARMIN_PASSWORD=… npx tsx scripts/login.ts ./tokens
 * Prompts for an MFA code on stdin when Garmin asks for one.
 */
import { createInterface } from "node:readline/promises";
import { GarminClient } from "../src/client.js";
import { FileTokenStore } from "../src/auth/token-store.js";

const dir = process.argv[2] ?? "./tokens";
const email = process.env["GARMIN_EMAIL"];
const password = process.env["GARMIN_PASSWORD"];

if (!email || !password) {
  console.error("Set GARMIN_EMAIL and GARMIN_PASSWORD");
  process.exit(1);
}

const client = new GarminClient({ tokenStore: new FileTokenStore(dir) });
const result = await client.login(email, password);

if (result.state === "mfa_required") {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = await rl.question(`MFA code (sent via ${result.mfaState.mfaMethod}): `);
  rl.close();
  await client.resumeLogin(result.mfaState, code.trim());
}

console.log(`Tokens written to ${dir}`);
```

`scripts/record-fixtures.ts`:

```ts
/**
 * Refreshes recorded fixtures from the live API.
 *   npx tsx scripts/record-fixtures.ts ./tokens
 * Requires tokens produced by scripts/login.ts. Output is scrubbed before writing.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GarminClient } from "../src/client.js";
import { Garmin } from "../src/garmin.js";
import { FileTokenStore } from "../src/auth/token-store.js";
import { scrub } from "../tests/helpers/scrub.js";

const dir = process.argv[2] ?? "./tokens";
const out = "tests/fixtures";
const date = process.argv[3] ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

const client = new GarminClient({ tokenStore: new FileTokenStore(dir) });
if (!(await client.loadTokens())) {
  console.error(`No tokens in ${dir}. Run scripts/login.ts first.`);
  process.exit(1);
}
const garmin = new Garmin(client);

const captures: [string, () => Promise<unknown>][] = [
  ["social-profile", () => garmin.getUserProfile()],
  ["user-summary", () => garmin.getUserSummary(date)],
  ["steps", () => garmin.getStepsData(date)],
  ["heart-rates", () => garmin.getHeartRates(date)],
  ["sleep", () => garmin.getSleepData(date)],
  ["hrv", () => garmin.getHrvData(date)],
  ["body-battery", () => garmin.getBodyBattery(date)],
  ["activities", () => garmin.getActivities(0, 5)],
];

await mkdir(out, { recursive: true });
for (const [name, fetchOne] of captures) {
  try {
    const data = await fetchOne();
    await writeFile(join(out, `${name}.json`), JSON.stringify(scrub(data), null, 2) + "\n");
    console.log(`recorded ${name}`);
  } catch (error) {
    console.error(`FAILED ${name}:`, error instanceof Error ? error.message : error);
  }
}
```

Add `tsx` as a dev dependency and a script entry:

```bash
npm install -D tsx
npm pkg set scripts.login="tsx scripts/login.ts"
npm pkg set scripts.record="tsx scripts/record-fixtures.ts"
```

- [ ] **Step 6: Write the live smoke test**

`vitest.live.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/live/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
```

`tests/live/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { FileTokenStore } from "../../src/auth/token-store.js";

const dir = process.env["GARMIN_TOKENS"] ?? "./tokens";
const hasCredentials = Boolean(process.env["GARMIN_EMAIL"] && process.env["GARMIN_PASSWORD"]);

/**
 * Opt-in: this is how you find out Garmin changed the SSO flow.
 * Run with `npm run test:live` after `npm run login`.
 */
describe.skipIf(!hasCredentials)("live smoke", () => {
  it("logs in fresh and reads the profile", async () => {
    const client = new GarminClient();
    const result = await client.login(
      process.env["GARMIN_EMAIL"]!,
      process.env["GARMIN_PASSWORD"]!,
    );
    if (result.state === "mfa_required") {
      console.warn("MFA required — skipping fresh-login assertion; use stored tokens");
      return;
    }
    const profile = await new Garmin(client).getUserProfile();
    expect(profile.displayName).toBeTruthy();
  });

  it("reads yesterday's summary from stored tokens", async () => {
    const client = new GarminClient({ tokenStore: new FileTokenStore(dir) });
    if (!(await client.loadTokens())) {
      console.warn(`No tokens in ${dir}; run npm run login first`);
      return;
    }
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const summary = await new Garmin(client).getUserSummary(yesterday);
    expect(summary).toBeTypeOf("object");
  });
});
```

- [ ] **Step 7: Verify the live suite skips cleanly without credentials**

Run: `npm run test:live`
Expected: the suite reports skipped tests and exits 0. No network access occurs.

- [ ] **Step 8: Commit**

```bash
git add scripts tests/helpers/scrub.ts tests/helpers/scrub.test.ts tests/live vitest.live.config.ts package.json package-lock.json
git commit -m "feat: add fixture recording, login script and opt-in live smoke test"
```

---

### Task 13: Build, docs and release readiness

**Files:**
- Create: `tsup.config.ts`, `README.md`, `NOTICE`, `LICENSE`, `.github/workflows/ci.yml`
- Test: `tests/build.test.ts`

**Interfaces:**
- Consumes: the whole package.
- Produces: a publishable `dist/` and the documented Next.js usage.

- [ ] **Step 1: Write the failing build test**

`tests/build.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("package contract", () => {
  it("declares zero runtime dependencies", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("requires Node 18 or newer", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    expect(pkg.engines.node).toBe(">=18");
  });

  it("exports types before import and require", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    expect(Object.keys(pkg.exports["."])[0]).toBe("types");
  });

  it("does not import React or DOM-only globals anywhere in src", async () => {
    const { globSync } = await import("node:fs");
    const files = globSync("src/**/*.ts");
    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, `${file} must stay server-only`).not.toMatch(
        /from "react"|\bdocument\.|\bwindow\./,
      );
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes or fails honestly**

Run: `npm test -- tests/build.test.ts`
Expected: PASS if Tasks 1–12 followed the constraints. If the exports-ordering case fails, fix `package.json` rather than the test.

- [ ] **Step 3: Write `tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  platform: "node",
});
```

- [ ] **Step 4: Build and verify both module formats load**

Run:

```bash
npm install -D tsup
npm run build
node -e "import('./dist/index.js').then(m => console.log(typeof m.GarminClient))"
node -e "console.log(typeof require('./dist/index.cjs').GarminClient)"
```

Expected: `function` printed twice.

- [ ] **Step 5: Write `README.md`**

````markdown
# garminconnect-js

TypeScript client for the Garmin Connect API. A port of
[python-garminconnect](https://github.com/cyberjunky/python-garminconnect) and
[garth](https://github.com/matin/garth), built for Node and Next.js server runtimes.

Zero runtime dependencies. Node 18+.

## Install

```bash
npm install garminconnect-js
```

## Node runtime only

This library uses `node:crypto` and `Buffer`. It does not run on the Edge runtime.
In a Next.js route handler:

```ts
export const runtime = "nodejs";
```

Never import it into a Client Component — credentials and tokens must stay on the server.

## One-time login

Log in once, persist the tokens, and never send credentials again:

```ts
import { GarminClient, FileTokenStore } from "garminconnect-js";

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
const result = await client.login(process.env.GARMIN_EMAIL!, process.env.GARMIN_PASSWORD!);

if (result.state === "mfa_required") {
  const code = await promptForCode(); // your UI
  await client.resumeLogin(result.mfaState, code);
}
```

## MFA across two HTTP requests

`mfaState` is plain JSON with no password in it, so it survives a round trip through a
session store. This is what makes MFA work on serverless, where the code arrives in a
different request than the one that started the login.

```ts
// app/api/garmin/login/route.ts
export const runtime = "nodejs";

export async function POST(req: Request) {
  const { email, password } = await req.json();
  const client = new GarminClient({ tokenStore: myStore });
  const result = await client.login(email, password);

  if (result.state === "mfa_required") {
    await session.set("garminMfa", result.mfaState); // encrypted session
    return Response.json({ mfaRequired: true, method: result.mfaState.mfaMethod });
  }
  return Response.json({ mfaRequired: false });
}

// app/api/garmin/mfa/route.ts
export async function POST(req: Request) {
  const { code } = await req.json();
  const mfaState = await session.get("garminMfa");
  const client = new GarminClient({ tokenStore: myStore });
  await client.resumeLogin(mfaState, code);
  await session.delete("garminMfa");
  return Response.json({ ok: true });
}
```

Treat `mfaState` as a short-lived secret: encrypt it at rest and delete it once used.

## Reading data

```ts
// lib/garmin.ts
import { GarminClient, Garmin } from "garminconnect-js";

export async function getGarmin() {
  const client = new GarminClient({ tokenStore: myStore });
  if (!(await client.loadTokens())) throw new Error("Not connected to Garmin");
  return new Garmin(client);
}

// app/api/sleep/route.ts
export const runtime = "nodejs";

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date")!;
  const garmin = await getGarmin();
  return Response.json(await garmin.getSleepData(date));
}
```

The OAuth2 token refreshes automatically before it expires and the refreshed token is
written back to your store. You never call refresh yourself.

## Bring your own token storage

`FileTokenStore` suits scripts and a single long-lived server. On serverless, implement
the three-method interface against whatever you already run:

```ts
import type { TokenStore, Tokens } from "garminconnect-js";

export class RedisTokenStore implements TokenStore {
  constructor(private redis: Redis, private userId: string) {}

  async load(): Promise<Tokens | null> {
    const raw = await this.redis.get(`garmin:${this.userId}`);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  }
  async save(tokens: Tokens): Promise<void> {
    await this.redis.set(`garmin:${this.userId}`, JSON.stringify(tokens));
  }
  async clear(): Promise<void> {
    await this.redis.del(`garmin:${this.userId}`);
  }
}
```

`FileTokenStore` uses garth's on-disk format, so tokens produced by Python `garth` load
here unchanged.

## Errors

| Error | Meaning |
|---|---|
| `GarminAuthError` | 401/403, failed SSO, or expired tokens. Log in again. |
| `GarminRateLimitError` | 429. Carries `retryAfter` seconds when Garmin sends it. |
| `GarminConnectionError` | Network failure or timeout, after retries. |
| `GarminHttpError` | Any other non-2xx. Carries `status`, `url`, `body`. |

## Caveats

Garmin Connect has no public API. This library talks to the endpoints the mobile app
uses, with credentials fetched from the same third-party source `garth` uses. Garmin can
change or break any of it without notice. Don't build anything safety-critical on it, and
expect to update when login stops working.

## License

MIT. See `NOTICE` for attribution to python-garminconnect and garth.
````

- [ ] **Step 6: Write `NOTICE` and `LICENSE`**

`NOTICE`:

```
garminconnect-js

This project is a TypeScript port of two MIT-licensed Python projects:

  python-garminconnect — https://github.com/cyberjunky/python-garminconnect
    Copyright (c) Ron Klinkien and contributors

  garth — https://github.com/matin/garth
    Copyright (c) Matin Tamizi and contributors

The endpoint surface follows python-garminconnect. The SSO and OAuth flow
follows garth. Neither project is affiliated with this one.

Garmin and Garmin Connect are trademarks of Garmin Ltd. This project is not
affiliated with, endorsed by, or supported by Garmin.
```

`LICENSE`: the standard MIT text, copyright the repository owner, year 2026.

- [ ] **Step 7: Write CI**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

CI never runs `test:live` — it has no credentials and must not hit Garmin.

- [ ] **Step 8: Run everything**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add tsup.config.ts README.md NOTICE LICENSE .github tests/build.test.ts package.json package-lock.json
git commit -m "chore: add build config, docs and CI"
```

---

## Definition of done for this plan

- `npm test` passes; `npm run typecheck` clean; `npm run build` emits working ESM and CJS.
- `npm run login` completes a real login (with MFA if the account has it) and writes tokens.
- A Next.js route handler can call `getSleepData` with stored tokens and no Python.
- `dependencies` is still `{}`.

## What Plan 2 covers

The remaining ~145 methods from `python-garminconnect/garminconnect/__init__.py`, grouped
one task per service file, each following Task 11 exactly: stress and body battery events,
blood pressure, hydration, respiration, SpO2, floors, intensity minutes, steps ranges,
max metrics, FTP and lactate threshold, training readiness/status, endurance score, hill
score, running tolerance, race predictions, fitness age, personal records, badges and
challenges, devices and device settings, solar, gear, goals, workouts (including the
per-sport upload helpers and scheduling), activity detail endpoints (splits, weather, HR
and power zones, exercise sets, gear association), progress summaries, women's health,
lifestyle logging, training plans, nutrition, golf, and the GraphQL passthrough.
