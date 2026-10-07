/**
 * @jest-environment jsdom
 *
 * UX refinement regression: a small "Disabled" badge next to an "Enable"
 * button was too easy to misread as matching already being on. This locks
 * in the clearer copy/presentation contract — status heading, supporting
 * text, "Since <date>" when on, and the renamed buttons — without touching
 * activation/disable behavior itself (activate()/disable() are mocked and
 * asserted as still being called exactly as before).
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MatchingStatusPanel } from '../MatchingStatusPanel';

jest.mock('@/components/ui/use-toast', () => ({ toast: jest.fn() }));

const mockActivate = jest.fn();
const mockDisable = jest.fn();
const mockUseActivityMatchingStatus = jest.fn();

jest.mock('@/lib/hooks/useActivityMatchingStatus', () => ({
  useActivityMatchingStatus: () => mockUseActivityMatchingStatus(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockActivate.mockResolvedValue({ total: 0, autoMatched: 0, needsReview: 0, ignored: 0 });
  mockDisable.mockResolvedValue(undefined);
});

describe('MatchingStatusPanel — OFF state', () => {
  beforeEach(() => {
    mockUseActivityMatchingStatus.mockReturnValue({
      status: { enabled: false, enabledAt: null },
      loading: false,
      activate: mockActivate,
      disable: mockDisable,
    });
  });

  it('shows the OFF heading, supporting text, and "Turn On" button', () => {
    render(<MatchingStatusPanel />);
    expect(screen.getByText('Activity Matching is OFF')).not.toBeNull();
    expect(screen.getByText('Calendar events are not currently being matched automatically.')).not.toBeNull();
    expect(screen.getByRole('button', { name: /turn on activity matching/i })).not.toBeNull();
  });

  it('never renders a "Since" date while off', () => {
    render(<MatchingStatusPanel />);
    expect(screen.queryByText(/^Since /)).toBeNull();
  });

  it('clicking "Turn On Activity Matching" still calls activate() — enable behavior is unchanged', async () => {
    render(<MatchingStatusPanel />);
    fireEvent.click(screen.getByRole('button', { name: /turn on activity matching/i }));
    await waitFor(() => expect(mockActivate).toHaveBeenCalledTimes(1));
  });
});

describe('MatchingStatusPanel — ON state', () => {
  beforeEach(() => {
    mockUseActivityMatchingStatus.mockReturnValue({
      status: { enabled: true, enabledAt: '2026-10-01T00:00:00.000Z' },
      loading: false,
      activate: mockActivate,
      disable: mockDisable,
    });
  });

  it('shows the ON heading, "Since <date>", supporting text, and "Turn Off" button', () => {
    render(<MatchingStatusPanel />);
    expect(screen.getByText('Activity Matching is ON')).not.toBeNull();
    expect(screen.getByText(/^Since /)).not.toBeNull();
    expect(screen.getByText('New calendar events are automatically checked against your Activity Profiles.')).not.toBeNull();
    expect(screen.getByRole('button', { name: /turn off activity matching/i })).not.toBeNull();
  });

  it('never shows the OFF copy while on', () => {
    render(<MatchingStatusPanel />);
    expect(screen.queryByText('Activity Matching is OFF')).toBeNull();
    expect(screen.queryByText('Calendar events are not currently being matched automatically.')).toBeNull();
  });

  it('clicking "Turn Off Activity Matching" still goes through the confirm dialog and calls disable() — disable behavior is unchanged', async () => {
    render(<MatchingStatusPanel />);
    fireEvent.click(screen.getByRole('button', { name: /turn off activity matching/i }));

    // ConfirmDialog renders its own confirm button (default label
    // "Continue") — behavior (confirm gate before disabling) is preserved
    // exactly as before this change.
    const confirmButton = await screen.findByRole('button', { name: /^continue$/i });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockDisable).toHaveBeenCalledTimes(1));
  });
});
