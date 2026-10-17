import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { YouComProvider } from "./youcom.js";

describe("YouComProvider", () => {
  const originalKey = process.env.YDC_API_KEY;

  beforeEach(() => {
    delete process.env.YDC_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.YDC_API_KEY;
    } else {
      process.env.YDC_API_KEY = originalKey;
    }
    vi.restoreAllMocks();
  });

  it("uses the keyless GET endpoint when YDC_API_KEY is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: {
          web: [
            {
              title: "You.com Result",
              url: "https://you.com/result",
              description: "Some description",
              snippets: ["snippet one"],
              page_age: "2024-03-01",
            },
            {
              title: "No URL",
              url: "",
              description: "filtered out",
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new YouComProvider();

    const results = await provider.search("hello world", { count: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://api.you.com/v1/agents/search");
    expect(url).toContain("query=hello+world");
    expect(url).toContain("max_results=5");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "You.com Result",
      url: "https://you.com/result",
      snippet: "snippet one Some description",
      published: "2024-03-01",
      source: "youcom",
    });
  });

  it("uses the keyed POST endpoint when YDC_API_KEY is set", async () => {
    process.env.YDC_API_KEY = "test-youcom-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "Keyed Result",
            url: "https://example.com/page",
            snippet: "A keyed snippet",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new YouComProvider();

    const results = await provider.search("test query", { count: 3 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.you.com/v1/agents/search");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "X-API-Key": "test-youcom-key",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ query: "test query", max_results: 3 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Keyed Result",
      url: "https://example.com/page",
      snippet: "A keyed snippet",
      source: "youcom",
    });
  });

  it("returns [] on non-ok response without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429 }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new YouComProvider();

    const results = await provider.search("hello", {});

    expect(results).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns [] when fetch rejects without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network failure")),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new YouComProvider();

    const results = await provider.search("hello", {});

    expect(results).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("caps results at the requested max_results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: {
          web: Array.from({ length: 10 }, (_, i) => ({
            title: `Result ${i}`,
            url: `https://example.com/${i}`,
            description: `desc ${i}`,
          })),
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new YouComProvider();

    const results = await provider.search("test", { count: 3 });

    expect(results).toHaveLength(3);
  });
});