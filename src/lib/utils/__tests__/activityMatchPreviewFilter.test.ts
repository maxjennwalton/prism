import { filterPreviewResults, PREVIEW_FILTERS, PREVIEW_FILTER_LABEL } from '../activityMatchPreviewFilter';
import type { ActivityMatchEventSummary, ActivityMatchResult } from '@/lib/hooks/useActivityMatchingPreview';

function result(overrides: Partial<ActivityMatchResult>): ActivityMatchResult {
  return {
    outcome: 'auto_match',
    profileId: null,
    memberId: null,
    matchStatus: null,
    reviewReason: null,
    matchedPhrase: null,
    profileCandidates: [],
    memberCandidates: [],
    identifiersFound: [],
    resolvedCategory: null,
    categoryCandidates: [],
    ...overrides,
  };
}

function row(eventId: string, startTime: string, outcome: ActivityMatchResult['outcome']): ActivityMatchEventSummary {
  return { eventId, title: `Event ${eventId}`, startTime, result: result({ outcome }) };
}

describe('filterPreviewResults — pure, client-side preview filtering', () => {
  const rows: ActivityMatchEventSummary[] = [
    row('1', '2026-10-08T18:00:00.000Z', 'auto_match'),
    row('2', '2026-10-09T18:00:00.000Z', 'needs_review'),
    row('3', '2026-10-10T18:00:00.000Z', 'ignore'),
    row('4', '2026-10-11T18:00:00.000Z', 'auto_match'),
    row('5', '2026-10-12T18:00:00.000Z', 'needs_review'),
  ];

  it('"all" returns every row, unchanged, as the exact same array reference (no copy, no mutation)', () => {
    const filtered = filterPreviewResults(rows, 'all');
    expect(filtered).toBe(rows);
    expect(filtered).toHaveLength(5);
  });

  it('"auto_match" returns only auto_match rows', () => {
    const filtered = filterPreviewResults(rows, 'auto_match');
    expect(filtered.map((r) => r.eventId)).toEqual(['1', '4']);
    expect(filtered.every((r) => r.result.outcome === 'auto_match')).toBe(true);
  });

  it('"needs_review" returns only needs_review rows', () => {
    const filtered = filterPreviewResults(rows, 'needs_review');
    expect(filtered.map((r) => r.eventId)).toEqual(['2', '5']);
    expect(filtered.every((r) => r.result.outcome === 'needs_review')).toBe(true);
  });

  it('"ignore" ("Activity Profile N/A") returns only ignore rows', () => {
    const filtered = filterPreviewResults(rows, 'ignore');
    expect(filtered.map((r) => r.eventId)).toEqual(['3']);
    expect(filtered.every((r) => r.result.outcome === 'ignore')).toBe(true);
  });

  it('preserves the relative (chronological) order of the rows it keeps', () => {
    const shuffled: ActivityMatchEventSummary[] = [
      row('b', '2026-10-09T18:00:00.000Z', 'needs_review'),
      row('a', '2026-10-08T18:00:00.000Z', 'needs_review'),
      row('c', '2026-10-10T18:00:00.000Z', 'needs_review'),
    ];
    // filterPreviewResults never re-sorts — it only narrows. Whatever order
    // the API returned (the canonical chronological sort) is preserved.
    expect(filterPreviewResults(shuffled, 'needs_review').map((r) => r.eventId)).toEqual(['b', 'a', 'c']);
  });

  it('never mutates the input array or any of its row objects', () => {
    const original = [...rows];
    const originalRowRefs = rows.map((r) => r);
    filterPreviewResults(rows, 'auto_match');
    filterPreviewResults(rows, 'needs_review');
    filterPreviewResults(rows, 'ignore');
    expect(rows).toEqual(original);
    rows.forEach((r, i) => expect(r).toBe(originalRowRefs[i]));
  });

  it('is a pure function: calling it repeatedly with the same inputs gives equal results', () => {
    expect(filterPreviewResults(rows, 'needs_review')).toEqual(filterPreviewResults(rows, 'needs_review'));
  });

  it('every filter in PREVIEW_FILTERS has a label, and "all" is listed first (the required default)', () => {
    expect(PREVIEW_FILTERS[0]).toBe('all');
    for (const f of PREVIEW_FILTERS) {
      expect(typeof PREVIEW_FILTER_LABEL[f]).toBe('string');
      expect(PREVIEW_FILTER_LABEL[f].length).toBeGreaterThan(0);
    }
  });
});
