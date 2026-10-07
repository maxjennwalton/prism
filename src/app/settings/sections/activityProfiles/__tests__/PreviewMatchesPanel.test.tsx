/**
 * @jest-environment jsdom
 *
 * Regression test for a real Phase 3 bug report: an archived Activity
 * Profile ("Hockey Practice (copy)") kept appearing in Preview Matches as
 * a Review Required candidate even though it had been archived in
 * Settings. The matcher itself has always excluded archived profiles (see
 * activityMatching.archivedProfiles.test.ts for the service-layer proof) —
 * what was actually stale is that Preview's result is a point-in-time
 * snapshot held in component state (useActivityMatchingPreview), and
 * nothing ever invalidated it when a profile was archived elsewhere on the
 * same page. This test proves the `profilesVersion` prop now does that.
 */
import * as React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { PreviewMatchesPanel } from '../PreviewMatchesPanel';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

jest.mock('@/components/providers', () => ({
  useFamily: () => ({ members: [{ id: 'member-1', name: 'Beckham' }] }),
}));

const ARCHIVED_ID = 'archived-hockey-practice-copy';

jest.mock('@/lib/hooks/useActivityProfiles', () => ({
  useActivityProfiles: () => ({
    profiles: [{ id: ARCHIVED_ID, name: 'Hockey Practice (copy)', archived: true }],
  }),
}));

const mockUseActivityMatchingStatus = jest.fn();
jest.mock('@/lib/hooks/useActivityMatchingStatus', () => ({
  useActivityMatchingStatus: () => mockUseActivityMatchingStatus(),
}));

const SUMMARY_WITH_ARCHIVED_CANDIDATE = {
  total: 1,
  autoMatched: 0,
  needsReview: 1,
  ignored: 0,
  results: [
    {
      eventId: 'e1',
      title: 'U9MD - Game vs Wasaga Beach Stars',
      startTime: '2026-10-08T18:00:00.000Z',
      result: {
        outcome: 'needs_review',
        profileId: ARCHIVED_ID,
        memberId: null,
        matchStatus: 'needs_review',
        reviewReason: 'ambiguous_member',
        matchedPhrase: 'game',
        profileCandidates: [{ profileId: ARCHIVED_ID, matchedPhrase: 'game' }],
        memberCandidates: [],
        identifiersFound: [],
        resolvedCategory: null,
        categoryCandidates: [],
      },
    },
  ],
};

describe('PreviewMatchesPanel — discards a stale preview snapshot once profiles change', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseActivityMatchingStatus.mockReturnValue({
      status: { enabled: false, enabledAt: null },
      loading: false,
      refresh: jest.fn(),
      activate: jest.fn(),
      disable: jest.fn(),
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => SUMMARY_WITH_ARCHIVED_CANDIDATE,
    }) as unknown as typeof fetch;
  });

  it('removes the previously-shown result once profilesVersion changes (e.g. the profile was just archived)', async () => {
    const { rerender } = render(<PreviewMatchesPanel profilesVersion={0} />);

    fireEvent.click(screen.getByRole('button', { name: /preview matches/i }));
    await flush();

    await waitFor(() => expect(screen.queryByText('U9MD - Game vs Wasaga Beach Stars')).not.toBeNull());

    // Simulate ActivityProfilesSection archiving a profile elsewhere on the
    // page, which bumps profilesVersion — the snapshot above was computed
    // before that happened.
    rerender(<PreviewMatchesPanel profilesVersion={1} />);
    await flush();

    expect(screen.queryByText('U9MD - Game vs Wasaga Beach Stars')).toBeNull();
  });

  it('does not clear a freshly-run preview — only one run after profilesVersion actually changed', async () => {
    const { rerender } = render(<PreviewMatchesPanel profilesVersion={0} />);

    fireEvent.click(screen.getByRole('button', { name: /preview matches/i }));
    await flush();
    await waitFor(() => expect(screen.queryByText('U9MD - Game vs Wasaga Beach Stars')).not.toBeNull());

    // Re-rendering with the SAME profilesVersion (no mutation happened)
    // must not clear a result that's still current.
    rerender(<PreviewMatchesPanel profilesVersion={0} />);
    await flush();

    expect(screen.queryByText('U9MD - Game vs Wasaga Beach Stars')).not.toBeNull();
  });
});

describe('PreviewMatchesPanel — description copy depends on Activity Matching status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => SUMMARY_WITH_ARCHIVED_CANDIDATE }) as unknown as typeof fetch;
  });

  it('shows the OFF-state description when matching is disabled', () => {
    mockUseActivityMatchingStatus.mockReturnValue({
      status: { enabled: false, enabledAt: null },
      loading: false,
      refresh: jest.fn(),
      activate: jest.fn(),
      disable: jest.fn(),
    });
    render(<PreviewMatchesPanel profilesVersion={0} />);
    expect(
      screen.getByText('See what Activity Matching would do over the next 60 days before turning it on. Previewing never saves anything.'),
    ).not.toBeNull();
  });

  it('shows the ON-state description when matching is enabled', () => {
    mockUseActivityMatchingStatus.mockReturnValue({
      status: { enabled: true, enabledAt: '2026-10-01T00:00:00.000Z' },
      loading: false,
      refresh: jest.fn(),
      activate: jest.fn(),
      disable: jest.fn(),
    });
    render(<PreviewMatchesPanel profilesVersion={0} />);
    expect(
      screen.getByText('Preview how your current Activity Profiles and identifiers would match upcoming events. Previewing never changes saved matches.'),
    ).not.toBeNull();
  });
});
