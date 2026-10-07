/**
 * @jest-environment node
 *
 * Service-layer regression for a real Phase 3 bug report: calendar events
 * titled like a real youth-sports feed ("2026/27 Youth Sports Programs -
 * Soccer Programs - ... - Game") were classifying as `Hockey Game · — →
 * Review Required`, because with no Hockey identifier in the title, no
 * category context resolved, and matching fell back to searching every
 * active profile — including ones scoped to a category this event has no
 * evidence for.
 *
 * Like activityMatching.archivedProfiles.test.ts, this deliberately does
 * NOT mock `listActivityProfiles` or `matchEvent` — it exercises the real
 * data-access filter and the real pure matcher together through the real
 * `matchEventsInRange`, with only `db.select()` mocked at the row level.
 * That's what proves the fix holds end-to-end, through the exact function
 * Preview, Activate/backfill, and the incremental cron tick all share.
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

jest.mock('@/lib/db/activityProfiles', () => {
  const actual = jest.requireActual('@/lib/db/activityProfiles');
  return {
    ...actual,
    createActivityEventLinkIfAbsent: jest.fn(),
    updateActivityEventLink: jest.fn(),
  };
});

import { createActivityEventLinkIfAbsent } from '@/lib/db/activityProfiles';
import { matchEventsInRange } from '../activityMatching';

const HOCKEY_GAME_ID = 'p-hockey-game';
const HOCKEY_PRACTICE_ID = 'p-hockey-practice';

type ProfileRow = { id: string; name: string; matchKeywords: string[]; category: string | null; archived: boolean };

// Mirrors the real household's setup at the time of the bug report: only
// Hockey profiles + Hockey identifiers exist, no Soccer profile/identifier yet.
const hockeyGame: ProfileRow = { id: HOCKEY_GAME_ID, name: 'Hockey Game', matchKeywords: ['Game'], category: 'Hockey', archived: false };
const hockeyPractice: ProfileRow = { id: HOCKEY_PRACTICE_ID, name: 'Hockey Practice', matchKeywords: ['Practice'], category: 'Hockey', archived: false };

const HOCKEY_IDENTIFIERS_SETTING = {
  key: 'activityTeamIdentifiers',
  value: [
    { identifier: 'U9MD', memberId: 'member-beckham', category: 'Hockey' },
    { identifier: 'U11LL1', memberId: 'member-theo', category: 'Hockey' },
  ],
};

function mockProfilesSelect(rows: ProfileRow[]) {
  mockSelect.mockReturnValueOnce({ from: () => ({ orderBy: () => rows }) });
}

function mockSettingsSelect(identifiersRow: unknown) {
  mockSelect.mockReturnValueOnce({ from: () => ({ where: () => (identifiersRow ? [identifiersRow] : []) }) });
}

type EventRow = { id: string; title: string; startTime: Date; calendarGroupMemberId: string | null };

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

describe('matchEventsInRange — a categorized profile cannot claim a category-unknown event', () => {
  it('REGRESSION: a real soccer calendar title never gets assigned Hockey Game, even though "Game" matches its keyword', async () => {
    mockProfilesSelect([hockeyGame, hockeyPractice]);
    mockSettingsSelect(HOCKEY_IDENTIFIERS_SETTING);
    mockEventsSelect([
      {
        id: 'e1',
        title: '2026/27 Youth Sports Programs - Soccer Programs - Grasshoppers vs Sharks - Game',
        startTime: new Date('2026-10-08T18:00:00Z'),
        calendarGroupMemberId: null,
      },
    ]);

    const summary = await matchEventsInRange(new Date('2026-10-01'), new Date('2026-12-01'), { persist: false });

    const row = summary.results[0]!;
    expect(row.result.outcome).toBe('needs_review');
    expect(row.result.reviewReason).toBe('category_unresolved');
    expect(row.result.profileId).toBeNull();
    expect(row.result.profileId).not.toBe(HOCKEY_GAME_ID);
    // Still surfaced (Preview shows it) without ever being assigned.
    expect(row.result.profileCandidates.map((c) => c.profileId)).toContain(HOCKEY_GAME_ID);
    expect(summary.autoMatched).toBe(0);
    expect(summary.needsReview).toBe(1);
  });

  it('persists the link with activityProfileId null and reviewReason category_unresolved (Activate/backfill + cron both call this with persist: true)', async () => {
    mockProfilesSelect([hockeyGame, hockeyPractice]);
    mockSettingsSelect(HOCKEY_IDENTIFIERS_SETTING);
    mockEventsSelect([
      {
        id: 'e1',
        title: '2026/27 Youth Sports Programs - Soccer Programs - Grasshoppers vs Sharks - Game',
        startTime: new Date('2026-10-08T18:00:00Z'),
        calendarGroupMemberId: null,
      },
    ]);
    (createActivityEventLinkIfAbsent as jest.Mock).mockResolvedValue({ id: 'link-1' });

    await matchEventsInRange(new Date('2026-10-01'), new Date('2026-12-01'), { persist: true });

    expect(createActivityEventLinkIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'e1',
        activityProfileId: null,
        matchStatus: 'needs_review',
        matchMeta: expect.objectContaining({
          reviewReason: 'category_unresolved',
          profileCandidates: expect.arrayContaining([expect.objectContaining({ profileId: HOCKEY_GAME_ID })]),
        }),
      }),
      expect.anything(),
    );
  });

  it('REGRESSION: existing U9MD Hockey events in the SAME run still auto-match correctly — the fix does not touch resolved-category matching', async () => {
    mockProfilesSelect([hockeyGame, hockeyPractice]);
    mockSettingsSelect(HOCKEY_IDENTIFIERS_SETTING);
    mockEventsSelect([
      { id: 'e1', title: 'U9MD - Game vs Wasaga Beach Stars', startTime: new Date('2026-10-08T18:00:00Z'), calendarGroupMemberId: null },
      {
        id: 'e2',
        title: '2026/27 Youth Sports Programs - Soccer Programs - Grasshoppers vs Sharks - Game',
        startTime: new Date('2026-10-09T18:00:00Z'),
        calendarGroupMemberId: null,
      },
    ]);

    const summary = await matchEventsInRange(new Date('2026-10-01'), new Date('2026-12-01'), { persist: false });

    const hockeyRow = summary.results.find((r) => r.eventId === 'e1')!;
    expect(hockeyRow.result.outcome).toBe('auto_match');
    expect(hockeyRow.result.profileId).toBe(HOCKEY_GAME_ID);
    expect(hockeyRow.result.resolvedCategory).toBe('Hockey');

    const soccerRow = summary.results.find((r) => r.eventId === 'e2')!;
    expect(soccerRow.result.outcome).toBe('needs_review');
    expect(soccerRow.result.reviewReason).toBe('category_unresolved');

    expect(summary.autoMatched).toBe(1);
    expect(summary.needsReview).toBe(1);
  });

  it('an uncategorized profile continues to auto-match normally end-to-end, unaffected by the fix', async () => {
    const familyOuting: ProfileRow = { id: 'p-family-outing', name: 'Family Outing', matchKeywords: ['Outing'], category: null, archived: false };
    mockProfilesSelect([familyOuting]);
    mockSettingsSelect(null);
    mockEventsSelect([
      { id: 'e1', title: 'Family Outing to the Zoo', startTime: new Date('2026-10-08T18:00:00Z'), calendarGroupMemberId: 'member-beckham' },
    ]);

    const summary = await matchEventsInRange(new Date('2026-10-01'), new Date('2026-12-01'), { persist: false });

    const row = summary.results[0]!;
    expect(row.result.outcome).toBe('auto_match');
    expect(row.result.profileId).toBe('p-family-outing');
  });
});
