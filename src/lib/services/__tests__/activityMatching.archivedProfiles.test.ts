/**
 * @jest-environment node
 *
 * Regression coverage for a real Phase 3 bug report: an archived Activity
 * Profile ("Hockey Practice (copy)") kept showing up in Preview Matches as
 * a profile candidate / Review Required cause, even though it had been
 * archived in Settings.
 *
 * Unlike activityMatching.test.ts, this file deliberately does NOT mock
 * `listActivityProfiles` or `matchEvent` — it lets the real data-access
 * filter and the real pure matcher run, with only `db.select()` mocked at
 * the row level. That's the only way to prove the *actual* data-loading
 * path (not a test double standing in for it) excludes archived profiles
 * from every automatic matching caller: Preview, Activate/backfill,
 * incremental cron ticks (all three go through matchEventsInRange), and
 * Re-evaluate Match (reevaluateMatch).
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

// Real `listActivityProfiles` (the actual archived-filter under test) — only
// the write paths are stubbed out, since persistence isn't what this file
// is checking.
jest.mock('@/lib/db/activityProfiles', () => {
  const actual = jest.requireActual('@/lib/db/activityProfiles');
  return {
    ...actual,
    createActivityEventLinkIfAbsent: jest.fn(),
    updateActivityEventLink: jest.fn(),
  };
});

import { createActivityEventLinkIfAbsent, updateActivityEventLink } from '@/lib/db/activityProfiles';
import { matchEventsInRange, reevaluateMatch } from '../activityMatching';

const ARCHIVED_PROFILE_ID = 'archived-hockey-practice-copy';

type ProfileRow = { id: string; name: string; matchKeywords: string[]; category: string | null; archived: boolean };

const archivedProfile: ProfileRow = {
  id: ARCHIVED_PROFILE_ID,
  name: 'Hockey Practice (copy)',
  matchKeywords: ['game', 'practice'],
  category: null,
  archived: true,
};

/** `db.select().from(activityProfiles).orderBy(...)` — real `listActivityProfiles` reads this. */
function mockProfilesSelect(rows: ProfileRow[]) {
  mockSelect.mockReturnValueOnce({ from: () => ({ orderBy: () => rows }) });
}

/** `db.select().from(settings).where(...)` — `loadTeamIdentifiers` reads this. */
function mockSettingsSelect(identifiersRow: unknown) {
  mockSelect.mockReturnValueOnce({ from: () => ({ where: () => (identifiersRow ? [identifiersRow] : []) }) });
}

type EventRow = { id: string; title: string; startTime: Date; calendarGroupMemberId: string | null };

/** `db.select({...}).from(events).leftJoin(...).leftJoin(...).leftJoin(...).where(...).orderBy(...)`. */
function mockEventsSelect(rows: EventRow[]) {
  const chain = {
    from: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnValue(rows),
  };
  mockSelect.mockReturnValueOnce(chain);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('matchEventsInRange — an archived profile never participates in automatic matching', () => {
  it('excludes an archived profile whose keyword matches the title, even with no other candidates (Preview, persist: false)', async () => {
    // Only the archived profile's keyword ("game") matches this title, and no
    // Team & Calendar Identifier is configured — so once the archived
    // profile is correctly filtered out, there is nothing left to match.
    mockProfilesSelect([archivedProfile]);
    mockSettingsSelect(null); // no activityTeamIdentifiers setting saved
    mockEventsSelect([
      { id: 'e1', title: 'U9MD - Game vs Wasaga Beach Stars', startTime: new Date('2026-10-08T18:00:00Z'), calendarGroupMemberId: null },
    ]);

    const summary = await matchEventsInRange(new Date('2026-10-01'), new Date('2026-12-01'), { persist: false });

    const row = summary.results[0]!;
    expect(row.result.outcome).toBe('ignore');
    expect(row.result.profileId).toBeNull();
    expect(row.result.profileCandidates).toEqual([]);
    expect(summary.autoMatched).toBe(0);
    expect(summary.needsReview).toBe(0);
  });

  it('routes to needs_review/unclassified (never auto_match, never the archived profile) when an identifier also matches', async () => {
    // A configured identifier ("U9MD" -> a family member) makes the title
    // "look like an activity", so the no-profile-match branch becomes
    // needs_review/unclassified rather than ignore — but the archived
    // profile must still never appear as profileId or in profileCandidates.
    mockProfilesSelect([archivedProfile]);
    mockSettingsSelect({ key: 'activityTeamIdentifiers', value: [{ identifier: 'U9MD', memberId: 'member-1', category: null }] });
    mockEventsSelect([
      { id: 'e1', title: 'U9MD - Game vs Wasaga Beach Stars', startTime: new Date('2026-10-08T18:00:00Z'), calendarGroupMemberId: null },
    ]);

    const summary = await matchEventsInRange(new Date('2026-10-01'), new Date('2026-12-01'), { persist: false });

    const row = summary.results[0]!;
    expect(row.result.outcome).toBe('needs_review');
    expect(row.result.reviewReason).toBe('unclassified');
    expect(row.result.profileId).toBeNull();
    expect(row.result.profileId).not.toBe(ARCHIVED_PROFILE_ID);
    expect(row.result.profileCandidates).toEqual([]);
    expect(row.result.profileCandidates.some((c) => c.profileId === ARCHIVED_PROFILE_ID)).toBe(false);
  });

  it('would have auto-matched the archived profile if it were not filtered — proving the exclusion, not the scenario, is what prevents it', async () => {
    // Sanity check: the SAME title + identifier, against the SAME keyword,
    // but with the profile reported as active, auto-matches. This confirms
    // the two tests above are failing for the right reason (archived
    // filtering) and not because the scenario could never match anything.
    mockProfilesSelect([{ ...archivedProfile, archived: false }]);
    mockSettingsSelect({ key: 'activityTeamIdentifiers', value: [{ identifier: 'U9MD', memberId: 'member-1', category: null }] });
    mockEventsSelect([
      { id: 'e1', title: 'U9MD - Game vs Wasaga Beach Stars', startTime: new Date('2026-10-08T18:00:00Z'), calendarGroupMemberId: null },
    ]);

    const summary = await matchEventsInRange(new Date('2026-10-01'), new Date('2026-12-01'), { persist: false });

    const row = summary.results[0]!;
    expect(row.result.outcome).toBe('auto_match');
    expect(row.result.profileId).toBe(ARCHIVED_PROFILE_ID);
  });

  it('never persists a link pointing at the archived profile (Activate/backfill + incremental cron both call this with persist: true)', async () => {
    mockProfilesSelect([archivedProfile]);
    mockSettingsSelect(null);
    mockEventsSelect([
      { id: 'e1', title: 'U9MD - Game vs Wasaga Beach Stars', startTime: new Date('2026-10-08T18:00:00Z'), calendarGroupMemberId: null },
    ]);

    await matchEventsInRange(new Date('2026-10-01'), new Date('2026-12-01'), { persist: true });

    // outcome was 'ignore' (see first test) so no link should be created at all.
    expect(createActivityEventLinkIfAbsent).not.toHaveBeenCalled();
  });
});

describe('reevaluateMatch — an archived profile never comes back on re-evaluation', () => {
  it('re-evaluating an existing link never re-assigns it to an archived profile', async () => {
    mockSelect
      // reevaluateMatch's own select (the link + event + calendar group)
      .mockReturnValueOnce({
        from: () => ({
          innerJoin: () => ({
            leftJoin: () => ({
              leftJoin: () => ({
                where: () => [
                  { eventId: 'e1', eventTitle: 'U9MD - Game vs Wasaga Beach Stars', calendarGroupMemberId: null },
                ],
              }),
            }),
          }),
        }),
      });
    mockProfilesSelect([archivedProfile]);
    mockSettingsSelect(null);
    // No identifier is configured either, so with the archived profile
    // correctly filtered out there is nothing left to match -> 'ignore'.
    // reevaluateMatch re-fetches the existing (unchanged) row in that case.
    mockSelect.mockReturnValueOnce({ from: () => ({ where: () => [{ id: 'link-1', activityProfileId: null }] }) });

    const result = await reevaluateMatch('link-1');

    expect(result).not.toBeNull();
    expect(result!.changed).toBe(false);
    expect(updateActivityEventLink).not.toHaveBeenCalled();
  });
});
