import { spawn } from "node:child_process";
import http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { Garmin, GarminAuthError, GarminClient, type LoginResult } from "garminconnect-js";
import { openInBrowser, signInTools } from "../src/signin-tool.js";
import { startSignInPage, type SignInClient } from "../src/signin-page.js";
import type { Session } from "../src/session.js";
import { NotLoggedInError } from "../src/session.js";
import { connect, fakeFetch, PROFILE_ROUTE, sessionFor, testConfig, textOf } from "./helpers.js";

// Replaced wholesale (not spied): "node:child_process"'s named exports aren't configurable in
// this runtime, so `vi.spyOn` fails with "Cannot redefine property: spawn". A full mock also means
// no test ever actually launches a browser process.
vi.mock("node:child_process", () => ({ spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })) }));

function neverSignedInSession(): Session & { resets: number } {
  const session = {
    resets: 0,
    get: async () => {
      throw new NotLoggedInError("No saved Garmin login");
    },
    reset() {
      session.resets++;
    },
  };
  return session;
}

const unusedClient = (): SignInClient => ({
  login: async () => {
    throw new Error("not used");
  },
  resumeLogin: async () => {},
  displayName: async () => "x",
});

/** Raw HTTP, so a test can drive the sign-in page's form the way a browser would. */
function rawRequest(url: string, body?: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? new URLSearchParams(body).toString() : undefined;
    const req = http.request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname,
        method: payload ? "POST" : "GET",
        headers: {
          host: u.host,
          ...(payload && {
            "content-type": "application/x-www-form-urlencoded",
            "content-length": Buffer.byteLength(payload),
          }),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Polls a page's URL until the connection is refused, i.e. its server has actually closed. Only
 * safe to use when the page closes for a reason OTHER than its idle timer (e.g. a finished
 * sign-in): each poll is itself a request, and the page's idle timer resets on every request, so
 * polling a page that is only waiting to idle out would keep extending its life forever.
 */
async function waitUntilClosed(url: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await rawRequest(url);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`sign-in page at ${url} never closed within ${timeoutMs}ms`);
}

/** For a page left to idle out: sleep past `idleMs`, then a single check that it is gone. */
async function expectClosedAfterIdle(url: string, idleMs: number): Promise<void> {
  await new Promise((r) => setTimeout(r, idleMs + 200));
  await expect(rawRequest(url)).rejects.toThrow();
}

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
    const idleMs = 50;
    const client = await connect({ config: testConfig(), session: neverSignedInSession() }, [
      signInTools({ openUrl: (u) => opened.push(u), createClient: unusedClient, idleMs }),
    ]);
    const first = textOf(await client.callTool({ name: "sign_in_to_garmin", arguments: {} }));
    const second = textOf(await client.callTool({ name: "sign_in_to_garmin", arguments: {} }));
    expect(opened).toHaveLength(2);
    expect(opened[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}$/);
    expect(opened[1]).toBe(opened[0]);
    expect(first).toContain(opened[0]!);
    expect(first).toContain("tell me when you're done");
    expect(second).toContain(opened[0]!);
    await expectClosedAfterIdle(opened[0]!, idleMs);
  });

  it("treats an expired session (profile call rejected) as not signed in", async () => {
    const opened: string[] = [];
    const idleMs = 50;
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
      signInTools({ openUrl: (u) => opened.push(u), createClient: unusedClient, idleMs }),
    ]);
    const text = textOf(await client.callTool({ name: "sign_in_to_garmin", arguments: {} }));
    expect(opened).toHaveLength(1);
    expect(text).toContain("sign-in page opened");
    await expectClosedAfterIdle(opened[0]!, idleMs);
  });

  it("wires a real POST through: resets the session with the configured tokenDir, then opens a fresh page next time", async () => {
    const opened: string[] = [];
    const tokenDirs: string[] = [];
    const session = neverSignedInSession();
    // Big enough that the idle timer never fires before the explicit POST below finishes the
    // sign-in; small enough that the SECOND page (never posted to, just left idle) closes quickly.
    const idleMs = 300;
    const createClient = (tokenDir: string): SignInClient => {
      tokenDirs.push(tokenDir);
      return {
        login: async () => ({ state: "success" } as LoginResult),
        resumeLogin: async () => {},
        displayName: async () => "runner42",
      };
    };
    const client = await connect({ config: testConfig({ tokenDir: "/configured/dir" }), session }, [
      signInTools({ openUrl: (u) => opened.push(u), createClient, idleMs }),
    ]);

    const first = textOf(await client.callTool({ name: "sign_in_to_garmin", arguments: {} }));
    const url = opened[0]!;
    expect(first).toContain(url);

    const key = new URL(url).pathname.slice(1);
    const posted = await rawRequest(url, {
      key,
      step: "credentials",
      email: "a@b.c",
      password: "correct horse battery staple",
    });
    expect(posted.status).toBe(200);
    expect(posted.body).toContain("Signed in as runner42");

    // The page closes itself right after the POST response, independent of the idle timer, so
    // polling for the closed connection (each poll would otherwise just re-extend an idle-based
    // close) is safe here.
    await waitUntilClosed(url);
    expect(session.resets).toBe(1);
    expect(tokenDirs).toEqual(["/configured/dir"]);

    const second = textOf(await client.callTool({ name: "sign_in_to_garmin", arguments: {} }));
    expect(opened).toHaveLength(2);
    expect(opened[1]).not.toBe(opened[0]);
    expect(second).toContain(opened[1]!);
    // This second page is never posted to; it only closes once it idles out.
    await expectClosedAfterIdle(opened[1]!, idleMs);
  });

  it("shares one page across two overlapping calls instead of starting two", async () => {
    const opened: string[] = [];
    const idleMs = 50;
    const client = await connect({ config: testConfig(), session: neverSignedInSession() }, [
      signInTools({ openUrl: (u) => opened.push(u), createClient: unusedClient, idleMs }),
    ]);
    const [first, second] = await Promise.all([
      client.callTool({ name: "sign_in_to_garmin", arguments: {} }),
      client.callTool({ name: "sign_in_to_garmin", arguments: {} }),
    ]);
    expect(opened).toHaveLength(2);
    expect(opened[0]).toBe(opened[1]);
    expect(textOf(first)).toContain(opened[0]!);
    expect(textOf(second)).toContain(opened[0]!);
    await expectClosedAfterIdle(opened[0]!, idleMs);
  });

  it("retries after a failed page start instead of rethrowing the same error forever", async () => {
    const opened: string[] = [];
    const idleMs = 50;
    let calls = 0;
    // Fails to start once (e.g. the port bind or the underlying http.Server itself threw), then
    // delegates to the real thing.
    const startPage: typeof startSignInPage = (opts) => {
      calls++;
      return calls === 1 ? Promise.reject(new Error("boom: could not start the sign-in page")) : startSignInPage(opts);
    };
    const client = await connect({ config: testConfig(), session: neverSignedInSession() }, [
      signInTools({ openUrl: (u) => opened.push(u), createClient: unusedClient, idleMs, startPage }),
    ]);

    const first = await client.callTool({ name: "sign_in_to_garmin", arguments: {} });
    expect(first.isError).toBe(true);
    expect(textOf(first)).toContain("boom: could not start the sign-in page");
    expect(opened).toEqual([]); // never got far enough to open a browser

    const second = textOf(await client.callTool({ name: "sign_in_to_garmin", arguments: {} }));
    expect(calls).toBe(2);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}$/);
    expect(second).toContain(opened[0]!);
    await expectClosedAfterIdle(opened[0]!, idleMs);
  });
});

describe("openInBrowser", () => {
  const spawnMock = vi.mocked(spawn);

  it("refuses a URL that is not exactly the 127.0.0.1/key shape, without spawning anything", () => {
    spawnMock.mockClear();
    // `&`/`^` etc. would be parsed as shell metacharacters by `cmd /c start`.
    openInBrowser("http://127.0.0.1:1234/abc&calc.exe");
    openInBrowser("https://127.0.0.1:1234/abc");
    openInBrowser("http://evil.example/abc");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("opens a URL matching the sign-in page's own shape", () => {
    spawnMock.mockClear();
    openInBrowser("http://127.0.0.1:54321/abcDEF123_-");
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
