/**
 * @jest-environment jsdom
 *
 * Regression test for a real bug found during Phase 3 visual testing:
 * duplicating "Hockey Practice" into "Hockey Game", editing the duplicate,
 * and saving sometimes lost the edits back to the copied-from-original
 * values. The root cause is this component's load `useEffect` depending on
 * `onClose` (and `onSaved`, transitively through the save flow) — both are
 * recreated as new inline function references on every render of the
 * parent (`ActivityProfilesSection`), which isn't memoized. Whenever that
 * parent re-renders for any unrelated reason while the modal stays open on
 * the same profile, the effect's dependency array sees a "changed" value
 * and re-fires, re-fetching the profile and overwriting whatever the user
 * had already typed with the server's (still pre-edit) copy.
 */
import * as React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ActivityProfileEditorModal } from '../ActivityProfileEditorModal';

/** Flushes any pending microtasks (e.g. a mocked fetch's resolved promise) and the state updates they trigger. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

jest.mock('@/components/providers', () => ({
  useFamily: () => ({ members: [] }),
}));

jest.mock('@/lib/hooks/useActivityProfiles', () => ({
  fetchActivityProfileDetail: jest.fn(),
  createPrepStepRequest: jest.fn(),
  updatePrepStepRequest: jest.fn(),
  deletePrepStepRequest: jest.fn(),
}));

import { fetchActivityProfileDetail } from '@/lib/hooks/useActivityProfiles';

const DUPLICATE_DETAIL = {
  id: 'dup-id',
  name: 'Hockey Practice (copy)',
  category: 'Hockey',
  color: '#3B82F6',
  matchKeywords: ['Hockey Practice', 'Practice'],
  arrivalBufferMinutes: 15,
  travelMinutes: 10,
  defaultLocation: 'Community Rink',
  gearItems: [],
  archived: false,
  prepSteps: [],
};

describe('ActivityProfileEditorModal — in-progress edits must survive an unrelated parent re-render', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchActivityProfileDetail as jest.Mock).mockResolvedValue(DUPLICATE_DETAIL);
  });

  it('keeps a typed edit (and does not re-fetch) when the parent passes new onClose/onSaved references for the same profileId', async () => {
    const { rerender } = render(
      <ActivityProfileEditorModal profileId="dup-id" onClose={() => {}} onSaved={() => {}} />,
    );

    const nameInput = (await screen.findByLabelText('Profile name')) as HTMLInputElement;
    await waitFor(() => expect(nameInput.value).toBe('Hockey Practice (copy)'));

    fireEvent.change(nameInput, { target: { value: 'Hockey Game' } });
    expect(nameInput.value).toBe('Hockey Game');

    // Simulate ActivityProfilesSection re-rendering for an unrelated reason
    // (its onClose/onSaved are inline arrow functions, recreated on every
    // one of its own renders) while the modal stays open on the same
    // profile — profileId is unchanged, only the callback identities differ.
    rerender(
      <ActivityProfileEditorModal profileId="dup-id" onClose={() => {}} onSaved={() => {}} />,
    );

    // Flush any effect/microtask the re-render may have scheduled, including
    // a second mocked fetch resolving and its .then() handler running.
    await flush();

    expect(fetchActivityProfileDetail).toHaveBeenCalledTimes(1);
    expect(nameInput.value).toBe('Hockey Game');
  });

  it('does not re-fetch on a plain prop-identity change that leaves profileId and onClose/onSaved untouched', async () => {
    const stableOnClose = () => {};
    const stableOnSaved = () => {};
    const { rerender } = render(
      <ActivityProfileEditorModal profileId="dup-id" onClose={stableOnClose} onSaved={stableOnSaved} />,
    );

    await screen.findByLabelText('Profile name');
    await waitFor(() => expect(fetchActivityProfileDetail).toHaveBeenCalledTimes(1));

    rerender(
      <ActivityProfileEditorModal profileId="dup-id" onClose={stableOnClose} onSaved={stableOnSaved} />,
    );

    await flush();
    expect(fetchActivityProfileDetail).toHaveBeenCalledTimes(1);
  });
});
