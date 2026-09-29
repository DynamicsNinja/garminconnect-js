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
        ? ({ state: "mfa_required", mfaState: { flow: "mobile" } as unknown as MfaState })
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

  it("a double submit, or a reload of the done page, neither crashes nor reveals the password", async () => {
    let resets = 0;
    // A slow login, so both submits of the double click are in flight at the same time.
    const slow = (): SignInClient => {
      const inner = fakeClient("ok");
      return { ...inner, login: (e, p) => new Promise((r) => setTimeout(r, 50)).then(() => inner.login(e, p)) };
    };
    page = await startSignInPage({ createClient: slow, onSignedIn: () => resets++ });
    const key = keyOf(page.url);
    const submit = () => request(page!.url, { body: { key, step: "credentials", email: "a@b.c", password: PASSWORD } });
    // Two submits at once (a double click), then a late submit and a reload after the first finished.
    const settled = await Promise.allSettled([submit(), submit()]);
    settled.push(...(await Promise.allSettled([submit(), request(page.url)])));
    for (const s of settled) {
      // A refused or reset connection is fine (the page already closed); a response must be the done page.
      if (s.status === "fulfilled") {
        expect(s.value.status).toBe(200);
        // The real signed-in name, not a generic placeholder — including on the trailing reload,
        // which hits the already-`finished` branch rather than `finish()` itself.
        expect(s.value.body).toContain("Signed in as runner42");
        expect(s.value.body).not.toContain(PASSWORD);
      }
    }
    expect(settled.some((s) => s.status === "fulfilled")).toBe(true);
    expect(resets).toBe(1);
    await page.closed;
  });

  it("still shuts down promptly when the browser drops the request during a slow login", async () => {
    let resets = 0;
    const slow = (): SignInClient => {
      const inner = fakeClient("ok");
      return { ...inner, login: (e, p) => new Promise((r) => setTimeout(r, 100)).then(() => inner.login(e, p)) };
    };
    page = await startSignInPage({ createClient: slow, onSignedIn: () => resets++ });
    const u = new URL(page.url);
    const body = new URLSearchParams({ key: keyOf(page.url), step: "credentials", email: "a@b.c", password: PASSWORD }).toString();
    const req = http.request({
      host: u.hostname, port: u.port, path: u.pathname, method: "POST",
      headers: { host: u.host, "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) },
    });
    req.on("error", () => {}); // the abort below
    req.end(body);
    setTimeout(() => req.destroy(), 30); // the tab closes (or the first click is cancelled) mid-login

    const timedOut = new Promise<string>((r) => setTimeout(() => r("still open"), 2000));
    expect(await Promise.race([page.closed.then(() => "closed"), timedOut])).toBe("closed");
    expect(resets).toBe(1);
  });

  it("closes itself after the idle time", async () => {
    page = await startSignInPage({ createClient: () => fakeClient("ok"), onSignedIn: () => {}, idleMs: 50 });
    await page.closed;
    await expect(request(page.url)).rejects.toThrow();
  });
});
