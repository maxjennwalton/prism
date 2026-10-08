/**
 * @jest-environment node
 *
 * Tests the DB-facing batch/single-link recompute wrappers in
 * activityTravel.ts. computeActivityTravel's own precedence/staleness
 * logic is covered in activityTravel.test.ts; here only geocodeAddress,
 * the routing provider, and getHomeAddress are mocked, so the real
 * computeActivityTravel runs against mocked DB rows.
 */
const mockSelect = jest.fn();
const mockUpdate = jest.fn();

jest.mock('@/lib/db/client', () => ({
  db: {
    select: (...a: unknown[]) => mockSelect(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
}));

jest.mock('@/lib/db/schema', () => ({
  activityEventLinks: {
    id: 'activityEventLinks.id',
    eventId: 'activityEventLinks.eventId',
    activityProfileId: 'activityEventLinks.activityProfileId',
    matchStatus: 'activityEventLinks.matchStatus',
    departureLocationOverride: 'activityEventLinks.departureLocationOverride',
    travelMinutesOverride: 'activityEventLinks.travelMinutesOverride',
    locationOverride: 'activityEventLinks.locationOverride',
    travelMeta: 'activityEventLinks.travelMeta',
  },
  events: { id: 'events.id', location: 'events.location', startTime: 'events.startTime' },
  activityProfiles: { id: 'activityProfiles.id', defaultLocation: 'activityProfiles.defaultLocation' },
}));

jest.mock('drizzle-orm', () => ({
  eq: (...a: unknown[]) => ({ op: 'eq', a }),
  and: (...a: unknown[]) => ({ op: 'and', a }),
  gte: (...a: unknown[]) => ({ op: 'gte', a }),
  lt: (...a: unknown[]) => ({ op: 'lt', a }),
  inArray: (...a: unknown[]) => ({ op: 'inArray', a }),
}));

const mockGeocodeAddress = jest.fn();
jest.mock('@/lib/integrations/geocode', () => ({ geocodeAddress: (...a: unknown[]) => mockGeocodeAddress(...a) }));

const mockGetDrivingRoute = jest.fn();
jest.mock('@/lib/integrations/routing', () => ({
  getRoutingProvider: () => ({ name: 'openrouteservice', getDrivingRoute: (...a: unknown[]) => mockGetDrivingRoute(...a) }),
}));

const mockGetHomeAddress = jest.fn();
jest.mock('@/lib/services/homeAddress', () => ({ getHomeAddress: (...a: unknown[]) => mockGetHomeAddress(...a) }));

import { recomputeActivityTravelForUpcoming, recomputeActivityTravelForLink } from '../activityTravel';

const HOME = { address: '1 Home Way', lat: 40, lon: -75 };

function mockSelectChain(rows: unknown[]) {
  mockSelect.mockReturnValue({
    from: () => ({
      innerJoin: () => ({
        leftJoin: () => ({
          where: async () => rows,
        }),
      }),
    }),
  });
}

function mockUpdateChain() {
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where });
  mockUpdate.mockReturnValue({ set });
  return { set, where };
}

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    linkId: 'link-1',
    departureLocationOverride: null,
    travelMinutesOverride: null,
    locationOverride: null,
    travelMeta: null,
    eventLocation: 'Rink B',
    profileDefaultLocation: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetHomeAddress.mockResolvedValue(HOME);
});

describe('recomputeActivityTravelForUpcoming', () => {
  it('returns an all-zero summary when there are no candidate rows', async () => {
    mockSelectChain([]);
    const summary = await recomputeActivityTravelForUpcoming();
    expect(summary).toEqual({ scanned: 0, calculated: 0, reused: 0, skipped: 0, failed: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('calculates a fresh result and persists it to the row', async () => {
    mockSelectChain([baseRow()]);
    const { set, where } = mockUpdateChain();
    mockGeocodeAddress.mockResolvedValueOnce([{ placeId: 1, displayName: 'x', fullName: 'x', latitude: 41, longitude: -76, importance: 0.9 }]);
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 5000, durationSeconds: 600 }, failureReason: null });

    const summary = await recomputeActivityTravelForUpcoming();

    expect(summary).toEqual({ scanned: 1, calculated: 1, reused: 0, skipped: 0, failed: 0 });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ travelMeta: expect.objectContaining({ status: 'ok', minutes: 10 }) }));
    expect(where).toHaveBeenCalled();
  });

  it('skips a row with a manual travelMinutesOverride — no DB write, no provider call', async () => {
    mockSelectChain([baseRow({ travelMinutesOverride: 5 })]);

    const summary = await recomputeActivityTravelForUpcoming();

    expect(summary).toEqual({ scanned: 1, calculated: 0, reused: 0, skipped: 1, failed: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockGeocodeAddress).not.toHaveBeenCalled();
  });

  it('reuses a fresh existing result without writing to the DB again', async () => {
    const { hashTravelLocation } = jest.requireActual('@/lib/utils/activityTravelResolution');
    const existing = {
      status: 'ok', minutes: 10, provider: 'openrouteservice', calculatedAt: new Date().toISOString(),
      distanceMeters: 5000, durationSeconds: 600,
      departureInputHash: hashTravelLocation(HOME),
      destinationInputHash: hashTravelLocation({ address: 'Rink B', lat: 41, lon: -76 }),
      failureReason: null,
    };
    mockSelectChain([baseRow({ travelMeta: existing })]);
    mockGeocodeAddress.mockResolvedValueOnce([{ placeId: 1, displayName: 'x', fullName: 'x', latitude: 41, longitude: -76, importance: 0.9 }]);

    const summary = await recomputeActivityTravelForUpcoming();

    expect(summary).toEqual({ scanned: 1, calculated: 0, reused: 1, skipped: 0, failed: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockGetDrivingRoute).not.toHaveBeenCalled();
  });

  it('counts a failed geocode/route attempt as failed and still persists the unavailable result', async () => {
    mockSelectChain([baseRow()]);
    const { set } = mockUpdateChain();
    mockGeocodeAddress.mockResolvedValueOnce([]); // destination unresolvable

    const summary = await recomputeActivityTravelForUpcoming();

    expect(summary).toEqual({ scanned: 1, calculated: 0, reused: 0, skipped: 0, failed: 1 });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ travelMeta: expect.objectContaining({ status: 'unavailable' }) }));
  });

  it('processes multiple rows independently in one pass', async () => {
    mockSelectChain([baseRow({ linkId: 'link-1' }), baseRow({ linkId: 'link-2', travelMinutesOverride: 3 })]);
    mockUpdateChain();
    mockGeocodeAddress.mockResolvedValueOnce([{ placeId: 1, displayName: 'x', fullName: 'x', latitude: 41, longitude: -76, importance: 0.9 }]);
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 100, durationSeconds: 60 }, failureReason: null });

    const summary = await recomputeActivityTravelForUpcoming();

    expect(summary).toEqual({ scanned: 2, calculated: 1, reused: 0, skipped: 1, failed: 0 });
  });
});

describe('recomputeActivityTravelForLink', () => {
  it('reports found: false when the link does not exist', async () => {
    mockSelectChain([]);
    const result = await recomputeActivityTravelForLink('missing-link');
    expect(result).toEqual({ found: false, travelMeta: null });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('forces a fresh calculation even when an existing fresh result would otherwise be reused', async () => {
    const { hashTravelLocation } = jest.requireActual('@/lib/utils/activityTravelResolution');
    const existing = {
      status: 'ok', minutes: 10, provider: 'openrouteservice', calculatedAt: new Date().toISOString(),
      distanceMeters: 5000, durationSeconds: 600,
      departureInputHash: hashTravelLocation(HOME),
      destinationInputHash: hashTravelLocation({ address: 'Rink B', lat: 41, lon: -76 }),
      failureReason: null,
    };
    mockSelectChain([baseRow({ travelMeta: existing })]);
    const { set } = mockUpdateChain();
    mockGeocodeAddress.mockResolvedValueOnce([{ placeId: 1, displayName: 'x', fullName: 'x', latitude: 41, longitude: -76, importance: 0.9 }]);
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 6000, durationSeconds: 700 }, failureReason: null });

    const result = await recomputeActivityTravelForLink('link-1');

    expect(mockGetDrivingRoute).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ found: true, travelMeta: expect.objectContaining({ status: 'ok', minutes: 12 }) });
    expect(set).toHaveBeenCalled();
  });

  it('reports found: true with a null travelMeta when there is nothing to compute (e.g. manual override present) — no DB write', async () => {
    mockSelectChain([baseRow({ travelMinutesOverride: 7 })]);
    const result = await recomputeActivityTravelForLink('link-1');
    expect(result).toEqual({ found: true, travelMeta: null });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
