/**
 * Tests for the OpenRouteService (HeiGIT) driving-car provider.
 *
 * Redis is mocked with a tiny in-memory fake so getCached()'s real
 * caching behavior (including dedup across calls) is exercised, not just
 * bypassed. Rate limiting uses the same fake client via checkRateLimit's
 * real Redis path.
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

import { createOpenRouteServiceProvider } from '../openRouteService';

const ORIGIN = { lat: 40.0, lon: -75.0 };
const DESTINATION = { lat: 41.0, lon: -76.0 };

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok, status, json: async () => body });
}

beforeEach(() => {
  fakeRedisStore.clear();
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe('createOpenRouteServiceProvider — request shape', () => {
  it('POSTs coordinates as [lon, lat] numbers with the raw-key Authorization header', async () => {
    mockFetchOnce({ routes: [{ summary: { distance: 5000, duration: 600 } }] });
    const provider = createOpenRouteServiceProvider('test-key-123');
    await provider.getDrivingRoute(ORIGIN, DESTINATION);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.heigit.org/openrouteservice/v2/directions/driving-car/json');
    expect(init.headers.Authorization).toBe('test-key-123');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.coordinates).toEqual([
      [ORIGIN.lon, ORIGIN.lat],
      [DESTINATION.lon, DESTINATION.lat],
    ]);
    expect(typeof body.coordinates[0][0]).toBe('number');
  });
});

describe('createOpenRouteServiceProvider — response handling', () => {
  it('returns ok with distance/duration on a normal successful route', async () => {
    mockFetchOnce({ routes: [{ summary: { distance: 12345, duration: 987 } }] });
    const provider = createOpenRouteServiceProvider('key');
    const outcome = await provider.getDrivingRoute(ORIGIN, DESTINATION);
    expect(outcome).toEqual({ status: 'ok', route: { distanceMeters: 12345, durationSeconds: 987 }, failureReason: null });
  });

  it('treats an empty summary {} (origin === destination) as a real zero-length route, not a failure', async () => {
    mockFetchOnce({ routes: [{ summary: {} }] });
    const provider = createOpenRouteServiceProvider('key');
    const outcome = await provider.getDrivingRoute(ORIGIN, ORIGIN);
    expect(outcome).toEqual({ status: 'ok', route: { distanceMeters: 0, durationSeconds: 0 }, failureReason: null });
  });

  it('returns unavailable/invalid_response when there are no routes at all', async () => {
    // getCached() retries its fetcher once on a thrown error (its own
    // generic "cache error, fetch fresh" path) before this provider's own
    // try/catch converts that into the unavailable outcome below — so two
    // provider calls happen for one failed lookup here.
    mockFetchOnce({ routes: [] });
    mockFetchOnce({ routes: [] });
    const provider = createOpenRouteServiceProvider('key');
    const outcome = await provider.getDrivingRoute(ORIGIN, DESTINATION);
    expect(outcome).toEqual({ status: 'unavailable', route: null, failureReason: 'invalid_response' });
  });

  it('returns unavailable/provider_error on a non-OK HTTP status', async () => {
    mockFetchOnce({}, false, 503);
    const provider = createOpenRouteServiceProvider('key');
    const outcome = await provider.getDrivingRoute(ORIGIN, DESTINATION);
    expect(outcome).toEqual({ status: 'unavailable', route: null, failureReason: 'provider_error' });
  });

  it('returns unavailable/provider_error on a network failure', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    const provider = createOpenRouteServiceProvider('key');
    const outcome = await provider.getDrivingRoute(ORIGIN, DESTINATION);
    expect(outcome).toEqual({ status: 'unavailable', route: null, failureReason: 'provider_error' });
  });

  it('never claims live traffic — this module has no such field or claim in its output', async () => {
    mockFetchOnce({ routes: [{ summary: { distance: 1000, duration: 100 } }] });
    const provider = createOpenRouteServiceProvider('key');
    const outcome = await provider.getDrivingRoute(ORIGIN, DESTINATION);
    expect(outcome.route).not.toHaveProperty('traffic');
    expect(outcome.route).not.toHaveProperty('live');
  });
});

describe('createOpenRouteServiceProvider — caching', () => {
  it('caches a successful result and does not re-call the provider for the same origin/destination', async () => {
    mockFetchOnce({ routes: [{ summary: { distance: 1000, duration: 120 } }] });
    const provider = createOpenRouteServiceProvider('key');

    const first = await provider.getDrivingRoute(ORIGIN, DESTINATION);
    const second = await provider.getDrivingRoute(ORIGIN, DESTINATION);

    expect(first).toEqual(second);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('never caches a failed lookup — a later call retries the provider', async () => {
    // Two queued failures: getCached() itself retries its fetcher once on
    // a thrown error before this provider converts that into the
    // unavailable outcome (see the "no routes at all" test above).
    mockFetchOnce({}, false, 500);
    mockFetchOnce({}, false, 500);
    const provider = createOpenRouteServiceProvider('key');
    const first = await provider.getDrivingRoute(ORIGIN, DESTINATION);
    expect(first.status).toBe('unavailable');

    mockFetchOnce({ routes: [{ summary: { distance: 1000, duration: 120 } }] });
    const second = await provider.getDrivingRoute(ORIGIN, DESTINATION);

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(second.status).toBe('ok');
  });
});

describe('createOpenRouteServiceProvider — rate limiting', () => {
  it('returns rate_limited and never calls fetch once the per-minute cap is exceeded', async () => {
    mockFetchOnce({ routes: [{ summary: { distance: 1, duration: 1 } }] });
    const provider = createOpenRouteServiceProvider('key');

    // Exceed the per-minute cap with distinct origin/destination pairs so
    // the route-result cache doesn't mask the rate limiter.
    for (let i = 0; i < 31; i++) {
      await provider.getDrivingRoute({ lat: i, lon: i }, { lat: i + 0.5, lon: i + 0.5 });
      if (i < 30) mockFetchOnce({ routes: [{ summary: { distance: 1, duration: 1 } }] });
    }

    const outcome = await provider.getDrivingRoute({ lat: 99, lon: 99 }, { lat: 99.5, lon: 99.5 });
    expect(outcome).toEqual({ status: 'unavailable', route: null, failureReason: 'rate_limited' });
  });
});
