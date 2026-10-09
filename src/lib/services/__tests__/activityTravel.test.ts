/**
 * Tests for computeActivityTravel — the Phase 4B travel calculation core.
 * Mocks geocodeAddress and the routing provider so this exercises only the
 * precedence/skip/staleness logic, not real network calls.
 */
const mockGeocodeAddress = jest.fn();
jest.mock('@/lib/integrations/geocode', () => ({
  geocodeAddress: (...a: unknown[]) => mockGeocodeAddress(...a),
}));

const mockGetDrivingRoute = jest.fn();
jest.mock('@/lib/integrations/routing', () => ({
  getRoutingProvider: () => ({ name: 'openrouteservice', getDrivingRoute: (...a: unknown[]) => mockGetDrivingRoute(...a) }),
}));

import { computeActivityTravel, type ActivityTravelComputationInput } from '../activityTravel';
import type { ActivityTravelMeta } from '@/lib/db/schema';
import { hashTravelLocation, hashTravelText } from '@/lib/utils/activityTravelResolution';

const HOME = { address: '1 Home Way, Springfield', lat: 40.0, lon: -75.0 };
const DESTINATION_TEXT = 'Rink B, Springfield';
const DESTINATION_GEO = { lat: 41.0, lon: -76.0 };

function baseInput(overrides: Partial<ActivityTravelComputationInput> = {}): ActivityTravelComputationInput {
  return {
    departureLocationOverride: null,
    travelMinutesOverride: null,
    locationOverride: null,
    eventLocation: DESTINATION_TEXT,
    profileDefaultLocation: null,
    home: HOME,
    existingTravelMeta: null,
    ...overrides,
  };
}

function geocodeOk(lat: number, lon: number, importance = 0.9) {
  return [{ placeId: 1, displayName: 'x', fullName: 'x', latitude: lat, longitude: lon, importance }];
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('computeActivityTravel — skip rules', () => {
  it('returns null (never computes) when a manual travelMinutesOverride is set, even to 0', async () => {
    const result = await computeActivityTravel(baseInput({ travelMinutesOverride: 0 }));
    expect(result).toBeNull();
    expect(mockGeocodeAddress).not.toHaveBeenCalled();
    expect(mockGetDrivingRoute).not.toHaveBeenCalled();
  });

  it('returns null when there is no destination at all', async () => {
    const result = await computeActivityTravel(baseInput({ eventLocation: null, locationOverride: null, profileDefaultLocation: null }));
    expect(result).toBeNull();
    expect(mockGeocodeAddress).not.toHaveBeenCalled();
  });

  it('returns null when there is no departure point at all (no override, no Home)', async () => {
    const result = await computeActivityTravel(baseInput({ home: null }));
    expect(result).toBeNull();
    expect(mockGeocodeAddress).not.toHaveBeenCalled();
  });
});

describe('computeActivityTravel — departure precedence', () => {
  it('uses Home directly (no geocode call for Home itself) when there is no per-event override', async () => {
    mockGeocodeAddress.mockResolvedValueOnce(geocodeOk(DESTINATION_GEO.lat, DESTINATION_GEO.lon));
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 5000, durationSeconds: 600 }, failureReason: null });

    await computeActivityTravel(baseInput());

    expect(mockGeocodeAddress).toHaveBeenCalledTimes(1); // only the destination
    const [originArg] = mockGetDrivingRoute.mock.calls[0];
    expect(originArg).toEqual({ lat: HOME.lat, lon: HOME.lon });
  });

  it('geocodes a per-event departure override instead of using Home', async () => {
    mockGeocodeAddress
      .mockResolvedValueOnce(geocodeOk(42.0, -77.0)) // departure override
      .mockResolvedValueOnce(geocodeOk(DESTINATION_GEO.lat, DESTINATION_GEO.lon)); // destination
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 1000, durationSeconds: 100 }, failureReason: null });

    await computeActivityTravel(baseInput({ departureLocationOverride: '99 Override Rd' }));

    const [originArg] = mockGetDrivingRoute.mock.calls[0];
    expect(originArg).toEqual({ lat: 42.0, lon: -77.0 });
  });
});

describe('computeActivityTravel — destination precedence (reuses resolveEffectiveLocation)', () => {
  it('prefers locationOverride over the calendar event location and profile default', async () => {
    mockGeocodeAddress.mockResolvedValueOnce(geocodeOk(40.5, -75.5)); // plausibly close to HOME (40, -75)
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 1, durationSeconds: 1 }, failureReason: null });

    await computeActivityTravel(baseInput({
      locationOverride: 'Override Rink',
      eventLocation: 'Calendar Rink',
      profileDefaultLocation: 'Default Rink',
    }));

    expect(mockGeocodeAddress).toHaveBeenCalledWith('Override Rink', 3, { lat: HOME.lat, lon: HOME.lon });
  });
});

describe('computeActivityTravel — geocode failures', () => {
  it('records a departure_geocode_failed result when the departure override cannot be geocoded at all', async () => {
    mockGeocodeAddress.mockResolvedValueOnce([]); // departure override: no results
    const result = await computeActivityTravel(baseInput({ departureLocationOverride: 'Nowhere Place' }));
    expect(result).toEqual({
      status: 'unavailable',
      minutes: null,
      provider: 'none',
      calculatedAt: expect.any(String),
      distanceMeters: null,
      durationSeconds: null,
      departureInputHash: hashTravelText('Nowhere Place'),
      destinationInputHash: hashTravelText(DESTINATION_TEXT),
      failureReason: 'departure_geocode_failed',
    });
    expect(mockGetDrivingRoute).not.toHaveBeenCalled();
  });

  it('records a departure_ambiguous_address result when the departure override is ambiguous', async () => {
    mockGeocodeAddress.mockResolvedValueOnce([{ importance: 0.5 }, { importance: 0.48 }]);
    const result = await computeActivityTravel(baseInput({ departureLocationOverride: 'Main St' }));
    expect(result?.failureReason).toBe('departure_ambiguous_address');
    expect(mockGetDrivingRoute).not.toHaveBeenCalled();
  });

  it('records a destination_geocode_failed result when the destination cannot be geocoded', async () => {
    mockGeocodeAddress.mockResolvedValueOnce([]); // destination (Home is used for departure, no geocode call for it)
    const result = await computeActivityTravel(baseInput());
    expect(result).toMatchObject({
      status: 'unavailable',
      failureReason: 'destination_geocode_failed',
      departureInputHash: hashTravelLocation(HOME),
    });
    expect(mockGetDrivingRoute).not.toHaveBeenCalled();
  });

  it('records a destination_ambiguous_address result when the destination is ambiguous', async () => {
    mockGeocodeAddress.mockResolvedValueOnce([{ importance: 0.5 }, { importance: 0.49 }]);
    const result = await computeActivityTravel(baseInput());
    expect(result?.failureReason).toBe('destination_ambiguous_address');
  });
});

describe('computeActivityTravel — home-biased geocoding (requirement: prefer geographically appropriate matches)', () => {
  it('passes the household\'s own Home coordinates as the geocode bias for the destination', async () => {
    mockGeocodeAddress.mockResolvedValueOnce(geocodeOk(DESTINATION_GEO.lat, DESTINATION_GEO.lon));
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 1, durationSeconds: 1 }, failureReason: null });

    await computeActivityTravel(baseInput());

    expect(mockGeocodeAddress).toHaveBeenCalledWith(DESTINATION_TEXT, 3, { lat: HOME.lat, lon: HOME.lon });
  });

  it('passes the same Home bias for a departure override lookup too', async () => {
    mockGeocodeAddress
      .mockResolvedValueOnce(geocodeOk(40.1, -75.1))
      .mockResolvedValueOnce(geocodeOk(DESTINATION_GEO.lat, DESTINATION_GEO.lon));
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 1, durationSeconds: 1 }, failureReason: null });

    await computeActivityTravel(baseInput({ departureLocationOverride: 'Grandma\'s House' }));

    expect(mockGeocodeAddress).toHaveBeenCalledWith('Grandma\'s House', 3, { lat: HOME.lat, lon: HOME.lon });
  });

  it('never passes a bias when there is no Home address configured (departure override only, no Home)', async () => {
    mockGeocodeAddress
      .mockResolvedValueOnce(geocodeOk(40.1, -75.1))
      .mockResolvedValueOnce(geocodeOk(40.2, -75.2));
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 1, durationSeconds: 1 }, failureReason: null });

    await computeActivityTravel(baseInput({ home: null, departureLocationOverride: 'Grandma\'s House' }));

    expect(mockGeocodeAddress).toHaveBeenCalledWith('Grandma\'s House', 3, undefined);
    expect(mockGeocodeAddress).toHaveBeenCalledWith(DESTINATION_TEXT, 3, undefined);
  });
});

describe('computeActivityTravel — provider outcomes', () => {
  it('returns a status:ok result with minutes rounded from duration seconds', async () => {
    mockGeocodeAddress.mockResolvedValueOnce(geocodeOk(DESTINATION_GEO.lat, DESTINATION_GEO.lon));
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 8046, durationSeconds: 630 }, failureReason: null });

    const result = await computeActivityTravel(baseInput());
    expect(result).toMatchObject({ status: 'ok', minutes: 11, provider: 'openrouteservice', distanceMeters: 8046, durationSeconds: 630, failureReason: null });
  });

  it('never fabricates a zero-minute result — a calculated 0 only comes from a real 0-duration route', async () => {
    mockGeocodeAddress.mockResolvedValueOnce(geocodeOk(DESTINATION_GEO.lat, DESTINATION_GEO.lon));
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 0, durationSeconds: 0 }, failureReason: null });

    const result = await computeActivityTravel(baseInput());
    expect(result).toMatchObject({ status: 'ok', minutes: 0 });
  });

  it('passes through the provider failureReason (e.g. provider_timeout) on a routing failure', async () => {
    mockGeocodeAddress.mockResolvedValueOnce(geocodeOk(DESTINATION_GEO.lat, DESTINATION_GEO.lon));
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'unavailable', route: null, failureReason: 'provider_timeout' });

    const result = await computeActivityTravel(baseInput());
    expect(result).toMatchObject({ status: 'unavailable', minutes: null, failureReason: 'provider_timeout' });
  });

  it('never claims live traffic — the result never carries any traffic-related field', async () => {
    mockGeocodeAddress.mockResolvedValueOnce(geocodeOk(DESTINATION_GEO.lat, DESTINATION_GEO.lon));
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 1, durationSeconds: 1 }, failureReason: null });
    const result = await computeActivityTravel(baseInput());
    expect(result).not.toHaveProperty('traffic');
    expect(result).not.toHaveProperty('liveTraffic');
  });
});

describe('computeActivityTravel — implausible-distance sanity gate', () => {
  it('rejects a resolved pair too far apart to be a real local activity, without ever calling the routing provider', async () => {
    // Home at (40, -75); destination geocoded to London, UK — several
    // thousand km away. This is exactly the failure mode that previously
    // only surfaced as an opaque OpenRouteService HTTP 400 (its own
    // 6,000,000 m hard limit) after wasting a provider call.
    mockGeocodeAddress.mockResolvedValueOnce(geocodeOk(51.5, -0.1));

    const result = await computeActivityTravel(baseInput());

    expect(result).toMatchObject({ status: 'unavailable', minutes: null, provider: 'none', failureReason: 'implausible_distance' });
    expect(mockGetDrivingRoute).not.toHaveBeenCalled();
  });

  it('still proceeds to call the routing provider for a plausible local distance (regression guard)', async () => {
    mockGeocodeAddress.mockResolvedValueOnce(geocodeOk(DESTINATION_GEO.lat, DESTINATION_GEO.lon)); // ~140km from HOME
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 1000, durationSeconds: 60 }, failureReason: null });

    const result = await computeActivityTravel(baseInput());

    expect(mockGetDrivingRoute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'ok' });
  });

  it('catches an implausible distance on the departure-override side just as readily as the destination side', async () => {
    mockGeocodeAddress
      .mockResolvedValueOnce(geocodeOk(51.5, -0.1)) // departure override geocodes to London
      .mockResolvedValueOnce(geocodeOk(DESTINATION_GEO.lat, DESTINATION_GEO.lon)); // destination is normal/local

    const result = await computeActivityTravel(baseInput({ departureLocationOverride: 'Some Other Place' }));

    expect(result).toMatchObject({ status: 'unavailable', failureReason: 'implausible_distance' });
    expect(mockGetDrivingRoute).not.toHaveBeenCalled();
  });

  it('carries real departure/destination input hashes on an implausible-distance failure, not placeholder values', async () => {
    mockGeocodeAddress.mockResolvedValueOnce(geocodeOk(51.5, -0.1));
    const result = await computeActivityTravel(baseInput());
    expect(result?.departureInputHash).toEqual(expect.any(String));
    expect(result?.destinationInputHash).toEqual(expect.any(String));
    expect(result?.departureInputHash).not.toBe(result?.destinationInputHash);
  });
});

describe('computeActivityTravel — staleness / cache reuse', () => {
  function freshExisting(): ActivityTravelMeta {
    return {
      status: 'ok',
      minutes: 15,
      provider: 'openrouteservice',
      calculatedAt: new Date().toISOString(),
      distanceMeters: 5000,
      durationSeconds: 900,
      departureInputHash: hashTravelLocation(HOME),
      destinationInputHash: hashTravelLocation({ address: DESTINATION_TEXT, lat: DESTINATION_GEO.lat, lon: DESTINATION_GEO.lon }),
      failureReason: null,
    };
  }

  it('reuses a fresh existing result with matching hashes and never calls the routing provider again', async () => {
    mockGeocodeAddress.mockResolvedValueOnce(geocodeOk(DESTINATION_GEO.lat, DESTINATION_GEO.lon));
    const existing = freshExisting();
    const result = await computeActivityTravel(baseInput({ existingTravelMeta: existing }));
    expect(result).toBe(existing);
    expect(mockGetDrivingRoute).not.toHaveBeenCalled();
  });

  it('recomputes when the existing result is stale (input hashes no longer match, e.g. destination changed)', async () => {
    mockGeocodeAddress.mockResolvedValueOnce(geocodeOk(40.2, -75.2)); // destination now resolves somewhere new, but still plausibly close to HOME
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 1, durationSeconds: 1 }, failureReason: null });

    const existing = freshExisting(); // hashed against the OLD destination coordinates
    const result = await computeActivityTravel(baseInput({ existingTravelMeta: existing }));
    expect(result).not.toBe(existing);
    expect(mockGetDrivingRoute).toHaveBeenCalledTimes(1);
  });

  it('recomputes when the existing result has aged past the refresh interval, even with matching hashes', async () => {
    mockGeocodeAddress.mockResolvedValueOnce(geocodeOk(DESTINATION_GEO.lat, DESTINATION_GEO.lon));
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 1, durationSeconds: 1 }, failureReason: null });

    const stale = { ...freshExisting(), calculatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() };
    const result = await computeActivityTravel(baseInput({ existingTravelMeta: stale }));
    expect(result).not.toBe(stale);
    expect(mockGetDrivingRoute).toHaveBeenCalledTimes(1);
  });

  it('forceRefresh bypasses a still-fresh matching result and recomputes anyway', async () => {
    mockGeocodeAddress.mockResolvedValueOnce(geocodeOk(DESTINATION_GEO.lat, DESTINATION_GEO.lon));
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 2, durationSeconds: 120 }, failureReason: null });

    const existing = freshExisting();
    const result = await computeActivityTravel(baseInput({ existingTravelMeta: existing, forceRefresh: true }));
    expect(result).not.toBe(existing);
    expect(mockGetDrivingRoute).toHaveBeenCalledTimes(1);
  });

  it('never reuses a previously unavailable result just because hashes match — always retries', async () => {
    mockGeocodeAddress.mockResolvedValueOnce(geocodeOk(DESTINATION_GEO.lat, DESTINATION_GEO.lon));
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 1, durationSeconds: 60 }, failureReason: null });

    const previouslyFailed: ActivityTravelMeta = {
      ...freshExisting(),
      status: 'unavailable',
      minutes: null,
      failureReason: 'provider_timeout',
    };
    const result = await computeActivityTravel(baseInput({ existingTravelMeta: previouslyFailed }));
    expect(result?.status).toBe('ok');
    expect(mockGetDrivingRoute).toHaveBeenCalledTimes(1);
  });
});
