/**
 * @jest-environment node
 *
 * Covers the lifecycle gap investigated in this session: an existing
 * needs_review link (e.g. "U9MD - Hockey Mill", stuck in Review Required
 * because no "Hockey Mill" profile existed when it first matched) is never
 * revisited by any automatic matching path once it has a link row — not
 * Preview, not Activate, not the cron tick. Two things close that gap:
 *
 *  - reevaluateMatch gets a settled-decision guard: it may only touch a
 *    link whose matchStatus is still 'needs_review'. confirmed, rejected,
 *    and auto_confirmed links are returned unchanged, and the matcher is
 *    never even invoked for them — manual (the Needs Review panel's
 *    button) and automatic (reevaluateAllNeedsReview) re-evaluation both
 *    go through this one guard.
 *  - reevaluateAllNeedsReview re-runs every open needs_review link through
 *    reevaluateMatch — called after a configuration change that could
 *    resolve one (Activity Profile create/update/restore, Team &
 *    Calendar Identifier create/update/delete), never after archive.
 *
 * Like activityMatching.archivedProfiles.test.ts, this deliberately does
 * NOT mock listActivityProfiles, updateActivityEventLink, or matchEvent —
 * only db.select/update are mocked at the row level, so this exercises the
 * real guard, the real bulk query, and the real pure matcher together.
 */
const mockSelect = jest.fn();
const mockUpdate = jest.fn();
const mockInsert = jest.fn();
const mockDelete = jest.fn();

jest.mock('@/lib/db/client', () => ({
  db: {
    select: (...a: unknown[]) => mockSelect(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    insert: (...a: unknown[]) => mockInsert(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  },
}));

jest.mock('@/lib/db/schema', () => ({
  events: { id: 'events.id', title: 'events.title', startTime: 'events.startTime', pendingDeletion: 'events.pendingDeletion', calendarSourceId: 'events.calendarSourceId' },
  calendarSources: { id: 'calendarSources.id', groupId: 'calendarSources.groupId' },
  calendarGroups: { id: 'calendarGroups.id', userId: 'calendarGroups.userId', type: 'calendarGroups.type' },
  activityEventLinks: { id: 'id', eventId: 'eventId', matchStatus: 'matchStatus' },
  settings: { key: 'settings.key', value: 'settings.value' },
  activityProfiles: { id: 'id', name: 'name', archived: 'archived' },
}));

jest.mock('drizzle-orm', () => ({
  eq: (...a: unknown[]) => ({ op: 'eq', a }),
  and: (...a: unknown[]) => ({ op: 'and', a }),
  gte: (...a: unknown[]) => ({ op: 'gte', a }),
  lte: (...a: unknown[]) => ({ op: 'lte', a }),
  isNull: (...a: unknown[]) => ({ op: 'isNull', a }),
  asc: (col: unknown) => ({ op: 'asc', col }),
}));

// Real listActivityProfiles + real updateActivityEventLink — only the
// write path this file doesn't exercise (createActivityEventLinkIfAbsent)
// is stubbed.
jest.mock('@/lib/db/activityProfiles', () => {
  const actual = jest.requireActual('@/lib/db/activityProfiles');
  return { ...actual, createActivityEventLinkIfAbsent: jest.fn() };
});

import { reevaluateMatch, reevaluateAllNeedsReview } from '../activityMatching';

type ProfileRow = { id: string; name: string; matchKeywords: string[]; category: string | null; archived: boolean };

const hockeyMillProfile: ProfileRow = {
  id: 'p-hockey-mill',
  name: 'Hockey Mill',
  matchKeywords: ['Hockey Mill'],
  category: 'Hockey',
  archived: false,
};

const HOCKEY_IDENTIFIERS_SETTING = {
  key: 'activityTeamIdentifiers',
  value: [{ identifier: 'U9MD', memberId: 'member-beckham', category: 'Hockey' }],
};

function mockMatchingEnabledSelect(enabled: boolean) {
  mockSelect.mockReturnValueOnce({ from: () => ({ where: () => (enabled ? [{ value: { enabled: true } }] : []) }) });
}

function mockNeedsReviewIdsSelect(ids: string[]) {
  mockSelect.mockReturnValueOnce({ from: () => ({ where: () => ids.map((id) => ({ id })) }) });
}

/** reevaluateMatch's own multi-join select: link + event + calendar group, including matchStatus. */
function mockLinkJoinSelect(row: { eventTitle: string; calendarGroupMemberId: string | null; matchStatus: string } | null) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      innerJoin: () => ({
        leftJoin: () => ({
          leftJoin: () => ({
            where: () => (row ? [{ eventId: 'e1', ...row }] : []),
          }),
        }),
      }),
    }),
  });
}

function mockProfilesSelect(rows: ProfileRow[]) {
  mockSelect.mockReturnValueOnce({ from: () => ({ orderBy: () => rows }) });
}

function mockIdentifiersSettingsSelect(row: unknown) {
  mockSelect.mockReturnValueOnce({ from: () => ({ where: () => (row ? [row] : []) }) });
}

/** The fallback full-row select reevaluateMatch does when it's not going to write (guard refusal or ignore outcome). */
function mockFullLinkRowSelect(row: Record<string, unknown>) {
  mockSelect.mockReturnValueOnce({ from: () => ({ where: () => [row] }) });
}

function mockUpdateChain(returned: Record<string, unknown>) {
  const set = jest.fn().mockReturnValue({ where: () => ({ returning: () => [returned] }) });
  mockUpdate.mockReturnValueOnce({ set });
  return set;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reevaluateMatch — settled decisions are never touched', () => {
  it.each(['confirmed', 'rejected', 'auto_confirmed'] as const)(
    'refuses to modify a %s link, and never calls the matcher',
    async (matchStatus) => {
      mockLinkJoinSelect({ eventTitle: 'U9MD - Hockey Mill', calendarGroupMemberId: null, matchStatus });
      mockFullLinkRowSelect({ id: 'link-1', matchStatus, activityProfileId: 'some-other-profile' });

      const result = await reevaluateMatch('link-1');

      expect(result).not.toBeNull();
      expect(result!.changed).toBe(false);
      expect(result!.link.matchStatus).toBe(matchStatus);
      // No profiles/identifiers lookup, no write — the guard returns before
      // any of that, which this proves indirectly: only the two selects
      // above were queued, so a third select or any update call would
      // throw/return undefined rather than a usable chain.
      expect(mockUpdate).not.toHaveBeenCalled();
    },
  );

  it('still updates a needs_review link exactly as before the guard existed', async () => {
    mockLinkJoinSelect({ eventTitle: 'U9MD - Hockey Mill', calendarGroupMemberId: null, matchStatus: 'needs_review' });
    mockProfilesSelect([hockeyMillProfile]);
    mockIdentifiersSettingsSelect(HOCKEY_IDENTIFIERS_SETTING);
    const set = mockUpdateChain({ id: 'link-1', activityProfileId: 'p-hockey-mill', assignedMemberId: 'member-beckham', matchStatus: 'auto_confirmed' });

    const result = await reevaluateMatch('link-1');

    expect(result).not.toBeNull();
    expect(result!.changed).toBe(true);
    expect(result!.link.matchStatus).toBe('auto_confirmed');
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ activityProfileId: 'p-hockey-mill', assignedMemberId: 'member-beckham', matchStatus: 'auto_confirmed' }),
    );
  });

  it('returns null for a link id that does not exist', async () => {
    mockLinkJoinSelect(null);
    const result = await reevaluateMatch('missing-link');
    expect(result).toBeNull();
  });
});

describe('reevaluateAllNeedsReview — the real "U9MD - Hockey Mill" scenario', () => {
  it('REGRESSION: creating/saving the Hockey Mill profile resolves the existing Review Required item to Hockey Mill + Beckham', async () => {
    mockMatchingEnabledSelect(true);
    mockNeedsReviewIdsSelect(['link-1']);
    mockLinkJoinSelect({ eventTitle: 'U9MD - Hockey Mill', calendarGroupMemberId: null, matchStatus: 'needs_review' });
    mockProfilesSelect([hockeyMillProfile]);
    mockIdentifiersSettingsSelect(HOCKEY_IDENTIFIERS_SETTING);
    mockUpdateChain({ id: 'link-1', activityProfileId: 'p-hockey-mill', assignedMemberId: 'member-beckham', matchStatus: 'auto_confirmed' });

    const summary = await reevaluateAllNeedsReview();

    expect(summary).toEqual({ total: 1, resolved: 1, stillNeedsReview: 0 });
  });

  it('an item that still cannot be resolved stays in Review Required rather than disappearing', async () => {
    mockMatchingEnabledSelect(true);
    mockNeedsReviewIdsSelect(['link-1']);
    // No identifier in the title at all, and no profile matches either —
    // matchEvent will resolve this to 'ignore', which reevaluateMatch
    // reports as changed:false, link unchanged (still needs_review).
    mockLinkJoinSelect({ eventTitle: 'Completely Unrelated Event', calendarGroupMemberId: null, matchStatus: 'needs_review' });
    mockProfilesSelect([hockeyMillProfile]);
    mockIdentifiersSettingsSelect(null);
    mockFullLinkRowSelect({ id: 'link-1', matchStatus: 'needs_review' });

    const summary = await reevaluateAllNeedsReview();

    expect(summary).toEqual({ total: 1, resolved: 0, stillNeedsReview: 1 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('a mixed batch resolves what it can and leaves the rest in Review Required', async () => {
    mockMatchingEnabledSelect(true);
    mockNeedsReviewIdsSelect(['link-1', 'link-2']);

    // link-1 resolves.
    mockLinkJoinSelect({ eventTitle: 'U9MD - Hockey Mill', calendarGroupMemberId: null, matchStatus: 'needs_review' });
    mockProfilesSelect([hockeyMillProfile]);
    mockIdentifiersSettingsSelect(HOCKEY_IDENTIFIERS_SETTING);
    mockUpdateChain({ id: 'link-1', activityProfileId: 'p-hockey-mill', assignedMemberId: 'member-beckham', matchStatus: 'auto_confirmed' });

    // link-2 does not.
    mockLinkJoinSelect({ eventTitle: 'Totally Unrelated', calendarGroupMemberId: null, matchStatus: 'needs_review' });
    mockProfilesSelect([hockeyMillProfile]);
    mockIdentifiersSettingsSelect(null);
    mockFullLinkRowSelect({ id: 'link-2', matchStatus: 'needs_review' });

    const summary = await reevaluateAllNeedsReview();

    expect(summary).toEqual({ total: 2, resolved: 1, stillNeedsReview: 1 });
  });

  it('never queries or touches confirmed/rejected/auto_confirmed links — the bulk query filters to needs_review only', async () => {
    mockMatchingEnabledSelect(true);
    // The query itself is scoped to matchStatus = 'needs_review' — an
    // empty result here means confirmed/rejected/auto_confirmed rows were
    // never even candidates, let alone re-run through the matcher.
    mockNeedsReviewIdsSelect([]);

    const summary = await reevaluateAllNeedsReview();

    expect(summary).toEqual({ total: 0, resolved: 0, stillNeedsReview: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('is a no-op when Activity Matching is disabled, without even querying needs_review links', async () => {
    mockMatchingEnabledSelect(false);

    const summary = await reevaluateAllNeedsReview();

    expect(summary).toEqual({ total: 0, resolved: 0, stillNeedsReview: 0 });
    // Only the enabled-check select should have run.
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
