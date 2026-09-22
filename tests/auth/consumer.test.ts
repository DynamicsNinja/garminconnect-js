import { beforeEach, describe, expect, it, vi } from "vitest";
import { Fetcher } from "../../src/http/fetcher.js";
import { fetchConsumer, resetConsumerCache } from "../../src/auth/consumer.js";
import { GarminAuthError } from "../../src/errors.js";

beforeEach(() => resetConsumerCache());

describe("fetchConsumer", () => {
  it("fetches and returns the consumer credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
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
    const fetchImpl = vi.fn<typeof fetch>(async () =>
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

  it("throws GarminAuthError naming the url when consumer_key/consumer_secret are missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ some: "malformed s3 payload" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(fetchConsumer(f, "https://mirror.test/bad.json")).rejects.toThrow(
      GarminAuthError,
    );
    await expect(fetchConsumer(f, "https://mirror.test/bad.json")).rejects.toThrow(
      /mirror\.test\/bad\.json/,
    );
  });

  it("does not cache a malformed response", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ consumer_key: "", consumer_secret: "" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ consumer_key: "ck", consumer_secret: "cs" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const f = new Fetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(fetchConsumer(f)).rejects.toThrow(GarminAuthError);
    await expect(fetchConsumer(f)).resolves.toEqual({
      consumer_key: "ck",
      consumer_secret: "cs",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("accepts a custom url", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
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
