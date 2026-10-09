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
    destinationOverrideCoords: 'activityEventLinks.destinationOverrideCoords',
    travelMeta: 'activityEventLinks.travelMeta',
  },
  events: { id: 'events.id', title: 'events.title', location: 'events.location', startTime: 'events.startTime' },
  activityProfiles: { id: 'activityProfiles.id', defaultLocation: 'activityProfiles.defaultLocation', travelMinutes: 'activityProfiles.travelMinutes' },
  users: { id: 'users.id', name: 'users.name' },
}));

jest.mock('drizzle-orm', () => ({
  eq: (...a: unknown[]) => ({ op: 'eq', a }),
  and: (...a: unknown[]) => ({ op: 'and', a }),
  gte: (...a: unknown[]) => ({ op: 'gte', a }),
  lt: (...a: unknown[]) => ({ op: 'lt', a }),
  inArray: (...a: unknown[]) => ({ op: 'inArray', a }),
  asc: (col: unknown) => ({ op: 'asc', col }),
}));

const mockGeocodeAddress = jest.fn();
jest.mock('@/lib/integrations/geocode', () => ({ geocodeAddress: (...a: unknown[]) => mockGeocodeAddress(...a) }));

const mockGetDrivingRoute = jest.fn();
jest.mock('@/lib/integrations/routing', () => ({
  getRoutingProvider: () => ({ name: 'openrouteservice', getDrivingRoute: (...a: unknown[]) => mockGetDrivingRoute(...a) }),
}));

const mockGetHomeAddress = jest.fn();
jest.mock('@/lib/services/homeAddress', () => ({ getHomeAddress: (...a: unknown[]) => mockGetHomeAddress(...a) }));

import {
  recomputeActivityTravelForUpcoming,
  recomputeActivityTravelForLink,
  listUpcomingActivityTravel,
  setActivityDepartureOverride,
  setActivityDestinationOverride,
} from '../activityTravel';

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

/** For listUpcomingActivityTravel's chain: select -> from -> innerJoin -> leftJoin -> leftJoin -> where -> orderBy. */
function mockListSelectChain(rows: unknown[]) {
  mockSelect.mockReturnValue({
    from: () => ({
      innerJoin: () => ({
        leftJoin: () => ({
          leftJoin: () => ({
            where: () => ({ orderBy: () => rows }),
          }),
        }),
      }),
    }),
  });
}

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    linkId: 'link-1',
    departureLocationOverride: null,
    travelMinutesOverride: null,
    locationOverride: null,
    destinationOverrideCoords: null,
    travelMeta: null,
    eventId: 'event-1',
    eventTitle: 'Hockey Practice',
    eventLocation: 'Rink B',
    eventStart: new Date('2026-10-10T18:00:00.000Z'),
    memberName: 'Beckham',
    profileTravelMinutes: null,
    profileDefaultLocation: null,
    ...overrides,
  };
}

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    linkId: 'link-1',
    departureLocationOverride: null,
    travelMinutesOverride: null,
    locationOverride: null,
    destinationOverrideCoords: null,
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

  it('uses a pinned destinationOverrideCoords directly, skipping destination geocoding entirely', async () => {
    const pin = { address: 'All Around Athletics Centre', lat: 40.1, lon: -75.1 };
    mockSelectChain([baseRow({ locationOverride: pin.address, destinationOverrideCoords: pin })]);
    const { set } = mockUpdateChain();
    mockGetDrivingRoute.mockResolvedValueOnce({ status: 'ok', route: { distanceMeters: 2000, durationSeconds: 120 }, failureReason: null });

    const summary = await recomputeActivityTravelForUpcoming();

    expect(mockGeocodeAddress).not.toHaveBeenCalled();
    expect(summary).toEqual({ scanned: 1, calculated: 1, reused: 0, skipped: 0, failed: 0 });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ travelMeta: expect.objectContaining({ status: 'ok' }) }));
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

describe('listUpcomingActivityTravel', () => {
  it('returns [] when there are no upcoming settled links', async () => {
    mockListSelectChain([]);
    expect(await listUpcomingActivityTravel()).toEqual([]);
  });

  it('maps a row with a manual override to travelSource manual_override', async () => {
    mockListSelectChain([listRow({ travelMinutesOverride: 12 })]);
    const [item] = await listUpcomingActivityTravel();
    expect(item).toMatchObject({ linkId: 'link-1', eventTitle: 'Hockey Practice', memberName: 'Beckham', destination: 'Rink B', travelSource: 'manual_override', travelMinutes: 12 });
  });

  it('maps a row with a successful travel_meta to travelSource calculated', async () => {
    mockListSelectChain([listRow({ travelMeta: { status: 'ok', minutes: 18, provider: 'openrouteservice', calculatedAt: '2026-01-01T00:00:00.000Z', distanceMeters: 1, durationSeconds: 1, departureInputHash: 'a', destinationInputHash: 'b', failureReason: null } })]);
    const [item] = await listUpcomingActivityTravel();
    expect(item).toMatchObject({ travelSource: 'calculated', travelMinutes: 18 });
  });

  it('maps a row with no override/calculation but a profile fallback to travelSource profile_fallback', async () => {
    mockListSelectChain([listRow({ profileTravelMinutes: 25 })]);
    const [item] = await listUpcomingActivityTravel();
    expect(item).toMatchObject({ travelSource: 'profile_fallback', travelMinutes: 25 });
  });

  it('maps a row with nothing configured to travelSource unavailable', async () => {
    mockListSelectChain([listRow()]);
    const [item] = await listUpcomingActivityTravel();
    expect(item).toMatchObject({ travelSource: 'unavailable', travelMinutes: null });
  });

  it('surfaces the raw departureLocationOverride for the UI to edit', async () => {
    mockListSelectChain([listRow({ departureLocationOverride: '42 Side St' })]);
    const [item] = await listUpcomingActivityTravel();
    expect(item?.departureLocationOverride).toBe('42 Side St');
  });

  it('resolves destination via the same override -> event -> profile precedence used elsewhere', async () => {
    mockListSelectChain([listRow({ locationOverride: 'Override Rink', eventLocation: 'Event Rink', profileDefaultLocation: 'Default Rink' })]);
    const [item] = await listUpcomingActivityTravel();
    expect(item?.destination).toBe('Override Rink');
  });

  it('surfaces a parent-confirmed destinationOverrideCoords pin for the UI to show as pinned', async () => {
    const pin = { address: 'All Around Athletics Centre', lat: 40.1, lon: -75.1 };
    mockListSelectChain([listRow({ locationOverride: pin.address, destinationOverrideCoords: pin })]);
    const [item] = await listUpcomingActivityTravel();
    expect(item?.destinationOverrideCoords).toEqual(pin);
  });
});

describe('setActivityDepartureOverride', () => {
  it('writes the override and never touches the Home address setting (no getHomeAddress call)', async () => {
    const { set, where } = mockUpdateChain();
    await setActivityDepartureOverride('link-1', '42 Side St');
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ departureLocationOverride: '42 Side St' }));
    expect(where).toHaveBeenCalled();
    expect(mockGetHomeAddress).not.toHaveBeenCalled();
  });

  it('clears the override when passed null', async () => {
    const { set } = mockUpdateChain();
    await setActivityDepartureOverride('link-1', null);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ departureLocationOverride: null }));
  });
});

describe('setActivityDestinationOverride', () => {
  it('writes both destinationOverrideCoords and locationOverride (the same address text) in one update, and never touches the Home setting', async () => {
    const { set, where } = mockUpdateChain();
    const pin = { address: 'All Around Athletics Centre, 91 Sandford Fleming Dr', lat: 40.1, lon: -75.1 };

    await setActivityDestinationOverride('link-1', pin);

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ destinationOverrideCoords: pin, locationOverride: pin.address }));
    expect(where).toHaveBeenCalled();
    expect(mockGetHomeAddress).not.toHaveBeenCalled();
  });

  it('clears both destinationOverrideCoords and locationOverride when passed null', async () => {
    const { set } = mockUpdateChain();
    await setActivityDestinationOverride('link-1', null);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ destinationOverrideCoords: null, locationOverride: null }));
  });
});
