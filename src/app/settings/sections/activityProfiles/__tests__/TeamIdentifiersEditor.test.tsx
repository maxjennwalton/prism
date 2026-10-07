/**
 * @jest-environment jsdom
 *
 * `onSaved` is the production side of the Review Required UI-sync fix:
 * ActivityProfilesSection bumps a shared version counter from it, which
 * NeedsReviewPanel (and PreviewMatchesPanel) key off of to re-fetch. This
 * proves `onSaved` fires exactly once after a successful save, and —
 * critically — never fires after a rejected save or a save blocked by
 * client-side validation, so a failed save can never look like it
 * refreshed the Review Required queue.
 *
 * Identifier rows are seeded as already-loaded (via the mocked
 * useActivityTeamIdentifiers), then edited through plain text inputs
 * only — the member/identifier fields are already valid from the load,
 * so there's no need to drive the Radix Select picker to produce a save
 * worth testing.
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TeamIdentifiersEditor } from '../TeamIdentifiersEditor';

jest.mock('@/components/ui/use-toast', () => ({ toast: jest.fn() }));

jest.mock('@/components/providers', () => ({
  useFamily: () => ({ members: [{ id: 'member-beckham', name: 'Beckham' }] }),
}));

jest.mock('@/lib/hooks/useActivityProfiles', () => ({
  useActivityProfiles: () => ({ profiles: [] }),
}));

const mockSaveIdentifiers = jest.fn();
let mockIdentifiers: { identifier: string; memberId: string; category: string | null }[] = [];
jest.mock('@/lib/hooks/useActivityTeamIdentifiers', () => ({
  useActivityTeamIdentifiers: () => ({
    identifiers: mockIdentifiers,
    loading: false,
    saveIdentifiers: mockSaveIdentifiers,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockIdentifiers = [{ identifier: 'Youth Soccer', memberId: 'member-beckham', category: null }];
});

describe('TeamIdentifiersEditor — onSaved', () => {
  it('fires onSaved exactly once after a successful save', async () => {
    mockSaveIdentifiers.mockResolvedValue(undefined);
    const onSaved = jest.fn();
    render(<TeamIdentifiersEditor onSaved={onSaved} />);

    await screen.findByDisplayValue('Youth Soccer');
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Soccer' } });

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockSaveIdentifiers).toHaveBeenCalledTimes(1));
    expect(mockSaveIdentifiers).toHaveBeenCalledWith([
      { identifier: 'Youth Soccer', memberId: 'member-beckham', category: 'Soccer' },
    ]);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onSaved when the save request fails', async () => {
    mockSaveIdentifiers.mockRejectedValue(new Error('network error'));
    const onSaved = jest.fn();
    render(<TeamIdentifiersEditor onSaved={onSaved} />);

    await screen.findByDisplayValue('Youth Soccer');
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Soccer' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockSaveIdentifiers).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('does NOT fire onSaved when save is blocked by client-side validation (duplicate identifier) before any request is made', async () => {
    mockIdentifiers = [
      { identifier: 'Youth Soccer', memberId: 'member-beckham', category: null },
      { identifier: 'U9MD', memberId: 'member-beckham', category: 'Hockey' },
    ];
    const onSaved = jest.fn();
    render(<TeamIdentifiersEditor onSaved={onSaved} />);

    await screen.findByDisplayValue('Youth Soccer');
    const identifierInputs = screen.getAllByLabelText('Identifier');
    // Edit the second row to duplicate the first (case-insensitively) —
    // this is the edit that makes the form dirty enough to enable Save.
    fireEvent.change(identifierInputs[1]!, { target: { value: 'youth soccer' } });

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(mockSaveIdentifiers).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('works with no onSaved prop at all (optional, existing callers unaffected)', async () => {
    mockSaveIdentifiers.mockResolvedValue(undefined);
    render(<TeamIdentifiersEditor />);

    await screen.findByDisplayValue('Youth Soccer');
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Soccer' } });

    // Should not throw with onSaved omitted.
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(mockSaveIdentifiers).toHaveBeenCalledTimes(1));
  });

  it('Save stays disabled until something is actually edited', async () => {
    render(<TeamIdentifiersEditor onSaved={jest.fn()} />);
    await screen.findByDisplayValue('Youth Soccer');

    expect(screen.getByRole('button', { name: /^save$/i }).hasAttribute('disabled')).toBe(true);
  });
});
