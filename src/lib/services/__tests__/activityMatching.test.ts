/**
 * @jest-environment node
 */
const mockSelect = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

jest.mock('@/lib/db/client', () => ({
  db: {
    select: (...a: unknown[]) => mockSelect(...a),
    insert: (...a: unknown[]) => mockInsert(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  },
}));

jest.mock('@/lib/db/schema', () => ({
  events: { id: 'events.id', title: 'events.title', startTime: 'events.startTime', pendingDeletion: 'events.pendingDeletion', calendarSourceId: 'events.calendarSourceId' },
  calendarSources: { id: 'calendarSources.id', groupId: 'calendarSources.groupId' },
  calendarGroups: { id: 'calendarGroups.id', userId: 'calendarGroups.userId', type: 'calendarGroups.type' },
  activityEventLinks: { id: 'activityEventLinks.id', eventId: 'activityEventLinks.eventId', matchStatus: 'activityEventLinks.matchStatus' },
  settings: { key: 'settings.key', value: 'settings.value' },
  activityProfiles: { id: 'activityProfiles.id', name: 'activityProfiles.name', archived: 'activityProfiles.archived' },
}));

// Identity-ish markers so assertions can check *which* column/direction a
// call used without needing drizzle-orm's real SQL-building behavior.
jest.mock('drizzle-orm', () => ({
  eq: (...a: unknown[]) => ({ op: 'eq', a }),
  and: (...a: unknown[]) => ({ op: 'and', a }),
  gte: (...a: unknown[]) => ({ op: 'gte', a }),
  lte: (...a: unknown[]) => ({ op: 'lte', a }),
  isNull: (...a: unknown[]) => ({ op: 'isNull', a }),
  asc: (col: unknown) => ({ op: 'asc', col }),
}));

jest.mock('@/lib/db/activityProfiles', () => ({
  listActivityProfiles: jest.fn(),
  createActivityEventLinkIfAbsent: jest.fn(),
  updateActivityEventLink: jest.fn(),
}));

jest.mock('@/lib/matching/activityMatcher', () => ({
  matchEvent: jest.fn(),
}));

import { listActivityProfiles, createActivityEventLinkIfAbsent } from '@/lib/db/activityProfiles';
import { matchEvent } from '@/lib/matching/activityMatcher';
import { matchEventsInRange } from '../activityMatching';

type Row = { id: string; title: string; startTime: Date; calendarGroupMemberId: string | null };

/** Builds the chainable mock for the unlinked-events query, recording the orderBy call. */
function mockUnlinkedEventsQuery(rows: Row[]) {
  const orderBy = jest.fn().mockReturnValue(rows);
  const chain = {
    from: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy,
  };
  return { chain, orderBy };
}

beforeEach(() => {
  jest.clearAllMocks();
  (listActivityProfiles as jest.Mock).mockResolvedValue([
    { id: 'profile-1', name: 'Hockey Practice', matchKeywords: ['Hockey Practice'] },
  ]);
});

describe('matchEventsInRange — chronological ordering', () => {
  it("requests events ordered ascending by start time (events' soonest-first is the one canonical sort)", async () => {
    const rows: Row[] = [
      { id: 'e1', title: 'Event 1', startTime: new Date('2026-10-08T18:00:00Z'), calendarGroupMemberId: null },
      { id: 'e2', title: 'Event 2', startTime: new Date('2026-10-09T18:00:00Z'), calendarGroupMemberId: null },
    ];
    const { chain, orderBy } = mockUnlinkedEventsQuery(rows);

    // Call order inside matchEventsInRange's Promise.all is:
    // listActivityProfiles, loadTeamIdentifiers (settings select), loadUnlinkedEventsInRange.
    mockSelect
      .mockReturnValueOnce({ from: () => ({ where: () => [] }) }) // loadTeamIdentifiers
      .mockReturnValueOnce(chain); // loadUnlinkedEventsInRange

    (matchEvent as jest.Mock).mockReturnValue({
      outcome: 'ignore', profileId: null, memberId: null, matchStatus: null, reviewReason: null,
      matchedPhrase: null, profileCandidates: [], memberCandidates: [], identifiersFound: [],
    });

    await matchEventsInRange(new Date('2026-10-01'), new Date('2026-12-01'), { persist: false });

    expect(orderBy).toHaveBeenCalledWith({ op: 'asc', col: 'events.startTime' });
  });

  it('preserves the order the query returned — results are not re-sorted afterward', async () => {
    const rows: Row[] = [
      { id: 'later', title: 'Later Event', startTime: new Date('2026-11-01T18:00:00Z'), calendarGroupMemberId: null },
      { id: 'sooner', title: 'Sooner Event', startTime: new Date('2026-10-08T18:00:00Z'), calendarGroupMemberId: null },
    ];
    // Even though "sooner" starts earlier, the query mock intentionally
    // returns it SECOND — proving matchEventsInRange trusts the query's
    // order rather than re-deriving its own.
    const { chain } = mockUnlinkedEventsQuery(rows);
    mockSelect
      .mockReturnValueOnce({ from: () => ({ where: () => [] }) })
      .mockReturnValueOnce(chain);

    (matchEvent as jest.Mock).mockReturnValue({
      outcome: 'ignore', profileId: null, memberId: null, matchStatus: null, reviewReason: null,
      matchedPhrase: null, profileCandidates: [], memberCandidates: [], identifiersFound: [],
    });

    const summary = await matchEventsInRange(new Date('2026-10-01'), new Date('2026-12-01'), { persist: false });

    expect(summary.results.map((r) => r.eventId)).toEqual(['later', 'sooner']);
  });
});

describe('matchEventsInRange — Preview (persist: false) is read-only', () => {
  it('never inserts an activity_event_links row, even when events would auto-match or need review', async () => {
    const rows: Row[] = [
      { id: 'e1', title: 'U9MD Hockey Practice', startTime: new Date('2026-10-08T18:00:00Z'), calendarGroupMemberId: null },
      { id: 'e2', title: 'Ambiguous Event', startTime: new Date('2026-10-09T18:00:00Z'), calendarGroupMemberId: null },
    ];
    const { chain } = mockUnlinkedEventsQuery(rows);
    mockSelect
      .mockReturnValueOnce({ from: () => ({ where: () => [] }) })
      .mockReturnValueOnce(chain);

    (matchEvent as jest.Mock)
      .mockReturnValueOnce({
        outcome: 'auto_match', profileId: 'profile-1', memberId: 'member-1', matchStatus: 'auto_confirmed',
        reviewReason: null, matchedPhrase: 'Hockey Practice', profileCandidates: [], memberCandidates: [], identifiersFound: [],
      })
      .mockReturnValueOnce({
        outcome: 'needs_review', profileId: null, memberId: null, matchStatus: 'needs_review',
        reviewReason: 'unclassified', matchedPhrase: null, profileCandidates: [], memberCandidates: [], identifiersFound: [],
      });

    const summary = await matchEventsInRange(new Date('2026-10-01'), new Date('2026-12-01'), { persist: false });

    expect(summary.autoMatched).toBe(1);
    expect(summary.needsReview).toBe(1);
    expect(createActivityEventLinkIfAbsent).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('persist: true, by contrast, does write — confirming the read-only behavior above is the persist flag, not an accident', async () => {
    const rows: Row[] = [
      { id: 'e1', title: 'U9MD Hockey Practice', startTime: new Date('2026-10-08T18:00:00Z'), calendarGroupMemberId: null },
    ];
    const { chain } = mockUnlinkedEventsQuery(rows);
    mockSelect
      .mockReturnValueOnce({ from: () => ({ where: () => [] }) })
      .mockReturnValueOnce(chain);

    (matchEvent as jest.Mock).mockReturnValue({
      outcome: 'auto_match', profileId: 'profile-1', memberId: 'member-1', matchStatus: 'auto_confirmed',
      reviewReason: null, matchedPhrase: 'Hockey Practice', profileCandidates: [], memberCandidates: [], identifiersFound: [],
    });
    (createActivityEventLinkIfAbsent as jest.Mock).mockResolvedValue({ id: 'link-1' });

    await matchEventsInRange(new Date('2026-10-01'), new Date('2026-12-01'), { persist: true });

    expect(createActivityEventLinkIfAbsent).toHaveBeenCalledTimes(1);
  });
});
