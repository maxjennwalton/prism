/**
 * Tests for the optional Google Places Text Search fallback.
 *
 * Redis is mocked with a tiny in-memory fake so getCached()'s real caching
 * behavior is exercised, and checkRateLimit's real Redis path is used via
 * the same fake client — same pattern as openRouteService.test.ts.
 */
const fakeRedisStore = new Map<string, { value: string; expiresAt: number }>();

function nowSeconds() {
  return Date.now() / 1000;
}

const fakeRedisClient = {
  get: jest.fn(async (key: string) => {
    const entry = fakeRedisStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt < nowSeconds()) { fakeRedisStore.delete(key); return null; }
    return entry.value;
  }),
  setEx: jest.fn(async (key: string, ttl: number, value: string) => {
    fakeRedisStore.set(key, { value, expiresAt: nowSeconds() + ttl });
  }),
  incr: jest.fn(async (key: string) => {
    const entry = fakeRedisStore.get(key);
    const count = entry ? Number(entry.value) + 1 : 1;
    fakeRedisStore.set(key, { value: String(count), expiresAt: entry?.expiresAt ?? nowSeconds() + 60 });
    return count;
  }),
  expire: jest.fn(async (key: string, ttl: number) => {
    const entry = fakeRedisStore.get(key);
    if (entry) entry.expiresAt = nowSeconds() + ttl;
    return true;
  }),
  ttl: jest.fn(async (key: string) => {
    const entry = fakeRedisStore.get(key);
    if (!entry) return -1;
    return Math.ceil(entry.expiresAt - nowSeconds());
  }),
};

jest.mock('@/lib/cache/getRedisClient', () => ({
  getRedisClient: jest.fn(async () => fakeRedisClient),
}));

import { isGooglePlacesConfigured, searchGooglePlaces } from '../googlePlaces';

const ORIGINAL_ENV = process.env;

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok, status, json: async () => body });
}

function placesResult(overrides: Record<string, unknown> = {}) {
  return {
    place_id: 'ChIJ-abc123',
    name: 'Eddie Bush Arena',
    formatted_address: '100 First St, Midland, ON, Canada',
    geometry: { location: { lat: 44.75, lng: -79.88 } },
    ...overrides,
  };
}

beforeEach(() => {
  fakeRedisStore.clear();
  jest.clearAllMocks();
  global.fetch = jest.fn();
  process.env = { ...ORIGINAL_ENV, GOOGLE_PLACES_API_KEY: 'test-places-key' };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('isGooglePlacesConfigured', () => {
  it('is false with no API key set — the integration stays entirely inert by default', () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect(isGooglePlacesConfigured()).toBe(false);
  });

  it('is true once a server-side API key is configured', () => {
    expect(isGooglePlacesConfigured()).toBe(true);
  });
});

describe('searchGooglePlaces — disabled by default', () => {
  it('returns [] and never calls fetch when no API key is configured, regardless of query', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const results = await searchGooglePlaces('Eddie Bush Arena');
    expect(results).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('searchGooglePlaces — request shape', () => {
  it('sends the query and key, and biases with location+radius when a bias point is given', async () => {
    mockFetchOnce({ status: 'OK', results: [placesResult()] });
    await searchGooglePlaces('Eddie Bush Arena', { lat: 44.5, lon: -80.2 });

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.searchParams.get('query')).toBe('Eddie Bush Arena');
    expect(parsed.searchParams.get('key')).toBe('test-places-key');
    expect(parsed.searchParams.get('location')).toBe('44.5,-80.2');
    expect(parsed.searchParams.get('radius')).toBe('50000');
  });

  it('omits location/radius entirely when no bias is given', async () => {
    mockFetchOnce({ status: 'OK', results: [placesResult()] });
    await searchGooglePlaces('Eddie Bush Arena');

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.searchParams.has('location')).toBe(false);
  });

  it('never queries for a too-short string', async () => {
    const results = await searchGooglePlaces('a');
    expect(results).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('searchGooglePlaces — response mapping', () => {
  it('maps a result to the shared GeocodeResult shape with real coordinates', async () => {
    mockFetchOnce({ status: 'OK', results: [placesResult()] });
    const [result] = await searchGooglePlaces('Eddie Bush Arena');
    expect(result).toMatchObject({
      displayName: 'Eddie Bush Arena',
      fullName: '100 First St, Midland, ON, Canada',
      latitude: 44.75,
      longitude: -79.88,
    });
    expect(typeof result?.importance).toBe('number');
  });

  it('returns [] for a genuine ZERO_RESULTS response, not an error', async () => {
    mockFetchOnce({ status: 'ZERO_RESULTS', results: [] });
    const results = await searchGooglePlaces('Totally Unknown Place');
    expect(results).toEqual([]);
  });

  it('skips a result missing coordinates or a name rather than fabricating them', async () => {
    mockFetchOnce({
      status: 'OK',
      results: [
        placesResult({ geometry: {} }),
        placesResult({ name: undefined }),
        placesResult(),
      ],
    });
    const results = await searchGooglePlaces('Eddie Bush Arena');
    expect(results).toHaveLength(1);
  });

  it('never returns a permanently-closed place as a destination candidate', async () => {
    mockFetchOnce({
      status: 'OK',
      results: [
        placesResult({ business_status: 'CLOSED_PERMANENTLY' }),
        placesResult({ place_id: 'ChIJ-still-open', business_status: 'OPERATIONAL' }),
      ],
    });
    const results = await searchGooglePlaces('Eddie Bush Arena');
    expect(results).toHaveLength(1);
  });

  it('still returns a result with no business_status field at all (not every real response includes it)', async () => {
    mockFetchOnce({ status: 'OK', results: [placesResult()] });
    const results = await searchGooglePlaces('Eddie Bush Arena');
    expect(results).toHaveLength(1);
  });

  it('caps results at 3 even when more are returned', async () => {
    mockFetchOnce({ status: 'OK', results: [placesResult(), placesResult(), placesResult(), placesResult()] });
    const results = await searchGooglePlaces('Arena');
    expect(results).toHaveLength(3);
  });

  it('assigns decreasing synthetic importance by rank, never fabricating a real relevance score', async () => {
    mockFetchOnce({ status: 'OK', results: [placesResult(), placesResult()] });
    const [first, second] = await searchGooglePlaces('Arena');
    expect(first!.importance).toBeGreaterThan(second!.importance);
  });
});

describe('searchGooglePlaces — failure handling', () => {
  it('never throws and returns [] on a non-OK HTTP status', async () => {
    mockFetchOnce({}, false, 500);
    mockFetchOnce({}, false, 500); // getCached retries its fetcher once on a thrown error
    const results = await searchGooglePlaces('Eddie Bush Arena');
    expect(results).toEqual([]);
  });

  it('never throws and returns [] on a network failure', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network down'));
    const results = await searchGooglePlaces('Eddie Bush Arena');
    expect(results).toEqual([]);
  });

  it('never throws and returns [] on a non-OK API status (e.g. REQUEST_DENIED)', async () => {
    mockFetchOnce({ status: 'REQUEST_DENIED' });
    mockFetchOnce({ status: 'REQUEST_DENIED' });
    const results = await searchGooglePlaces('Eddie Bush Arena');
    expect(results).toEqual([]);
  });
});

describe('searchGooglePlaces — caching', () => {
  it('caches a successful result and does not re-call the provider for the same query/bias', async () => {
    mockFetchOnce({ status: 'OK', results: [placesResult()] });
    const first = await searchGooglePlaces('Eddie Bush Arena', { lat: 44.5, lon: -80.2 });
    const second = await searchGooglePlaces('Eddie Bush Arena', { lat: 44.5, lon: -80.2 });
    expect(first).toEqual(second);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('never caches a failed lookup — a later call retries the provider', async () => {
    mockFetchOnce({}, false, 500);
    mockFetchOnce({}, false, 500);
    const first = await searchGooglePlaces('Eddie Bush Arena');
    expect(first).toEqual([]);

    mockFetchOnce({ status: 'OK', results: [placesResult()] });
    const second = await searchGooglePlaces('Eddie Bush Arena');
    expect(second).toHaveLength(1);
  });

  it('treats different bias points as different cache entries', async () => {
    mockFetchOnce({ status: 'OK', results: [placesResult()] });
    mockFetchOnce({ status: 'OK', results: [placesResult({ name: 'Different Match' })] });

    await searchGooglePlaces('Arena', { lat: 44.5, lon: -80.2 });
    await searchGooglePlaces('Arena', { lat: 51.5, lon: -0.1 });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('searchGooglePlaces — rate limiting / cost control', () => {
  it('stops calling fetch once the daily cap (GOOGLE_PLACES_DAILY_LIMIT) is reached', async () => {
    process.env.GOOGLE_PLACES_DAILY_LIMIT = '2';

    mockFetchOnce({ status: 'OK', results: [placesResult()] });
    await searchGooglePlaces('Query One');
    mockFetchOnce({ status: 'OK', results: [placesResult()] });
    await searchGooglePlaces('Query Two');

    const results = await searchGooglePlaces('Query Three');
    expect(results).toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to a safe default cap when GOOGLE_PLACES_DAILY_LIMIT is not a valid number', async () => {
    process.env.GOOGLE_PLACES_DAILY_LIMIT = 'not-a-number';
    mockFetchOnce({ status: 'OK', results: [placesResult()] });
    const results = await searchGooglePlaces('Eddie Bush Arena');
    expect(results).toHaveLength(1);
  });
});

describe('searchGooglePlaces — the API key is never exposed in cached data', () => {
  it('never appears in what gets written to the Redis cache', async () => {
    mockFetchOnce({ status: 'OK', results: [placesResult()] });
    await searchGooglePlaces('Eddie Bush Arena');

    const cachedValues = fakeRedisClient.setEx.mock.calls.map(([, , value]) => value);
    expect(cachedValues.some((v) => String(v).includes('test-places-key'))).toBe(false);
  });
});
