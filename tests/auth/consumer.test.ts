import { beforeEach, describe, expect, it, vi } from "vitest";
import { Fetcher } from "../../src/http/fetcher.js";
import { fetchConsumer, resetConsumerCache } from "../../src/auth/consumer.js";

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
