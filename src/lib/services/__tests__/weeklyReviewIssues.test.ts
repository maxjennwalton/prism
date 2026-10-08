/**
 * @jest-environment node
 */
const mockSelect = jest.fn();
jest.mock('@/lib/db/client', () => ({ db: { select: (...a: unknown[]) => mockSelect(...a) } }));

jest.mock('@/lib/db/schema', () => ({
  activityEventLinks: {
    id: 'activityEventLinks.id',
    eventId: 'activityEventLinks.eventId',
    matchStatus: 'activityEventLinks.matchStatus',
    departureLocationOverride: 'activityEventLinks.departureLocationOverride',
    travelMinutesOverride: 'activityEventLinks.travelMinutesOverride',
    locationOverride: 'activityEventLinks.locationOverride',
    travelMeta: 'activityEventLinks.travelMeta',
    activityProfileId: 'activityEventLinks.activityProfileId',
    assignedMemberId: 'activityEventLinks.assignedMemberId',
  },
  events: { id: 'events.id', title: 'events.title', location: 'events.location', startTime: 'events.startTime' },
  activityProfiles: { id: 'activityProfiles.id', defaultLocation: 'activityProfiles.defaultLocation' },
  users: { id: 'users.id', name: 'users.name' },
}));

jest.mock('drizzle-orm', () => ({
  eq: (...a: unknown[]) => ({ op: 'eq', a }),
  and: (...a: unknown[]) => ({ op: 'and', a }),
  gte: (...a: unknown[]) => ({ op: 'gte', a }),
  lt: (...a: unknown[]) => ({ op: 'lt', a }),
}));

const mockGetHomeAddress = jest.fn();
jest.mock('@/lib/services/homeAddress', () => ({ getHomeAddress: (...a: unknown[]) => mockGetHomeAddress(...a) }));

import { detectWeeklyReviewIssues } from '../weeklyReviewIssues';

const HOME = { address: '1 Home Way', lat: 1, lon: 2 };

function mockSelectChain(rows: unknown[]) {
  mockSelect.mockReturnValue({
    from: () => ({
      innerJoin: () => ({
        leftJoin: () => ({
          leftJoin: () => ({
            where: async () => rows,
          }),
        }),
      }),
    }),
  });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    linkId: 'link-1',
    matchStatus: 'confirmed',
    departureLocationOverride: null,
    travelMinutesOverride: null,
    locationOverride: null,
    travelMeta: null,
    eventId: 'event-1',
    eventTitle: 'Hockey Practice',
    eventLocation: 'Rink B',
    eventStart: new Date('2026-10-10T18:00:00.000Z'),
    memberName: 'Beckham',
    profileDefaultLocation: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetHomeAddress.mockResolvedValue(HOME);
});

describe('detectWeeklyReviewIssues', () => {
  it('returns [] when there are no candidate rows', async () => {
    mockSelectChain([]);
    expect(await detectWeeklyReviewIssues()).toEqual([]);
  });

  it('never flags a rejected link', async () => {
    mockSelectChain([row({ matchStatus: 'rejected', eventLocation: null, profileDefaultLocation: null })]);
    expect(await detectWeeklyReviewIssues()).toEqual([]);
  });

  it('never flags a settled link with everything resolved (no issue)', async () => {
    mockSelectChain([row()]);
    expect(await detectWeeklyReviewIssues()).toEqual([]);
  });

  it('never flags a settled link whose travel is a manual override, even with no destination configured', async () => {
    mockSelectChain([row({ travelMinutesOverride: 10, eventLocation: null, profileDefaultLocation: null })]);
    expect(await detectWeeklyReviewIssues()).toEqual([]);
  });

  describe('unreviewed_match', () => {
    it('flags a needs_review link', async () => {
      mockSelectChain([row({ matchStatus: 'needs_review' })]);
      const issues = await detectWeeklyReviewIssues();
      expect(issues).toEqual([{ type: 'unreviewed_match', linkId: 'link-1', eventId: 'event-1', eventTitle: 'Hockey Practice', eventStart: row().eventStart, memberName: 'Beckham', detail: null }]);
    });

    it('takes priority over a missing destination on the same row', async () => {
      mockSelectChain([row({ matchStatus: 'needs_review', eventLocation: null, profileDefaultLocation: null })]);
      const [issue] = await detectWeeklyReviewIssues();
      expect(issue?.type).toBe('unreviewed_match');
    });
  });

  describe('missing_destination', () => {
    it('flags a settled link with no locationOverride, event location, or profile default', async () => {
      mockSelectChain([row({ eventLocation: null, profileDefaultLocation: null })]);
      const [issue] = await detectWeeklyReviewIssues();
      expect(issue).toMatchObject({ type: 'missing_destination', linkId: 'link-1' });
    });

    it('does not flag when the profile default location covers it', async () => {
      mockSelectChain([row({ eventLocation: null, profileDefaultLocation: 'Default Rink' })]);
      expect(await detectWeeklyReviewIssues()).toEqual([]);
    });
  });

  describe('missing_departure', () => {
    it('flags when there is a destination but no departure override and no Home address', async () => {
      mockGetHomeAddress.mockResolvedValue(null);
      mockSelectChain([row()]);
      const [issue] = await detectWeeklyReviewIssues();
      expect(issue).toMatchObject({ type: 'missing_departure', linkId: 'link-1' });
    });

    it('does not flag when a per-event departure override is set, even with no Home address', async () => {
      mockGetHomeAddress.mockResolvedValue(null);
      mockSelectChain([row({ departureLocationOverride: '42 Side St' })]);
      expect(await detectWeeklyReviewIssues()).toEqual([]);
    });

    it('does not flag when Home is configured', async () => {
      mockSelectChain([row()]);
      expect(await detectWeeklyReviewIssues()).toEqual([]);
    });
  });

  describe('ambiguous_address', () => {
    it('flags when travel_meta failed on the departure side (geocode_failed)', async () => {
      mockSelectChain([row({ travelMeta: { status: 'unavailable', minutes: null, provider: 'none', calculatedAt: 'x', distanceMeters: null, durationSeconds: null, departureInputHash: 'a', destinationInputHash: 'b', failureReason: 'departure_geocode_failed' } })]);
      const [issue] = await detectWeeklyReviewIssues();
      expect(issue).toMatchObject({ type: 'ambiguous_address', detail: 'departure_geocode_failed' });
    });

    it('flags when travel_meta failed on the destination side (ambiguous_address)', async () => {
      mockSelectChain([row({ travelMeta: { status: 'unavailable', minutes: null, provider: 'none', calculatedAt: 'x', distanceMeters: null, durationSeconds: null, departureInputHash: 'a', destinationInputHash: 'b', failureReason: 'destination_ambiguous_address' } })]);
      const [issue] = await detectWeeklyReviewIssues();
      expect(issue).toMatchObject({ type: 'ambiguous_address', detail: 'destination_ambiguous_address' });
    });
  });

  describe('unavailable_route', () => {
    it('flags a provider-side failure (provider_timeout) as unavailable_route, not ambiguous_address', async () => {
      mockSelectChain([row({ travelMeta: { status: 'unavailable', minutes: null, provider: 'openrouteservice', calculatedAt: 'x', distanceMeters: null, durationSeconds: null, departureInputHash: 'a', destinationInputHash: 'b', failureReason: 'provider_timeout' } })]);
      const [issue] = await detectWeeklyReviewIssues();
      expect(issue).toMatchObject({ type: 'unavailable_route', detail: 'provider_timeout' });
    });

    it('flags not_configured (no routing provider set up) as unavailable_route', async () => {
      mockSelectChain([row({ travelMeta: { status: 'unavailable', minutes: null, provider: 'none', calculatedAt: 'x', distanceMeters: null, durationSeconds: null, departureInputHash: 'a', destinationInputHash: 'b', failureReason: 'not_configured' } })]);
      const [issue] = await detectWeeklyReviewIssues();
      expect(issue).toMatchObject({ type: 'unavailable_route' });
    });

    it('does not flag a successful (status ok) travel_meta', async () => {
      mockSelectChain([row({ travelMeta: { status: 'ok', minutes: 15, provider: 'openrouteservice', calculatedAt: 'x', distanceMeters: 1, durationSeconds: 1, departureInputHash: 'a', destinationInputHash: 'b', failureReason: null } })]);
      expect(await detectWeeklyReviewIssues()).toEqual([]);
    });
  });

  it('processes multiple rows independently, one issue per affected row', async () => {
    mockSelectChain([
      row({ linkId: 'link-1', matchStatus: 'needs_review' }),
      row({ linkId: 'link-2', eventLocation: null, profileDefaultLocation: null }),
      row({ linkId: 'link-3' }),
    ]);
    const issues = await detectWeeklyReviewIssues();
    expect(issues.map((i) => i.linkId)).toEqual(['link-1', 'link-2']);
  });

  it('treats a null matchStatus (predates Phase 3 matching) as settled, not unreviewed', async () => {
    mockSelectChain([row({ matchStatus: null, eventLocation: null, profileDefaultLocation: null })]);
    const [issue] = await detectWeeklyReviewIssues();
    expect(issue?.type).toBe('missing_destination');
  });
});
