/**
 * @jest-environment jsdom
 *
 * Production side of the Review Required UI-sync fix, profile half:
 * ActivityProfilesSection owns `reviewQueueVersion` and bumps it from
 * `refreshAll` — already called after create, update (both via the
 * editor modal's `onSaved`), and restore. This proves each of those three
 * mutations actually bumps the counter ActivityMatchingCard forwards to
 * NeedsReviewPanel/PreviewMatchesPanel (see ActivityMatchingCard.test —
 * there isn't one; this file and NeedsReviewPanel's own test together
 * cover the producer and consumer ends of the same mechanism), and that
 * `onIdentifiersSaved` passed down for TeamIdentifiersEditor is the exact
 * same bump function, not a separate one that could drift.
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ActivityProfilesSection } from '../sections/ActivityProfilesSection';

jest.mock('@/components/ui/use-toast', () => ({ toast: jest.fn() }));
jest.mock('@/lib/hooks/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn().mockResolvedValue(true), dialogProps: { open: false } }),
}));
jest.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => null }));

const ACTIVE_PROFILE = {
  id: 'ap-active', name: 'Hockey Mill', category: 'Hockey', color: '#3B82F6',
  matchKeywords: ['Hockey Mill'], arrivalBufferMinutes: null, travelMinutes: null,
  defaultLocation: null, gearItems: [], archived: false,
  prepStepCount: 0, gearItemCount: 0, matchKeywordCount: 1,
};
const ARCHIVED_PROFILE = { ...ACTIVE_PROFILE, id: 'ap-archived', name: 'Old Thing', archived: true };

const mockRefreshActive = jest.fn();
const mockRefreshArchived = jest.fn();
const mockArchiveProfile = jest.fn();
const mockRestoreProfile = jest.fn();
const mockDuplicateProfile = jest.fn();

jest.mock('@/lib/hooks/useActivityProfiles', () => ({
  useActivityProfiles: (opts?: { includeArchived?: boolean }) =>
    opts?.includeArchived
      ? { profiles: [ACTIVE_PROFILE, ARCHIVED_PROFILE], refresh: mockRefreshArchived, restoreProfile: mockRestoreProfile }
      : { profiles: [ACTIVE_PROFILE], refresh: mockRefreshActive, archiveProfile: mockArchiveProfile, duplicateProfile: mockDuplicateProfile },
}));

const mockEditorModal = jest.fn((_props: unknown) => null);
jest.mock('../sections/activityProfiles/ActivityProfileEditorModal', () => ({
  ActivityProfileEditorModal: (props: unknown) => mockEditorModal(props),
}));

const mockMatchingCard = jest.fn((_props: unknown) => null);
jest.mock('../sections/activityProfiles/ActivityMatchingCard', () => ({
  ActivityMatchingCard: (props: unknown) => mockMatchingCard(props),
}));

jest.mock('../sections/activityProfiles/HomeAddressCard', () => ({
  HomeAddressCard: () => null,
}));

type CardProps = { reviewQueueVersion: number; onIdentifiersSaved: () => void };
type ModalProps = { profileId: string | null | undefined; onSaved: () => void | Promise<void> };

function lastCardProps(): CardProps {
  return mockMatchingCard.mock.calls.at(-1)![0] as CardProps;
}
function lastModalProps(): ModalProps {
  return mockEditorModal.mock.calls.at(-1)![0] as ModalProps;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRefreshActive.mockResolvedValue(undefined);
  mockRefreshArchived.mockResolvedValue(undefined);
  mockRestoreProfile.mockResolvedValue(undefined);
});

describe('ActivityProfilesSection — reviewQueueVersion bumps on every mutation that can resolve Review Required items', () => {
  it('starts at 0 and is forwarded to ActivityMatchingCard', () => {
    render(<ActivityProfilesSection />);
    expect(lastCardProps().reviewQueueVersion).toBe(0);
  });

  it('bumps after a profile CREATE (editor modal onSaved → refreshAll)', async () => {
    render(<ActivityProfilesSection />);
    const versionBefore = lastCardProps().reviewQueueVersion;

    fireEvent.click(screen.getByRole('button', { name: /create profile/i }));
    expect(lastModalProps().profileId).toBeNull(); // undefined=closed, null=new, per the component's own convention

    await act(async () => {
      await lastModalProps().onSaved();
    });

    expect(lastCardProps().reviewQueueVersion).toBe(versionBefore + 1);
  });

  it('bumps after a profile UPDATE (editor modal onSaved on an existing profileId)', async () => {
    render(<ActivityProfilesSection />);
    const versionBefore = lastCardProps().reviewQueueVersion;

    fireEvent.click(screen.getByRole('button', { name: /edit profile/i }));
    expect(lastModalProps().profileId).toBe('ap-active');

    await act(async () => {
      await lastModalProps().onSaved();
    });

    expect(lastCardProps().reviewQueueVersion).toBe(versionBefore + 1);
  });

  it('bumps after a profile RESTORE', async () => {
    render(<ActivityProfilesSection />);
    const versionBefore = lastCardProps().reviewQueueVersion;

    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));

    await waitFor(() => expect(mockRestoreProfile).toHaveBeenCalledWith('ap-archived'));
    await waitFor(() => expect(lastCardProps().reviewQueueVersion).toBe(versionBefore + 1));
  });

  it('does NOT bump when restore fails', async () => {
    mockRestoreProfile.mockRejectedValue(new Error('boom'));
    render(<ActivityProfilesSection />);
    const versionBefore = lastCardProps().reviewQueueVersion;

    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));

    await waitFor(() => expect(mockRestoreProfile).toHaveBeenCalled());
    expect(lastCardProps().reviewQueueVersion).toBe(versionBefore);
  });

  it('passes the exact same bump function as onIdentifiersSaved — calling it bumps the same counter TeamIdentifiersEditor would', async () => {
    render(<ActivityProfilesSection />);
    const versionBefore = lastCardProps().reviewQueueVersion;

    await act(async () => {
      lastCardProps().onIdentifiersSaved();
    });

    expect(lastCardProps().reviewQueueVersion).toBe(versionBefore + 1);
  });
});
