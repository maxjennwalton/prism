/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { useActivityWorkflow } from '../useActivityWorkflow';

function rawItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    linkId: 'link-1',
    eventId: 'event-1',
    eventTitle: 'Hockey Practice',
    eventStart: '2026-10-08T18:00:00.000Z',
    eventEnd: '2026-10-08T19:00:00.000Z',
    memberId: 'member-1',
    memberName: 'Beckham',
    memberColor: '#f00',
    profileId: 'profile-1',
    profileName: 'Hockey Practice',
    profileColor: '#00f',
    profileArchived: false,
    location: 'Community Rink',
    arrivalTime: '2026-10-08T17:30:00.000Z',
    leaveHomeTime: '2026-10-08T17:10:00.000Z',
    travelSource: 'profile_fallback',
    prepSteps: [],
    ...overrides,
  };
}

function mockFetchOnce(items: unknown[]) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ items }) });
}

beforeEach(() => {
  global.fetch = jest.fn();
});

describe('useActivityWorkflow — fetch + parse', () => {
  it('fetches on mount and parses ISO strings into Dates', async () => {
    mockFetchOnce([rawItem()]);
    const { result } = renderHook(() => useActivityWorkflow());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(global.fetch).toHaveBeenCalledWith('/api/activity-matching/workflow');
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]!.eventStart).toEqual(new Date('2026-10-08T18:00:00.000Z'));
    expect(result.current.items[0]!.arrivalTime).toEqual(new Date('2026-10-08T17:30:00.000Z'));
    expect(result.current.items[0]!.travelSource).toBe('profile_fallback');
  });

  it('exposes `now` so callers never need to call Date.now() themselves during render', async () => {
    mockFetchOnce([rawItem()]);
    const { result } = renderHook(() => useActivityWorkflow());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.now).toBeInstanceOf(Date);
  });

  it('surfaces an error and empties items when the fetch fails, without throwing', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'boom' }) });
    const { result } = renderHook(() => useActivityWorkflow());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
    expect(result.current.items).toEqual([]);
  });

  it('defensively drops malformed entries instead of crashing', async () => {
    mockFetchOnce([rawItem(), { not: 'a real item' }, null, 42]);
    const { result } = renderHook(() => useActivityWorkflow());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(1);
  });

  it('refresh() re-fetches on demand', async () => {
    mockFetchOnce([rawItem()]);
    const { result } = renderHook(() => useActivityWorkflow());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockFetchOnce([rawItem(), rawItem({ linkId: 'link-2', eventId: 'event-2' })]);
    await act(async () => {
      await result.current.refresh();
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.current.items).toHaveLength(2);
  });
});

describe('useActivityWorkflow — status is computed, and sorted by urgency', () => {
  it('computes phase/nextMilestone for each item using the current time', async () => {
    mockFetchOnce([rawItem()]); // arrival 17:30, leave-home 17:10, event 18:00
    jest.useFakeTimers().setSystemTime(new Date('2026-10-08T17:00:00.000Z'));

    const { result } = renderHook(() => useActivityWorkflow());
    await act(async () => { await Promise.resolve(); });

    expect(result.current.loading).toBe(false);
    expect(result.current.items[0]!.status.phase).toBe('upcoming');
    expect(result.current.items[0]!.status.nextMilestone?.label).toBe('Leave home');

    jest.useRealTimers();
  });

  it('sorts overdue activities ahead of merely-upcoming ones', async () => {
    mockFetchOnce([
      rawItem({ linkId: 'upcoming', eventStart: '2026-10-08T20:00:00.000Z', eventEnd: '2026-10-08T21:00:00.000Z', arrivalTime: '2026-10-08T19:30:00.000Z', leaveHomeTime: '2026-10-08T19:10:00.000Z' }),
      rawItem({ linkId: 'overdue', eventStart: '2026-10-08T18:00:00.000Z', eventEnd: '2026-10-08T19:00:00.000Z', arrivalTime: '2026-10-08T17:30:00.000Z', leaveHomeTime: '2026-10-08T17:10:00.000Z' }),
    ]);
    jest.useFakeTimers().setSystemTime(new Date('2026-10-08T17:45:00.000Z')); // overdue one's Arrive (17:30) has passed

    const { result } = renderHook(() => useActivityWorkflow());
    await act(async () => { await Promise.resolve(); });

    expect(result.current.items.map((i) => i.linkId)).toEqual(['overdue', 'upcoming']);

    jest.useRealTimers();
  });
});

describe('useActivityWorkflow — local countdown tick vs. network refresh', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('recomputes status locally on the countdown tick WITHOUT an additional fetch call', async () => {
    jest.setSystemTime(new Date('2026-10-08T17:00:00.000Z'));
    mockFetchOnce([rawItem()]); // leave-home at 17:10

    const { result } = renderHook(() => useActivityWorkflow());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.items[0]!.status.phase).toBe('upcoming');

    const fetchCallsBefore = (global.fetch as jest.Mock).mock.calls.length;

    // Advance past the leave-home deadline, but well short of the data-poll interval.
    await act(async () => {
      jest.advanceTimersByTime(15_000); // one countdown tick (15s)
      await Promise.resolve();
    });

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(fetchCallsBefore); // no new network call
  });

  it('re-fetches data on the coarse polling interval', async () => {
    jest.setSystemTime(new Date('2026-10-08T17:00:00.000Z'));
    mockFetchOnce([rawItem()]);
    mockFetchOnce([rawItem()]);

    renderHook(() => useActivityWorkflow());
    await act(async () => { await Promise.resolve(); });

    const fetchCallsBefore = (global.fetch as jest.Mock).mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(3 * 60 * 1000); // the data-poll interval
      await Promise.resolve();
    });

    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(fetchCallsBefore);
  });
});
