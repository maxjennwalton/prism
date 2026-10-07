/**
 * @jest-environment jsdom
 *
 * Covers two related things:
 *
 * 1. The stale-snapshot regression from the archived-profile bug: a test
 *    run's result is a point-in-time snapshot held in component state
 *    (useActivityMatchingPreview), and nothing invalidated it when a
 *    profile was archived elsewhere on the same page. `reviewQueueVersion`
 *    fixes that.
 * 2. The UX cleanup this file is named for: "Test Activity Matching" is
 *    only ever meaningful while matching is OFF — its underlying query
 *    (loadUnlinkedEventsInRange) only looks at events with no
 *    activity_event_link yet, so once matching is ON and activation has
 *    linked most events, the same panel would silently narrow to "whatever
 *    is still unlinked" while still looking like a full simulation. Rather
 *    than present that confusing partial result, the whole section is
 *    hidden once matching is ON (see PreviewMatchesPanel's doc comment).
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

function statusOff() {
  return { status: { enabled: false, enabledAt: null }, loading: false, refresh: jest.fn(), activate: jest.fn(), disable: jest.fn() };
}
function statusOn() {
  return { status: { enabled: true, enabledAt: '2026-10-01T00:00:00.000Z' }, loading: false, refresh: jest.fn(), activate: jest.fn(), disable: jest.fn() };
}

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

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => SUMMARY_WITH_ARCHIVED_CANDIDATE,
  }) as unknown as typeof fetch;
});

describe('PreviewMatchesPanel — Activity Matching OFF', () => {
  beforeEach(() => {
    mockUseActivityMatchingStatus.mockReturnValue(statusOff());
  });

  it('shows the "Test Activity Matching" section with its description and "Run Test" button', () => {
    render(<PreviewMatchesPanel reviewQueueVersion={0} />);
    expect(screen.getByText('Test Activity Matching')).not.toBeNull();
    expect(
      screen.getByText('See how Activity Matching would handle your upcoming calendar events before you turn it on. Nothing will be saved.'),
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: /run test/i })).not.toBeNull();
  });

  it('"Run Test" runs the test and displays results with the four outcome filters', async () => {
    render(<PreviewMatchesPanel reviewQueueVersion={0} />);

    fireEvent.click(screen.getByRole('button', { name: /run test/i }));
    await flush();

    await waitFor(() => expect(screen.queryByText('U9MD - Game vs Wasaga Beach Stars')).not.toBeNull());
    expect(screen.getByText(/All \(1\)/)).not.toBeNull();
    expect(screen.getByText(/Auto Match \(0\)/)).not.toBeNull();
    expect(screen.getByText(/Review Required \(1\)/)).not.toBeNull();
    expect(screen.getByText(/Not an Activity \(0\)/)).not.toBeNull();
  });

  it('removes the previously-shown result once reviewQueueVersion changes (e.g. the profile was just archived)', async () => {
    const { rerender } = render(<PreviewMatchesPanel reviewQueueVersion={0} />);

    fireEvent.click(screen.getByRole('button', { name: /run test/i }));
    await flush();

    await waitFor(() => expect(screen.queryByText('U9MD - Game vs Wasaga Beach Stars')).not.toBeNull());

    // Simulate ActivityProfilesSection archiving a profile elsewhere on the
    // page, which bumps reviewQueueVersion — the snapshot above was computed
    // before that happened.
    rerender(<PreviewMatchesPanel reviewQueueVersion={1} />);
    await flush();

    expect(screen.queryByText('U9MD - Game vs Wasaga Beach Stars')).toBeNull();
  });

  it('does not clear a freshly-run test — only one run after reviewQueueVersion actually changed', async () => {
    const { rerender } = render(<PreviewMatchesPanel reviewQueueVersion={0} />);

    fireEvent.click(screen.getByRole('button', { name: /run test/i }));
    await flush();
    await waitFor(() => expect(screen.queryByText('U9MD - Game vs Wasaga Beach Stars')).not.toBeNull());

    // Re-rendering with the SAME reviewQueueVersion (no mutation happened)
    // must not clear a result that's still current.
    rerender(<PreviewMatchesPanel reviewQueueVersion={0} />);
    await flush();

    expect(screen.queryByText('U9MD - Game vs Wasaga Beach Stars')).not.toBeNull();
  });
});

describe('PreviewMatchesPanel — Activity Matching ON', () => {
  it('renders nothing at all — no heading, no button, no counts, no results', () => {
    mockUseActivityMatchingStatus.mockReturnValue(statusOn());
    const { container } = render(<PreviewMatchesPanel reviewQueueVersion={0} />);

    expect(screen.queryByText('Test Activity Matching')).toBeNull();
    expect(screen.queryByRole('button', { name: /run test/i })).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
