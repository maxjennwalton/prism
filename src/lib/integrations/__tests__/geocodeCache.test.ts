/**
 * Caching-specific tests for geocodeAddress — split from geocode.test.ts
 * (which mocks Redis to null, degrading getCached() to a direct call) so
 * this file can exercise real cache-hit/never-cache-a-failure behavior
 * against a small in-memory fake Redis client instead.
 */
const fakeStore = new Map<string, { value: string; expiresAt: number }>();

const fakeRedisClient = {
  get: jest.fn(async (key: string) => {
    const entry = fakeStore.get(key);
    if (!entry || entry.expiresAt < Date.now() / 1000) return null;
    return entry.value;
  }),
  setEx: jest.fn(async (key: string, ttl: number, value: string) => {
    fakeStore.set(key, { value, expiresAt: Date.now() / 1000 + ttl });
  }),
};

jest.mock('@/lib/cache/getRedisClient', () => ({
  getRedisClient: jest.fn(async () => fakeRedisClient),
}));

import { geocodeAddress } from '../geocode';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok, status, json: async () => body });
}

const NOMINATIM_RESULT = {
  place_id: 1, lat: '40.0', lon: '-75.0', display_name: '123 Main St', address: {}, importance: 0.8,
};

beforeEach(() => {
  fakeStore.clear();
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe('geocodeAddress — caching', () => {
  it('caches a successful lookup and does not re-fetch for the same query', async () => {
    mockFetchOnce([NOMINATIM_RESULT]);
    const first = await geocodeAddress('123 Main St');
    const second = await geocodeAddress('123 Main St');

    expect(first).toEqual(second);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('caches a legitimate zero-result lookup (not the same as a failure)', async () => {
    mockFetchOnce([]);
    const first = await geocodeAddress('a real place with no matches');
    const second = await geocodeAddress('a real place with no matches');

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('never caches a failed lookup — a later call retries', async () => {
    mockFetchOnce({}, false, 503);
    await geocodeAddress('transient failure query');

    mockFetchOnce([NOMINATIM_RESULT]);
    const second = await geocodeAddress('transient failure query');

    expect(second).toHaveLength(1);
    // getCached() retries once internally on a thrown error before this
    // module's own catch converts it to []; a non-ok response here throws
    // inside fetchGeocodeResults, so two fetch calls happen for the first
    // (failed) lookup, plus the one for the successful retry below.
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('treats different queries as independent cache entries', async () => {
    mockFetchOnce([NOMINATIM_RESULT]);
    mockFetchOnce([{ ...NOMINATIM_RESULT, place_id: 2 }]);

    await geocodeAddress('Query A');
    await geocodeAddress('Query B');

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('is case/whitespace insensitive for cache key purposes', async () => {
    mockFetchOnce([NOMINATIM_RESULT]);
    await geocodeAddress('123 Main St');
    await geocodeAddress('  123 MAIN ST  ');

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('caches biased and unbiased lookups of the same text separately', async () => {
    mockFetchOnce([NOMINATIM_RESULT]);
    mockFetchOnce([NOMINATIM_RESULT]);

    await geocodeAddress('Community Rink');
    await geocodeAddress('Community Rink', 5, { lat: 44.5, lon: -80.2 });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('caches two different households\' biased lookups of the same text separately, never cross-contaminating results', async () => {
    mockFetchOnce([NOMINATIM_RESULT]);
    mockFetchOnce([{ ...NOMINATIM_RESULT, place_id: 2 }]);

    const householdA = await geocodeAddress('Community Rink', 5, { lat: 44.5, lon: -80.2 });
    const householdB = await geocodeAddress('Community Rink', 5, { lat: 51.5, lon: -0.1 });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(householdA[0]?.placeId).not.toBe(householdB[0]?.placeId);
  });

  it('reuses the cache for the same bias point even with tiny float noise (rounded for the cache key)', async () => {
    mockFetchOnce([NOMINATIM_RESULT]);
    await geocodeAddress('Community Rink', 5, { lat: 44.500001, lon: -80.200001 });
    await geocodeAddress('Community Rink', 5, { lat: 44.5, lon: -80.2 });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
