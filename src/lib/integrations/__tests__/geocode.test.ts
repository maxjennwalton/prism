/**
 * Tests for the shared Nominatim geocoding primitive (Phase 4B prep).
 * Redis is mocked to return no client so getCached() degrades to calling
 * the fetcher directly — these tests exercise the HTTP/parsing/validation
 * behavior, not caching mechanics.
 */
jest.mock('@/lib/cache/getRedisClient', () => ({
  getRedisClient: jest.fn().mockResolvedValue(null),
}));

import { geocodeAddress } from '../geocode';

const originalFetch = global.fetch;

function nominatimResult(overrides: Record<string, unknown> = {}) {
  return {
    place_id: 1,
    lat: '40.7128',
    lon: '-74.0060',
    display_name: '123 Main St, New York, NY, United States',
    address: { house_number: '123', road: 'Main St', city: 'New York', state: 'NY', country: 'United States' },
    importance: 0.8,
    ...overrides,
  };
}

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  global.fetch = jest.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('geocodeAddress', () => {
  it('returns [] for a query shorter than 2 characters without calling fetch', async () => {
    const result = await geocodeAddress('a');
    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('parses a successful Nominatim response into GeocodeResult shape', async () => {
    mockFetchOnce([nominatimResult()]);
    const result = await geocodeAddress('123 Main St, New York');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      placeId: 1,
      latitude: 40.7128,
      longitude: -74.006,
      importance: 0.8,
    });
    expect(result[0]!.displayName).toContain('123 Main St');
  });

  it('includes a street number/road when present in address details', async () => {
    mockFetchOnce([nominatimResult()]);
    const [result] = await geocodeAddress('123 Main St');
    expect(result!.displayName).toBe('123 Main St, NY, United States');
  });

  it('defaults importance to 0 when Nominatim omits it', async () => {
    mockFetchOnce([nominatimResult({ importance: undefined })]);
    const [result] = await geocodeAddress('somewhere');
    expect(result!.importance).toBe(0);
  });

  it('filters out results with invalid/out-of-range coordinates', async () => {
    mockFetchOnce([
      nominatimResult({ lat: 'not-a-number', lon: '-74.006' }),
      nominatimResult({ place_id: 2, lat: '200', lon: '-74.006' }),
      nominatimResult({ place_id: 3 }),
    ]);
    const result = await geocodeAddress('query');
    expect(result).toHaveLength(1);
    expect(result[0]!.placeId).toBe(3);
  });

  it('returns [] (never throws) when Nominatim responds with a non-OK status', async () => {
    mockFetchOnce([], false, 503);
    const result = await geocodeAddress('query');
    expect(result).toEqual([]);
  });

  it('returns [] (never throws) when Nominatim responds with an unexpected shape', async () => {
    mockFetchOnce({ not: 'an array' });
    const result = await geocodeAddress('query');
    expect(result).toEqual([]);
  });

  it('returns [] (never throws) when the fetch itself rejects (network failure)', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    const result = await geocodeAddress('query');
    expect(result).toEqual([]);
  });

  it('sends the required User-Agent header to Nominatim', async () => {
    mockFetchOnce([nominatimResult()]);
    await geocodeAddress('query');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['User-Agent']).toMatch(/Prism/);
  });

  it('passes through class/type for callers that need Nominatim categorization', async () => {
    mockFetchOnce([nominatimResult({ class: 'boundary', type: 'national_park' })]);
    const [result] = await geocodeAddress('Yellowstone');
    expect(result).toMatchObject({ class: 'boundary', type: 'national_park' });
  });
});
