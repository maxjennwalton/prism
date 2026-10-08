/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render as rtlRender, screen, type RenderOptions } from '@testing-library/react';
import { TimeFormatProvider } from '@/components/providers';

const render = (ui: React.ReactElement, options?: RenderOptions) =>
  rtlRender(ui, { wrapper: TimeFormatProvider, ...options });

beforeAll(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ settings: {} }) }),
  ) as unknown as typeof fetch;
});
afterAll(() => {
  delete (global as { fetch?: unknown }).fetch;
});

jest.mock('../WidgetContainer', () => ({
  WidgetContainer: ({ children, title, loading, error }: React.PropsWithChildren<{ title: string; loading?: boolean; error?: string | null }>) => (
    <div data-testid="widget-container">
      <h2>{title}</h2>
      {loading && <div data-testid="loading">Loading…</div>}
      {error && <div data-testid="error">{error}</div>}
      {children}
    </div>
  ),
  WidgetEmpty: ({ message }: { message: string }) => <div data-testid="widget-empty">{message}</div>,
}));

const mockUseActivityWorkflow = jest.fn();
jest.mock('@/lib/hooks/useActivityWorkflow', () => ({
  // `now` defaults here so individual tests only need to supply it when
  // the countdown math under test actually depends on the exact instant.
  useActivityWorkflow: () => ({ now: new Date('2026-10-08T17:00:00.000Z'), ...mockUseActivityWorkflow() }),
}));

import { ActivityWorkflowWidget } from '../ActivityWorkflowWidget';

function activity(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    linkId: 'link-1',
    eventId: 'event-1',
    eventTitle: 'U9MD - Hockey Practice',
    eventStart: new Date('2026-10-08T18:00:00.000Z'),
    eventEnd: new Date('2026-10-08T19:00:00.000Z'),
    memberId: 'member-1',
    memberName: 'Beckham',
    memberColor: '#ff0000',
    profileId: 'profile-1',
    profileName: 'Hockey Practice',
    profileColor: '#0000ff',
    profileArchived: false,
    location: 'Community Rink',
    arrivalTime: new Date('2026-10-08T17:30:00.000Z'),
    leaveHomeTime: new Date('2026-10-08T17:10:00.000Z'),
    prepSteps: [],
    status: { phase: 'upcoming', nextMilestone: { id: '__leave_home', kind: 'milestone', label: 'Leave home', time: new Date('2026-10-08T17:10:00.000Z') }, overdueMilestone: null },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseActivityWorkflow.mockReturnValue({ items: [], loading: false, error: null });
});

describe('ActivityWorkflowWidget — empty state', () => {
  it('shows "No activities scheduled for today." when there are no items', () => {
    render(<ActivityWorkflowWidget />);
    expect(screen.getByTestId('widget-empty').textContent).toBe('No activities scheduled for today.');
  });

  it('shows the empty state when every item is already completed', () => {
    mockUseActivityWorkflow.mockReturnValue({
      items: [activity({ status: { phase: 'completed', nextMilestone: null, overdueMilestone: null } })],
      loading: false,
      error: null,
    });
    render(<ActivityWorkflowWidget />);
    expect(screen.getByTestId('widget-empty').textContent).toBe('No activities scheduled for today.');
  });
});

describe('ActivityWorkflowWidget — loading/error passthrough', () => {
  it('passes loading through to WidgetContainer', () => {
    mockUseActivityWorkflow.mockReturnValue({ items: [], loading: true, error: null });
    render(<ActivityWorkflowWidget />);
    expect(screen.getByTestId('loading')).not.toBeNull();
  });

  it('passes an error through to WidgetContainer', () => {
    mockUseActivityWorkflow.mockReturnValue({ items: [], loading: false, error: 'Failed to load activity workflow' });
    render(<ActivityWorkflowWidget />);
    expect(screen.getByTestId('error').textContent).toBe('Failed to load activity workflow');
  });
});

describe('ActivityWorkflowWidget — primary + compact list', () => {
  it('shows the first (most urgent, per the hook\'s own sort) item as the primary card, and the rest compactly', () => {
    mockUseActivityWorkflow.mockReturnValue({
      items: [
        activity({ linkId: 'most-urgent' }),
        activity({ linkId: 'less-urgent', eventTitle: 'Soccer Game', eventId: 'event-2' }),
      ],
      loading: false,
      error: null,
    });
    render(<ActivityWorkflowWidget />);

    expect(screen.getByText('U9MD - Hockey Practice')).not.toBeNull();
    expect(screen.getByText('Soccer Game')).not.toBeNull();
    expect(screen.queryByTestId('widget-empty')).toBeNull();
  });

  it('shows the family member and profile name on the primary card', () => {
    mockUseActivityWorkflow.mockReturnValue({ items: [activity()], loading: false, error: null });
    render(<ActivityWorkflowWidget />);
    expect(screen.getByText('Beckham')).not.toBeNull();
    expect(screen.getByText('U9MD - Hockey Practice')).not.toBeNull();
    expect(screen.getByText(/· Hockey Practice/)).not.toBeNull();
  });
});

describe('ActivityWorkflowWidget — location and milestone display, never guessed', () => {
  it('shows the effective location when set', () => {
    mockUseActivityWorkflow.mockReturnValue({ items: [activity({ location: 'Community Rink' })], loading: false, error: null });
    render(<ActivityWorkflowWidget />);
    expect(screen.getByText('Community Rink')).not.toBeNull();
  });

  it('shows "Location not set" rather than inventing one', () => {
    mockUseActivityWorkflow.mockReturnValue({ items: [activity({ location: null })], loading: false, error: null });
    render(<ActivityWorkflowWidget />);
    expect(screen.getByText('Location not set')).not.toBeNull();
  });

  it('shows "Not calculated" for arrival/leave-home when they are null, instead of a guessed time', () => {
    mockUseActivityWorkflow.mockReturnValue({
      items: [activity({ arrivalTime: null, leaveHomeTime: null })],
      loading: false,
      error: null,
    });
    render(<ActivityWorkflowWidget />);
    const notCalculated = screen.getAllByText('Not calculated');
    expect(notCalculated.length).toBe(2); // Arrive + Leave home
  });

  it('renders prep steps with a time, or their unscheduled reason', () => {
    mockUseActivityWorkflow.mockReturnValue({
      items: [
        activity({
          prepSteps: [
            { id: 'step-1', label: 'Get dressed', kind: 'checkable', time: new Date('2026-10-08T16:45:00.000Z'), unscheduledReason: null },
            { id: 'step-2', label: 'Pack bag', kind: 'checkable', time: null, unscheduledReason: 'Needs "Leave Home" to be configured first' },
          ],
        }),
      ],
      loading: false,
      error: null,
    });
    render(<ActivityWorkflowWidget />);
    expect(screen.getByText('Get dressed')).not.toBeNull();
    expect(screen.getByText('Pack bag')).not.toBeNull();
    expect(screen.getByText('Needs "Leave Home" to be configured first')).not.toBeNull();
  });
});

describe('ActivityWorkflowWidget — phase display', () => {
  it('shows an Overdue badge and the missed milestone for an overdue activity', () => {
    mockUseActivityWorkflow.mockReturnValue({
      items: [activity({
        status: {
          phase: 'overdue',
          nextMilestone: null,
          overdueMilestone: { id: '__arrival', kind: 'milestone', label: 'Arrive', time: new Date('2026-10-08T17:30:00.000Z') },
        },
      })],
      loading: false,
      error: null,
    });
    render(<ActivityWorkflowWidget />);
    expect(screen.getByText('Overdue')).not.toBeNull();
    expect(screen.getByText(/Missed arrive/i)).not.toBeNull();
  });

  it('shows the next milestone and an Upcoming badge for an upcoming activity', () => {
    mockUseActivityWorkflow.mockReturnValue({ items: [activity()], loading: false, error: null });
    render(<ActivityWorkflowWidget />);
    expect(screen.getByText('Upcoming')).not.toBeNull();
    // "Leave home" appears twice: the countdown line ("Leave home in ...")
    // and the milestone-time row label — both are expected.
    expect(screen.getAllByText(/Leave home/).length).toBe(2);
  });

  it('shows an In progress badge and the event\'s actual end time, with no pre-event countdown target', () => {
    mockUseActivityWorkflow.mockReturnValue({
      items: [activity({ status: { phase: 'in_progress', nextMilestone: null, overdueMilestone: null } })],
      loading: false,
      error: null,
    });
    render(<ActivityWorkflowWidget />);
    expect(screen.getByText('In progress')).not.toBeNull(); // the badge — exactly one now, countdown line says "Ends ..." instead
    expect(screen.getByText(/^Ends /)).not.toBeNull();
  });
});
