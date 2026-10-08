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
    eventTitle: 'U9MD - Hockey Practice vs. the Lightning Travel Team B',
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
    status: {
      phase: 'upcoming',
      nextMilestone: { id: '__leave_home', kind: 'milestone', label: 'Leave home', time: new Date('2026-10-08T17:10:00.000Z') },
      overdueMilestones: [],
    },
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
      items: [activity({ status: { phase: 'completed', nextMilestone: null, overdueMilestones: [] } })],
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
        activity({ linkId: 'less-urgent', eventTitle: 'Soccer Game', eventId: 'event-2', profileName: 'Soccer' }),
      ],
      loading: false,
      error: null,
    });
    render(<ActivityWorkflowWidget />);

    expect(screen.getByText('U9MD - Hockey Practice vs. the Lightning Travel Team B')).not.toBeNull();
    expect(screen.getByText(/Soccer/)).not.toBeNull();
    expect(screen.queryByTestId('widget-empty')).toBeNull();
  });

  it('shows the family member and profile name on the primary card', () => {
    mockUseActivityWorkflow.mockReturnValue({ items: [activity()], loading: false, error: null });
    render(<ActivityWorkflowWidget />);
    expect(screen.getByText('Beckham')).not.toBeNull();
    expect(screen.getByText(/· Hockey Practice/)).not.toBeNull();
  });
});

describe('ActivityWorkflowWidget — secondary (compact) card labeling', () => {
  it('uses the matched Activity Profile name as the primary label, not the raw calendar title', () => {
    mockUseActivityWorkflow.mockReturnValue({
      items: [
        activity({ linkId: 'primary-slot' }), // occupies the primary card
        activity({
          linkId: 'secondary',
          eventId: 'event-2',
          eventTitle: 'U9MD Away Game @ Riverside Community Centre Rink 3 (bring extra water)',
          profileName: 'Hockey Game',
          memberName: 'Theo',
        }),
      ],
      loading: false,
      error: null,
    });
    render(<ActivityWorkflowWidget />);

    // The long raw title must not be rendered as the visible primary label...
    expect(screen.queryByText('U9MD Away Game @ Riverside Community Centre Rink 3 (bring extra water)')).toBeNull();
    // ...the profile name (+ member) is shown instead.
    expect(screen.getByText(/Hockey Game/)).not.toBeNull();
    expect(screen.getByText(/Theo/)).not.toBeNull();
  });

  it('still carries the original event title as a tooltip (native title attribute), not dropped entirely', () => {
    mockUseActivityWorkflow.mockReturnValue({
      items: [
        activity({ linkId: 'primary-slot' }),
        activity({ linkId: 'secondary', eventId: 'event-2', eventTitle: 'The Full Raw Calendar Title', profileName: 'Hockey Game' }),
      ],
      loading: false,
      error: null,
    });
    render(<ActivityWorkflowWidget />);
    const row = screen.getByTitle('The Full Raw Calendar Title');
    expect(row).not.toBeNull();
  });

  it('falls back to the raw event title when no profile is matched', () => {
    mockUseActivityWorkflow.mockReturnValue({
      items: [
        activity({ linkId: 'primary-slot' }),
        activity({ linkId: 'secondary', eventId: 'event-2', eventTitle: 'Unmatched Looking Event', profileName: null }),
      ],
      loading: false,
      error: null,
    });
    render(<ActivityWorkflowWidget />);
    expect(screen.getByText(/Unmatched Looking Event/)).not.toBeNull();
  });
});

describe('ActivityWorkflowWidget — responsive rendering (gridW)', () => {
  it('renders without throwing at a narrow width and still shows the core fields', () => {
    mockUseActivityWorkflow.mockReturnValue({ items: [activity()], loading: false, error: null });
    render(<ActivityWorkflowWidget gridW={8} />);
    expect(screen.getByText('Community Rink')).not.toBeNull();
    expect(screen.getAllByText(/Leave home/).length).toBeGreaterThan(0);
  });

  it('renders without throwing at a wide width and still shows the core fields', () => {
    mockUseActivityWorkflow.mockReturnValue({ items: [activity()], loading: false, error: null });
    render(<ActivityWorkflowWidget gridW={32} />);
    expect(screen.getByText('Community Rink')).not.toBeNull();
    expect(screen.getAllByText(/Leave home/).length).toBeGreaterThan(0);
  });

  it('omits location from the compact row only in narrow mode, not at default/wide width', () => {
    mockUseActivityWorkflow.mockReturnValue({
      items: [
        activity({ linkId: 'primary-slot' }),
        activity({ linkId: 'secondary', eventId: 'event-2', location: 'Riverside Rink' }),
      ],
      loading: false,
      error: null,
    });
    const { rerender } = render(<ActivityWorkflowWidget gridW={8} />);
    expect(screen.queryByText(/Riverside Rink/)).toBeNull();

    rerender(<ActivityWorkflowWidget gridW={24} />);
    expect(screen.getByText(/Riverside Rink/)).not.toBeNull();
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
    expect(screen.getByText(/Get dressed/)).not.toBeNull();
    expect(screen.getByText(/Pack bag/)).not.toBeNull();
    expect(screen.getByText('Needs "Leave Home" to be configured first')).not.toBeNull();
  });

  it('marks the next prep step explicitly as "(next)" in text, not color alone', () => {
    mockUseActivityWorkflow.mockReturnValue({
      items: [
        activity({
          status: {
            phase: 'upcoming',
            nextMilestone: { id: 'step-1', kind: 'checkable', label: 'Get dressed', time: new Date('2026-10-08T16:45:00.000Z') },
            overdueMilestones: [],
          },
          prepSteps: [
            { id: 'step-1', label: 'Get dressed', kind: 'checkable', time: new Date('2026-10-08T16:45:00.000Z'), unscheduledReason: null },
          ],
        }),
      ],
      loading: false,
      error: null,
    });
    render(<ActivityWorkflowWidget />);
    expect(screen.getByText(/Get dressed \(next\)/)).not.toBeNull();
  });
});

describe('ActivityWorkflowWidget — phase display', () => {
  it('shows an Overdue badge, the missed milestone, AND the still-reachable next one when only an earlier deadline was missed', () => {
    mockUseActivityWorkflow.mockReturnValue({
      items: [activity({
        status: {
          phase: 'overdue',
          nextMilestone: { id: '__arrival', kind: 'milestone', label: 'Arrive', time: new Date('2026-10-08T17:30:00.000Z') },
          overdueMilestones: [{ id: '__leave_home', kind: 'milestone', label: 'Leave home', time: new Date('2026-10-08T17:10:00.000Z') }],
        },
      })],
      loading: false,
      error: null,
    });
    render(<ActivityWorkflowWidget />);
    expect(screen.getByText('Overdue')).not.toBeNull();
    expect(screen.getByText(/Missed leave home/i)).not.toBeNull();
    // The still-reachable next deadline remains the prominent hero text —
    // "Arrive" legitimately appears twice (hero + milestone strip label).
    expect(screen.getAllByText(/Arrive/).length).toBeGreaterThanOrEqual(2);
  });

  it('lists every missed milestone, not just the most recent, when more than one has passed', () => {
    mockUseActivityWorkflow.mockReturnValue({
      items: [activity({
        status: {
          phase: 'overdue',
          nextMilestone: { id: '__event_start', kind: 'milestone', label: 'Event starts', time: new Date('2026-10-08T18:00:00.000Z') },
          overdueMilestones: [
            { id: '__leave_home', kind: 'milestone', label: 'Leave home', time: new Date('2026-10-08T17:10:00.000Z') },
            { id: '__arrival', kind: 'milestone', label: 'Arrive', time: new Date('2026-10-08T17:30:00.000Z') },
          ],
        },
      })],
      loading: false,
      error: null,
    });
    render(<ActivityWorkflowWidget />);
    const missedText = screen.getByText(/Missed/i).textContent ?? '';
    expect(missedText).toMatch(/leave home/i);
    expect(missedText).toMatch(/arrive/i);
  });

  it('shows the next milestone and an Upcoming badge for an upcoming activity', () => {
    mockUseActivityWorkflow.mockReturnValue({ items: [activity()], loading: false, error: null });
    render(<ActivityWorkflowWidget />);
    expect(screen.getByText('Upcoming')).not.toBeNull();
    // "Leave home" appears at least twice: the hero ("Leave home in ...")
    // and the milestone-strip label — both are expected.
    expect(screen.getAllByText(/Leave home/).length).toBeGreaterThanOrEqual(2);
  });

  it('shows an In progress badge and the event\'s actual end time, with no pre-event countdown target', () => {
    mockUseActivityWorkflow.mockReturnValue({
      items: [activity({ status: { phase: 'in_progress', nextMilestone: null, overdueMilestones: [] } })],
      loading: false,
      error: null,
    });
    render(<ActivityWorkflowWidget />);
    // "In progress" legitimately appears twice: the phase badge and the
    // hero's kicker label above the actual end time.
    expect(screen.getAllByText('In progress').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/^Ends /)).not.toBeNull();
  });
});
