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
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await f.request("https://x.test/a", { params: { d: "2026-01-01" } });
    expect(await res.json()).toEqual({ ok: true });
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://x.test/a?d=2026-01-01");
  });

  it("omits undefined params", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}));
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
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await f.request("https://x.test/first");
    await f.request("https://x.test/second", { referer: true });
    const headers = new Headers(fetchImpl.mock.calls[1]![1]!.headers);
    expect(headers.get("referer")).toBe("https://x.test/first");
  });

  it("serializes a json body and sets content-type", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await f.request("https://x.test/a", { method: "POST", json: { a: 1 } });
    const init = fetchImpl.mock.calls[0]![1]!;
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

  it("strips the query string (e.g. a service ticket) from error messages and url", async () => {
    const fetchImpl = vi.fn(async () => new Response("kaboom", { status: 418 }));
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(
      f.request("https://x.test/a?ticket=SECRET"),
    ).rejects.toMatchObject({
      status: 418,
      url: "https://x.test/a",
    });
    try {
      await f.request("https://x.test/a?ticket=SECRET");
      throw new Error("expected request to throw");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain("SECRET");
      expect(message).not.toContain("?");
    }
  });
});
