import { describe, expect, it, vi } from "vitest";
import { createReadOnlyFetch } from "../scripts/readonly-fetch.js";
import { GarminClient } from "../src/client.js";

/**
 * `scripts/smoke-readonly-real.ts` points at a real person's Garmin account. Its safety claim is
 * not "the probe list only contains read methods" — lists drift — it is that the TRANSPORT cannot
 * send a write. That claim is worth exactly as much as this file.
 *
 * The last test is the one that matters: it drives a real `GarminClient` through the wrapper and
 * asserts that a write method is refused. Testing the wrapper in isolation would only prove the
 * wrapper works; this proves it is actually wired into the path a caller takes.
 */
const ok = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });

describe("createReadOnlyFetch", () => {
  it("lets a GET through untouched", async () => {
    const inner = vi.fn(ok);
    const f = createReadOnlyFetch(inner as unknown as typeof fetch);
    await f("https://connectapi.garmin.com/x");
    expect(inner).toHaveBeenCalledOnce();
  });

  it("refuses every write verb", async () => {
    const inner = vi.fn(ok);
    const f = createReadOnlyFetch(inner as unknown as typeof fetch);
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      await expect(f("https://connectapi.garmin.com/x", { method })).rejects.toThrow(
        /refused a .* request/,
      );
    }
    expect(inner, "nothing may reach the network").not.toHaveBeenCalled();
  });

  it("is not fooled by a lowercase method", async () => {
    const inner = vi.fn(ok);
    const f = createReadOnlyFetch(inner as unknown as typeof fetch);
    await expect(f("https://connectapi.garmin.com/x", { method: "post" })).rejects.toThrow();
    expect(inner).not.toHaveBeenCalled();
  });

  it("reads the method off a Request object, not just init", async () => {
    // `fetch(new Request(url, {method: "POST"}))` passes no `init` at all. A check that only
    // looked at `init.method` would wave this straight through as a GET.
    const inner = vi.fn(ok);
    const f = createReadOnlyFetch(inner as unknown as typeof fetch);
    const req = new Request("https://connectapi.garmin.com/x", { method: "POST" });
    await expect(f(req)).rejects.toThrow(/refused a POST/);
    expect(inner).not.toHaveBeenCalled();
  });

  it("allows the OAuth2 token refresh, which is a POST by Garmin's design", async () => {
    // Without this exception the harness would stop working ~27h after a login.
    const inner = vi.fn(ok);
    const f = createReadOnlyFetch(inner as unknown as typeof fetch);
    await f("https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0", {
      method: "POST",
    });
    expect(inner).toHaveBeenCalledOnce();
  });

  it("keeps the query string out of the error message", async () => {
    // A Garmin service ticket rides in the query string; the refusal gets logged.
    const f = createReadOnlyFetch(vi.fn(ok) as unknown as typeof fetch);
    await expect(
      f("https://connectapi.garmin.com/x?ticket=SECRET-TICKET", { method: "POST" }),
    ).rejects.toThrow(/^(?!.*SECRET-TICKET).*$/s);
  });

  it("blocks a write issued through a real GarminClient, not just a bare fetch", async () => {
    const inner = vi.fn(ok);
    const client = new GarminClient({
      fetchImpl: createReadOnlyFetch(inner as unknown as typeof fetch),
      retries: 0,
    });
    client.setTokens({
      oauth1: { oauth_token: "t", oauth_token_secret: "s", domain: "garmin.com" },
      oauth2: {
        scope: "x",
        jti: "x",
        token_type: "Bearer",
        access_token: "a",
        refresh_token: "r",
        expires_in: 3600,
        expires_at: Date.now() / 1000 + 3600,
        refresh_token_expires_in: 100000,
        refresh_token_expires_at: Date.now() / 1000 + 100000,
      },
    });

    // The block holds, but note the SHAPE of the failure: the refusal is thrown from inside
    // `fetch`, so the transport classifies it as a network error and wraps it in
    // GarminConnectionError. The reason survives on `cause` — assert on that rather than on the
    // outer message, which says only "failed after N attempts" and reads like flakiness.
    const err = await client
      .connectapi("/weight-service/weight/2026-01-01/byversion/1", { method: "DELETE" })
      .then(
        () => null,
        (e: Error & { cause?: unknown }) => e,
      );
    expect(err, "the write must not succeed").not.toBeNull();
    expect((err?.cause as Error | undefined)?.message).toMatch(/refused a DELETE request/);
    expect(inner, "no write may reach the network through the client either").not.toHaveBeenCalled();

    // …and the same client still performs reads, so the block is on the verb, not on everything.
    await client.connectapi("/userprofile-service/socialProfile");
    expect(inner).toHaveBeenCalledOnce();
  });
});
