import { describe, it, expect, vi, afterEach } from "vitest";

// getExchangeRate keeps a module-level rates cache — import a fresh copy of
// the module in every test so one test's cache never leaks into another.
async function freshGetExchangeRate() {
  vi.resetModules();
  const mod = await import("../lib/exchangeRate");
  return mod.getExchangeRate;
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const GOOD_RATES = { rates: { EUR: 0.94, USD: 1.12, GBP: 0.82 } };

describe("getExchangeRate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 1 for CHF without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const getExchangeRate = await freshGetExchangeRate();

    await expect(getExchangeRate("CHF")).resolves.toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the fetched rate on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(GOOD_RATES)));
    const getExchangeRate = await freshGetExchangeRate();

    await expect(getExchangeRate("EUR")).resolves.toBe(0.94);
  });

  it("returns null when the fetch rejects (offline)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const getExchangeRate = await freshGetExchangeRate();

    await expect(getExchangeRate("EUR")).resolves.toBeNull();
  });

  it("returns null on a non-ok HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    const getExchangeRate = await freshGetExchangeRate();

    await expect(getExchangeRate("EUR")).resolves.toBeNull();
  });

  it("returns null when the response has no rates object", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ message: "oops" })));
    const getExchangeRate = await freshGetExchangeRate();

    await expect(getExchangeRate("EUR")).resolves.toBeNull();
  });

  it("returns null when the rate is non-numeric", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ rates: { EUR: "0.94" } })));
    const getExchangeRate = await freshGetExchangeRate();

    await expect(getExchangeRate("EUR")).resolves.toBeNull();
  });

  it("returns null when the rate is not finite", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ rates: { EUR: Infinity, USD: NaN } })));
    const getExchangeRate = await freshGetExchangeRate();

    await expect(getExchangeRate("EUR")).resolves.toBeNull();
    await expect(getExchangeRate("USD")).resolves.toBeNull();
  });

  it("returns null when the rate is zero or negative", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ rates: { EUR: 0, USD: -0.5 } })));
    const getExchangeRate = await freshGetExchangeRate();

    await expect(getExchangeRate("EUR")).resolves.toBeNull();
    await expect(getExchangeRate("USD")).resolves.toBeNull();
  });

  it("caches a successful fetch: second call does not fetch again", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(GOOD_RATES));
    vi.stubGlobal("fetch", fetchMock);
    const getExchangeRate = await freshGetExchangeRate();

    await expect(getExchangeRate("EUR")).resolves.toBe(0.94);
    await expect(getExchangeRate("USD")).resolves.toBe(1.12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed fetch: retries and recovers on the next call", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(okResponse(GOOD_RATES));
    vi.stubGlobal("fetch", fetchMock);
    const getExchangeRate = await freshGetExchangeRate();

    await expect(getExchangeRate("EUR")).resolves.toBeNull();
    await expect(getExchangeRate("EUR")).resolves.toBe(0.94);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not poison the cache with a malformed response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse({ message: "oops" }))
      .mockResolvedValueOnce(okResponse(GOOD_RATES));
    vi.stubGlobal("fetch", fetchMock);
    const getExchangeRate = await freshGetExchangeRate();

    await expect(getExchangeRate("EUR")).resolves.toBeNull();
    // Second call must not throw on a poisoned cache entry — it refetches.
    await expect(getExchangeRate("EUR")).resolves.toBe(0.94);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not serve an invalid value out of the cache", async () => {
    // A response whose requested rate is junk must not be cached and then
    // served on a later call; the later call refetches.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse({ rates: { EUR: -1, USD: 1.12 } }))
      .mockResolvedValueOnce(okResponse(GOOD_RATES));
    vi.stubGlobal("fetch", fetchMock);
    const getExchangeRate = await freshGetExchangeRate();

    await expect(getExchangeRate("EUR")).resolves.toBeNull();
    await expect(getExchangeRate("EUR")).resolves.toBe(0.94);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
