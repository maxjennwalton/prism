import { computeActivityStatus, compareActivityUrgency, sortByUrgency, buildScheduledMilestones, type RankableActivity } from '../activityWorkflowPriority';
import type { PreviewRow } from '../activityTimelinePreview';

function at(hh: number, mm: number): Date {
  return new Date(2026, 9, 7, hh, mm, 0, 0);
}

// Mirrors computeTimelinePreview's own fixed ids for the three system
// milestones — computeActivityStatus distinguishes Event Starts from
// everything else by this exact id, so the fixtures must match it.
const SYSTEM_MILESTONE_IDS: Record<string, string> = {
  'Leave home': '__leave_home',
  Arrive: '__arrival',
  'Event starts': '__event_start',
};

function milestone(label: string, hh: number, mm: number, kind: PreviewRow['kind'] = 'milestone'): PreviewRow {
  return { id: SYSTEM_MILESTONE_IDS[label] ?? `__${label}`, kind, label, time: at(hh, mm) };
}

describe('computeActivityStatus — phase + next/overdue milestones', () => {
  const eventStart = at(18, 0);
  const eventEnd = at(19, 0);

  it('upcoming: surfaces the soonest future milestone when at least one has not passed yet', () => {
    const milestones = [milestone('Leave home', 17, 10), milestone('Arrive', 17, 30), milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(at(17, 0), eventStart, eventEnd, milestones);
    expect(status.phase).toBe('upcoming');
    expect(status.nextMilestone?.label).toBe('Leave home');
    expect(status.overdueMilestones).toEqual([]);
  });

  it('a milestone at exactly `now` counts as already passed, not upcoming — here that tips the only pre-event milestone into overdue', () => {
    const milestones = [milestone('Leave home', 17, 10), milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(at(17, 10), eventStart, eventEnd, milestones);
    expect(status.phase).toBe('overdue');
    expect(status.overdueMilestones.map((m) => m.label)).toEqual(['Leave home']);
  });

  it('overdue: when every scheduled pre-event milestone has passed, lists all of them (oldest first) and falls back to Event Starts as the next milestone', () => {
    const milestones = [milestone('Leave home', 17, 10), milestone('Arrive', 17, 30), milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(at(17, 45), eventStart, eventEnd, milestones);
    expect(status.phase).toBe('overdue');
    expect(status.overdueMilestones.map((m) => m.label)).toEqual(['Leave home', 'Arrive']);
    expect(status.nextMilestone?.label).toBe('Event starts');
  });

  it('with only Event Starts scheduled (no arrival/travel configured), reports upcoming — there is no pre-event deadline to miss', () => {
    const milestones = [milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(at(17, 59), eventStart, eventEnd, milestones);
    expect(status.phase).toBe('upcoming');
    expect(status.nextMilestone?.label).toBe('Event starts');
  });

  it('overdue applies the instant ANY pre-event milestone passes, even while a later one is still reachable — and still surfaces that later one as next', () => {
    // Leave Home has passed, but Arrive has not — this must read as
    // "overdue: missed Leave Home" AND "next: Arrive", not silently as
    // plain 'upcoming' the way an earlier version of this logic did.
    const milestones = [milestone('Leave home', 17, 10), milestone('Arrive', 17, 30), milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(at(17, 20), eventStart, eventEnd, milestones);
    expect(status.phase).toBe('overdue');
    expect(status.overdueMilestones.map((m) => m.label)).toEqual(['Leave home']);
    expect(status.nextMilestone?.label).toBe('Arrive');
  });

  it('overdue only ever lists PRE-event milestones — Event Starts itself can never appear in overdueMilestones while the event has not started', () => {
    const milestones = [milestone('Leave home', 17, 10), milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(at(17, 50), eventStart, eventEnd, milestones);
    expect(status.overdueMilestones.every((m) => m.label !== 'Event starts')).toBe(true);
  });

  it('in_progress: once the event has started, no pre-event milestone is surfaced as actionable or overdue, even if several were missed', () => {
    const milestones = [milestone('Leave home', 17, 10), milestone('Arrive', 17, 30), milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(at(18, 30), eventStart, eventEnd, milestones);
    expect(status.phase).toBe('in_progress');
    expect(status.nextMilestone).toBeNull();
    expect(status.overdueMilestones).toEqual([]);
  });

  it('in_progress: the exact start instant counts as started, not still upcoming/overdue', () => {
    const milestones = [milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(eventStart, eventStart, eventEnd, milestones);
    expect(status.phase).toBe('in_progress');
  });

  it('completed: once the real event end time has passed, reports completed — never a fabricated window', () => {
    const milestones = [milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(at(19, 30), eventStart, eventEnd, milestones);
    expect(status.phase).toBe('completed');
  });

  it('completed: the exact end instant counts as completed, not still in_progress', () => {
    const milestones = [milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(eventEnd, eventStart, eventEnd, milestones);
    expect(status.phase).toBe('completed');
  });

  it('includes prep steps (checkable/informational) as candidate milestones, not just the three system ones', () => {
    const milestones = [
      milestone('Leave home', 17, 10),
      milestone('Get dressed', 16, 45, 'checkable'),
      milestone('Arrive', 17, 30),
      milestone('Event starts', 18, 0),
    ];
    const status = computeActivityStatus(at(16, 40), eventStart, eventEnd, milestones);
    expect(status.nextMilestone?.label).toBe('Get dressed');
  });

  it('a missed prep step is reported overdue just like a missed system milestone', () => {
    const milestones = [
      milestone('Get dressed', 16, 45, 'checkable'),
      milestone('Leave home', 17, 10),
      milestone('Arrive', 17, 30),
      milestone('Event starts', 18, 0),
    ];
    const status = computeActivityStatus(at(16, 50), eventStart, eventEnd, milestones);
    expect(status.phase).toBe('overdue');
    expect(status.overdueMilestones.map((m) => m.label)).toEqual(['Get dressed']);
    expect(status.nextMilestone?.label).toBe('Leave home');
  });
});

describe('compareActivityUrgency / sortByUrgency — deterministic cross-activity ranking', () => {
  function overdue(eventStart: Date, eventEnd: Date, nextAt: Date | null = null): RankableActivity {
    return {
      status: {
        phase: 'overdue',
        nextMilestone: nextAt ? { id: '__x', kind: 'milestone', label: 'x', time: nextAt } : null,
        overdueMilestones: [milestone('Leave home', 0, 0)],
      },
      eventStart,
      eventEnd,
    };
  }
  function upcoming(eventStart: Date, eventEnd: Date, nextAt: Date): RankableActivity {
    return { status: { phase: 'upcoming', nextMilestone: { id: '__x', kind: 'milestone', label: 'x', time: nextAt }, overdueMilestones: [] }, eventStart, eventEnd };
  }
  function inProgress(eventStart: Date, eventEnd: Date): RankableActivity {
    return { status: { phase: 'in_progress', nextMilestone: null, overdueMilestones: [] }, eventStart, eventEnd };
  }
  function completed(eventStart: Date, eventEnd: Date): RankableActivity {
    return { status: { phase: 'completed', nextMilestone: null, overdueMilestones: [] }, eventStart, eventEnd };
  }

  it('every overdue activity outranks every upcoming, in_progress, and completed one, regardless of how close its own next deadline is', () => {
    const items = [
      upcoming(at(19, 0), at(20, 0), at(17, 5)), // very soon, but not overdue
      overdue(at(18, 0), at(19, 0), at(19, 0)), // next deadline far off, but already overdue
      inProgress(at(16, 0), at(17, 0)),
      completed(at(14, 0), at(15, 0)),
    ];
    const sorted = sortByUrgency(items);
    expect(sorted.map((i) => i.status.phase)).toEqual(['overdue', 'upcoming', 'in_progress', 'completed']);
  });

  it('within overdue, ranks by the soonest still-reachable deadline, same as upcoming', () => {
    const soonerNext = overdue(at(19, 0), at(20, 0), at(17, 5));
    const laterNext = overdue(at(18, 0), at(19, 0), at(17, 50));
    const sorted = sortByUrgency([laterNext, soonerNext]);
    expect(sorted[0]).toBe(soonerNext);
  });

  it('within overdue, an activity with nothing left (nextMilestone falls back to event start) ranks by that event start', () => {
    const items = [overdue(at(19, 0), at(20, 0), at(19, 0)), overdue(at(18, 0), at(19, 0), at(18, 0))];
    const sorted = sortByUrgency(items);
    expect(sorted.map((i) => i.eventStart.getHours())).toEqual([18, 19]);
  });

  it('within upcoming, ranks by soonest next-milestone time, NOT by event start', () => {
    // Activity A starts later but its next deadline (leave-home) is sooner
    // than Activity B's, which starts earlier but has no near-term deadline.
    const activityA = upcoming(at(19, 0), at(20, 0), at(17, 5));
    const activityB = upcoming(at(18, 0), at(19, 0), at(17, 50));
    const sorted = sortByUrgency([activityB, activityA]);
    expect(sorted[0]).toBe(activityA);
  });

  it('within in_progress, ranks by soonest end time (wrapping up soonest first)', () => {
    const items = [inProgress(at(16, 0), at(18, 0)), inProgress(at(16, 0), at(17, 0))];
    const sorted = sortByUrgency(items);
    expect(sorted.map((i) => i.eventEnd.getHours())).toEqual([17, 18]);
  });

  it('never mutates the input array', () => {
    const items = [upcoming(at(19, 0), at(20, 0), at(18, 30)), overdue(at(18, 0), at(19, 0), at(18, 30))];
    const original = [...items];
    sortByUrgency(items);
    expect(items).toEqual(original);
  });

  it('compareActivityUrgency is usable directly with Array.prototype.sort for the same result as sortByUrgency', () => {
    const items = [upcoming(at(19, 0), at(20, 0), at(18, 30)), overdue(at(18, 0), at(19, 0), at(18, 30)), completed(at(14, 0), at(15, 0))];
    const a = sortByUrgency(items);
    const b = [...items].sort(compareActivityUrgency);
    expect(a).toEqual(b);
  });
});

describe('buildScheduledMilestones — reconstructs milestones from the flat API/hook shape', () => {
  it('always includes Event Starts, even with nothing else configured', () => {
    const rows = buildScheduledMilestones({ eventStart: at(18, 0), arrivalTime: null, leaveHomeTime: null, prepSteps: [] });
    expect(rows).toEqual([{ id: '__event_start', kind: 'milestone', label: 'Event starts', time: at(18, 0) }]);
  });

  it('includes Arrive and Leave Home only when they have a real time', () => {
    const rows = buildScheduledMilestones({
      eventStart: at(18, 0),
      arrivalTime: at(17, 30),
      leaveHomeTime: at(17, 10),
      prepSteps: [],
    });
    expect(rows.map((r) => r.id)).toEqual(['__event_start', '__arrival', '__leave_home']);
  });

  it('includes only scheduled prep steps, omitting ones with a null time', () => {
    const rows = buildScheduledMilestones({
      eventStart: at(18, 0),
      arrivalTime: null,
      leaveHomeTime: null,
      prepSteps: [
        { id: 'step-1', label: 'Get dressed', kind: 'checkable', time: at(16, 45) },
        { id: 'step-2', label: 'Pack bag', kind: 'checkable', time: null },
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(['__event_start', 'step-1']);
  });

  it('round-trips correctly into computeActivityStatus (the actual use case)', () => {
    const milestones = buildScheduledMilestones({
      eventStart: at(18, 0),
      arrivalTime: at(17, 30),
      leaveHomeTime: at(17, 10),
      prepSteps: [{ id: 'step-1', label: 'Get dressed', kind: 'checkable', time: at(16, 45) }],
    });
    // Get Dressed (16:45) and Leave Home (17:10) have both already passed
    // by 17:20, so this is 'overdue' — with Arrive (17:30) still correctly
    // surfaced as the next milestone.
    const status = computeActivityStatus(at(17, 20), at(18, 0), at(19, 0), milestones);
    expect(status.phase).toBe('overdue');
    expect(status.overdueMilestones.map((m) => m.label)).toEqual(['Get dressed', 'Leave home']);
    expect(status.nextMilestone?.label).toBe('Arrive');
  });
});
