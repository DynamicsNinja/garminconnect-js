import { describe, expect, it, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { requestSession } from "../../src/http/request-session.js";
// eslint-disable-next-line no-restricted-imports
import { garminAuth } from "../../src/http/garmin-auth.js";
import { fakeFetch, PROFILE_ROUTE, TOKENS } from "../helpers.js";

describe("requestSession", () => {
  const { fetchImpl } = fakeFetch(PROFILE_ROUTE);

  it("reuses issued Dive credentials across separate HTTP requests", async () => {
    const calls = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes("/di-oauth2-service/")) {
        return Response.json({ ...TOKENS.oauth2, access_token: "dive", scope: "DIVE_API_WRITE", expires_in: 86400 });
      }
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer dive");
      return Response.json({});
    });
    const tokens = await garminAuth({ fetchImpl: calls, retries: 0 }).refresh(TOKENS, 60_000);
    const session = requestSession({ fetchImpl: calls, retries: 0 });
    for (let i = 0; i < 2; i++) {
      const context = { grantId: "g", tokens: JSON.parse(JSON.stringify(tokens)) as typeof tokens, onRejected: () => {} };
      await session.run(context, async () => {
        await (await session.get()).client.connectapi("/diving/v1/dive", { method: "POST" });
      });
    }
    expect(calls.mock.calls.filter(([url]) => String(url).includes("/di-oauth2-service/"))).toHaveLength(1);
    expect(calls).toHaveBeenCalledTimes(3);
  });

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
