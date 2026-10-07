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
let mockItems: NeedsReviewItem[] = [];
jest.mock('@/lib/hooks/useActivityMatchingNeedsReview', () => ({
  useActivityMatchingNeedsReview: () => ({ items: mockItems, confirm: mockConfirm, reject: mockReject }),
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
});

describe('NeedsReviewPanel — unclassified wording', () => {
  it('names the resolved member when one is known: "U9MD - Hockey Mill" explicitly says Beckham', () => {
    mockItems = [baseItem({ eventTitle: 'U9MD - Hockey Mill', reviewReason: 'unclassified', assignedMemberId: 'member-beckham' })];
    render(<NeedsReviewPanel />);

    expect(screen.getByText('No matching Activity Profile')).not.toBeNull();
    expect(
      screen.getByText(
        "Prism knows this is Beckham's activity, but there isn't a matching Activity Profile yet. Choose one below, create a new profile, or mark it as Not an Activity.",
      ),
    ).not.toBeNull();
  });

  it('uses the generic explanation when no member is uniquely resolved', () => {
    mockItems = [baseItem({ eventTitle: 'Hockey Card Trade Fundraiser', reviewReason: 'unclassified', assignedMemberId: null })];
    render(<NeedsReviewPanel />);

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
    render(<NeedsReviewPanel />);

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
    render(<NeedsReviewPanel />);

    expect(screen.getByText('Choose Activity Profile…')).not.toBeNull();
    expect(screen.queryByText('No profile')).toBeNull();
  });
});

describe('NeedsReviewPanel — existing confirm/reject behavior is unchanged', () => {
  it('"Not an activity" still calls reject with the item id', async () => {
    mockItems = [baseItem({ reviewReason: 'unclassified', assignedMemberId: 'member-beckham' })];
    render(<NeedsReviewPanel />);

    fireEvent.click(screen.getByRole('button', { name: /not an activity/i }));
    await waitFor(() => expect(mockReject).toHaveBeenCalledWith('link-1'));
  });

  it('Confirm is disabled until a profile is chosen, and calls confirm with the item id once one is', () => {
    mockItems = [baseItem({ reviewReason: 'unclassified', assignedMemberId: 'member-beckham', activityProfileId: null })];
    render(<NeedsReviewPanel />);

    const confirmButton = screen.getByRole('button', { name: /^confirm$/i });
    expect(confirmButton.hasAttribute('disabled')).toBe(true);
  });

  it('Confirm is enabled and calls confirm when the item already has a profile assigned', async () => {
    mockItems = [baseItem({ reviewReason: 'unclassified', assignedMemberId: 'member-beckham', activityProfileId: 'profile-hockey-game' })];
    render(<NeedsReviewPanel />);

    const confirmButton = screen.getByRole('button', { name: /^confirm$/i });
    expect(confirmButton.hasAttribute('disabled')).toBe(false);

    fireEvent.click(confirmButton);
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith('link-1', 'profile-hockey-game', 'member-beckham'));
  });
});

describe('NeedsReviewPanel — visibility', () => {
  it('renders nothing when Activity Matching is off, even with items queued', () => {
    mockUseActivityMatchingStatus.mockReturnValue({ status: { enabled: false, enabledAt: null }, loading: false });
    mockItems = [baseItem({ reviewReason: 'unclassified' })];
    const { container } = render(<NeedsReviewPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when there are no items', () => {
    mockItems = [];
    const { container } = render(<NeedsReviewPanel />);
    expect(container.firstChild).toBeNull();
  });
});
