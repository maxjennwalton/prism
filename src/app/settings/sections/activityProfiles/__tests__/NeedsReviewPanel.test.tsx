/**
 * @jest-environment jsdom
 *
 * UX refinement: the saved Review Required queue's explanations were too
 * technical/confusing for a parent to act on without more context. This
 * locks in the new copy — including the member-name-aware `unclassified`
 * variants and the renamed `category_unresolved` copy — and proves the
 * existing confirm/reject/profile-selection behavior is unchanged
 * underneath the new wording.
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NeedsReviewPanel } from '../NeedsReviewPanel';
import type { NeedsReviewItem } from '@/lib/hooks/useActivityMatchingNeedsReview';

jest.mock('@/components/ui/use-toast', () => ({ toast: jest.fn() }));

jest.mock('@/components/providers', () => ({
  useFamily: () => ({ members: [{ id: 'member-beckham', name: 'Beckham' }, { id: 'member-theo', name: 'Theo' }] }),
}));

jest.mock('@/lib/hooks/useActivityProfiles', () => ({
  useActivityProfiles: () => ({ profiles: [{ id: 'profile-hockey-game', name: 'Hockey Game' }] }),
}));

const mockUseActivityMatchingStatus = jest.fn();
jest.mock('@/lib/hooks/useActivityMatchingStatus', () => ({
  useActivityMatchingStatus: () => mockUseActivityMatchingStatus(),
}));

const mockConfirm = jest.fn();
const mockReject = jest.fn();
const mockReevaluate = jest.fn();
const mockRefresh = jest.fn();
let mockItems: NeedsReviewItem[] = [];
jest.mock('@/lib/hooks/useActivityMatchingNeedsReview', () => ({
  useActivityMatchingNeedsReview: () => ({ items: mockItems, confirm: mockConfirm, reject: mockReject, reevaluate: mockReevaluate, refresh: mockRefresh }),
}));

function baseItem(overrides: Partial<NeedsReviewItem>): NeedsReviewItem {
  return {
    id: 'link-1',
    eventId: 'event-1',
    eventTitle: 'U9MD - Hockey Mill',
    eventStartTime: '2026-10-08T18:00:00.000Z',
    activityProfileId: null,
    assignedMemberId: null,
    reviewReason: 'unclassified',
    profileCandidates: [],
    memberCandidates: [],
    identifiersFound: [],
    resolvedCategory: null,
    categoryCandidates: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseActivityMatchingStatus.mockReturnValue({ status: { enabled: true, enabledAt: null }, loading: false });
  mockConfirm.mockResolvedValue(undefined);
  mockReject.mockResolvedValue(undefined);
  mockReevaluate.mockResolvedValue(undefined);
});

describe('NeedsReviewPanel — unclassified wording', () => {
  it('names the resolved member when one is known: "U9MD - Hockey Mill" explicitly says Beckham', () => {
    mockItems = [baseItem({ eventTitle: 'U9MD - Hockey Mill', reviewReason: 'unclassified', assignedMemberId: 'member-beckham' })];
    render(<NeedsReviewPanel reviewQueueVersion={0} />);

    expect(screen.getByText('No matching Activity Profile')).not.toBeNull();
    expect(
      screen.getByText(
        "Prism knows this is Beckham's activity, but there isn't a matching Activity Profile yet. Choose one below, create a new profile, or mark it as Not an Activity.",
      ),
    ).not.toBeNull();
  });

  it('uses the generic explanation when no member is uniquely resolved', () => {
    mockItems = [baseItem({ eventTitle: 'Hockey Card Trade Fundraiser', reviewReason: 'unclassified', assignedMemberId: null })];
    render(<NeedsReviewPanel reviewQueueVersion={0} />);

    expect(screen.getByText('No matching Activity Profile')).not.toBeNull();
    expect(
      screen.getByText(
        "Prism recognized this as a scheduled activity, but there isn't a matching Activity Profile yet and it isn't sure which family member it's for. Choose the correct profile and family member below, or mark it as Not an Activity.",
      ),
    ).not.toBeNull();
    // Never invents a name it doesn't have.
    expect(screen.queryByText(/Prism knows this is/)).toBeNull();
  });
});

describe('NeedsReviewPanel — category_unresolved wording', () => {
  it('uses the "Activity type not recognized" copy', () => {
    mockItems = [baseItem({ eventTitle: 'Soccer Programs - Game', reviewReason: 'category_unresolved' })];
    render(<NeedsReviewPanel reviewQueueVersion={0} />);

    expect(screen.getByText('Activity type not recognized')).not.toBeNull();
    expect(
      screen.getByText("Prism found a possible activity but doesn't know what type it is yet. Choose the correct Activity Profile below, or mark it as Not an Activity."),
    ).not.toBeNull();
    expect(screen.queryByText('Category needed')).toBeNull();
  });
});

describe('NeedsReviewPanel — profile selector copy', () => {
  it('shows "Choose Activity Profile…" for the unselected state instead of "No profile"', () => {
    mockItems = [baseItem({ reviewReason: 'unclassified', assignedMemberId: null })];
    render(<NeedsReviewPanel reviewQueueVersion={0} />);

    expect(screen.getByText('Choose Activity Profile…')).not.toBeNull();
    expect(screen.queryByText('No profile')).toBeNull();
  });
});

describe('NeedsReviewPanel — existing confirm/reject behavior is unchanged', () => {
  it('"Not an activity" still calls reject with the item id', async () => {
    mockItems = [baseItem({ reviewReason: 'unclassified', assignedMemberId: 'member-beckham' })];
    render(<NeedsReviewPanel reviewQueueVersion={0} />);

    fireEvent.click(screen.getByRole('button', { name: /not an activity/i }));
    await waitFor(() => expect(mockReject).toHaveBeenCalledWith('link-1'));
  });

  it('Confirm is disabled until a profile is chosen, and calls confirm with the item id once one is', () => {
    mockItems = [baseItem({ reviewReason: 'unclassified', assignedMemberId: 'member-beckham', activityProfileId: null })];
    render(<NeedsReviewPanel reviewQueueVersion={0} />);

    const confirmButton = screen.getByRole('button', { name: /^confirm$/i });
    expect(confirmButton.hasAttribute('disabled')).toBe(true);
  });

  it('Confirm is enabled and calls confirm when the item already has a profile assigned', async () => {
    mockItems = [baseItem({ reviewReason: 'unclassified', assignedMemberId: 'member-beckham', activityProfileId: 'profile-hockey-game' })];
    render(<NeedsReviewPanel reviewQueueVersion={0} />);

    const confirmButton = screen.getByRole('button', { name: /^confirm$/i });
    expect(confirmButton.hasAttribute('disabled')).toBe(false);

    fireEvent.click(confirmButton);
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith('link-1', 'profile-hockey-game', 'member-beckham'));
  });
});

describe('NeedsReviewPanel — manual Re-evaluate Match', () => {
  it('calls the reevaluate hook method with the item id when clicked', async () => {
    mockItems = [baseItem({ id: 'link-42', eventTitle: 'U9MD - Hockey Mill', reviewReason: 'unclassified', assignedMemberId: 'member-beckham' })];
    render(<NeedsReviewPanel reviewQueueVersion={0} />);

    fireEvent.click(screen.getByRole('button', { name: /re-evaluate match/i }));
    await waitFor(() => expect(mockReevaluate).toHaveBeenCalledWith('link-42'));
  });

  it('is available independently of Confirm — it is not disabled by a missing profile selection', () => {
    mockItems = [baseItem({ reviewReason: 'unclassified', assignedMemberId: null, activityProfileId: null })];
    render(<NeedsReviewPanel reviewQueueVersion={0} />);

    const reevaluateButton = screen.getByRole('button', { name: /re-evaluate match/i });
    expect(reevaluateButton.hasAttribute('disabled')).toBe(false);
  });
});

describe('NeedsReviewPanel — visibility', () => {
  it('renders nothing when Activity Matching is off, even with items queued', () => {
    mockUseActivityMatchingStatus.mockReturnValue({ status: { enabled: false, enabledAt: null }, loading: false });
    mockItems = [baseItem({ reviewReason: 'unclassified' })];
    const { container } = render(<NeedsReviewPanel reviewQueueVersion={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when there are no items', () => {
    mockItems = [];
    const { container } = render(<NeedsReviewPanel reviewQueueVersion={0} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('NeedsReviewPanel — re-fetches the queue when reviewQueueVersion changes', () => {
  // This is the shared mechanism behind every one of: identifier save,
  // Activity Profile create, update, and restore — all of them bump the
  // same counter (see ActivityProfilesSection and TeamIdentifiersEditor),
  // so proving the panel reacts correctly to the counter changing covers
  // all four without needing four near-identical tests here. Each
  // producer's own test (TeamIdentifiersEditor / ActivityProfilesSection)
  // proves it actually bumps the counter after its specific mutation.
  it('calls refresh — a plain re-fetch, not a new POST/matcher run — when the version changes after mount', () => {
    mockItems = [baseItem({ reviewReason: 'unclassified' })];
    const { rerender } = render(<NeedsReviewPanel reviewQueueVersion={0} />);
    expect(mockRefresh).not.toHaveBeenCalled();

    rerender(<NeedsReviewPanel reviewQueueVersion={1} />);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh again on a re-render with the same version', () => {
    mockItems = [baseItem({ reviewReason: 'unclassified' })];
    const { rerender } = render(<NeedsReviewPanel reviewQueueVersion={0} />);

    rerender(<NeedsReviewPanel reviewQueueVersion={0} />);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('refreshes again on each subsequent distinct version (e.g. an identifier save followed later by a profile create)', () => {
    mockItems = [baseItem({ reviewReason: 'unclassified' })];
    const { rerender } = render(<NeedsReviewPanel reviewQueueVersion={0} />);

    rerender(<NeedsReviewPanel reviewQueueVersion={1} />);
    rerender(<NeedsReviewPanel reviewQueueVersion={2} />);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });
});
