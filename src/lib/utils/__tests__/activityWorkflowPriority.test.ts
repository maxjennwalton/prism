import {
  computeActivityStatus,
  compareActivityUrgency,
  sortByUrgency,
  buildScheduledMilestones,
  type RankableActivity,
} from '../activityWorkflowPriority';
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

describe('computeActivityStatus — phase + next/overdue milestone', () => {
  const eventStart = at(18, 0);
  const eventEnd = at(19, 0);

  it('upcoming: surfaces the soonest future milestone when at least one has not passed yet', () => {
    const milestones = [milestone('Leave home', 17, 10), milestone('Arrive', 17, 30), milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(at(17, 0), eventStart, eventEnd, milestones);
    expect(status.phase).toBe('upcoming');
    expect(status.nextMilestone?.label).toBe('Leave home');
    expect(status.overdueMilestone).toBeNull();
  });

  it('upcoming: picks the soonest remaining milestone once an earlier one has already passed', () => {
    const milestones = [milestone('Leave home', 17, 10), milestone('Arrive', 17, 30), milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(at(17, 20), eventStart, eventEnd, milestones);
    expect(status.phase).toBe('upcoming');
    expect(status.nextMilestone?.label).toBe('Arrive');
  });

  it('a milestone at exactly `now` counts as already passed, not upcoming — here that tips the only pre-event milestone into overdue', () => {
    const milestones = [milestone('Leave home', 17, 10), milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(at(17, 10), eventStart, eventEnd, milestones);
    expect(status.phase).toBe('overdue');
    expect(status.overdueMilestone?.label).toBe('Leave home');
  });

  it('overdue: when every scheduled milestone has passed but the event has not started, surfaces the most recently missed one', () => {
    const milestones = [milestone('Leave home', 17, 10), milestone('Arrive', 17, 30), milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(at(17, 45), eventStart, eventEnd, milestones);
    expect(status.phase).toBe('overdue');
    expect(status.overdueMilestone?.label).toBe('Arrive');
    expect(status.nextMilestone).toBeNull();
  });

  it('with only Event Starts scheduled (no arrival/travel configured), reports upcoming — there is no pre-event deadline to miss', () => {
    const milestones = [milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(at(17, 59), eventStart, eventEnd, milestones);
    expect(status.phase).toBe('upcoming');
    expect(status.nextMilestone?.label).toBe('Event starts');
  });

  it('overdue only applies to PRE-event milestones — Event Starts itself can never be "overdue" while the event has not started', () => {
    // Leave Home has passed, but Arrive (a later pre-event milestone) has
    // not — the next actionable step is still reachable, so this is
    // 'upcoming: Arrive', not 'overdue'.
    const milestones = [milestone('Leave home', 17, 10), milestone('Arrive', 17, 30), milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(at(17, 20), eventStart, eventEnd, milestones);
    expect(status.phase).toBe('upcoming');
    expect(status.nextMilestone?.label).toBe('Arrive');
  });

  it('in_progress: once the event has started, no pre-event milestone is surfaced as actionable, even if one was missed', () => {
    const milestones = [milestone('Leave home', 17, 10), milestone('Arrive', 17, 30), milestone('Event starts', 18, 0)];
    const status = computeActivityStatus(at(18, 30), eventStart, eventEnd, milestones);
    expect(status.phase).toBe('in_progress');
    expect(status.nextMilestone).toBeNull();
    expect(status.overdueMilestone).toBeNull();
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
});

describe('compareActivityUrgency / sortByUrgency — deterministic cross-activity ranking', () => {
  function overdue(eventStart: Date, eventEnd: Date, overdueLabel = 'Leave home'): RankableActivity {
    return { status: { phase: 'overdue', nextMilestone: null, overdueMilestone: milestone(overdueLabel, 0, 0) }, eventStart, eventEnd };
  }
  function upcoming(eventStart: Date, eventEnd: Date, nextAt: Date): RankableActivity {
    return { status: { phase: 'upcoming', nextMilestone: { id: '__x', kind: 'milestone', label: 'x', time: nextAt }, overdueMilestone: null }, eventStart, eventEnd };
  }
  function inProgress(eventStart: Date, eventEnd: Date): RankableActivity {
    return { status: { phase: 'in_progress', nextMilestone: null, overdueMilestone: null }, eventStart, eventEnd };
  }
  function completed(eventStart: Date, eventEnd: Date): RankableActivity {
    return { status: { phase: 'completed', nextMilestone: null, overdueMilestone: null }, eventStart, eventEnd };
  }

  it('overdue activities always outrank upcoming, in_progress, and completed ones', () => {
    const items = [
      upcoming(at(19, 0), at(20, 0), at(18, 30)),
      overdue(at(18, 0), at(19, 0)),
      inProgress(at(16, 0), at(17, 0)),
      completed(at(14, 0), at(15, 0)),
    ];
    const sorted = sortByUrgency(items);
    expect(sorted.map((i) => i.status.phase)).toEqual(['overdue', 'upcoming', 'in_progress', 'completed']);
  });

  it('within overdue, ranks by soonest event start (least slack left first)', () => {
    const items = [overdue(at(19, 0), at(20, 0)), overdue(at(18, 0), at(19, 0))];
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
    const items = [upcoming(at(19, 0), at(20, 0), at(18, 30)), overdue(at(18, 0), at(19, 0))];
    const original = [...items];
    sortByUrgency(items);
    expect(items).toEqual(original);
  });

  it('compareActivityUrgency is usable directly with Array.prototype.sort for the same result as sortByUrgency', () => {
    const items = [upcoming(at(19, 0), at(20, 0), at(18, 30)), overdue(at(18, 0), at(19, 0)), completed(at(14, 0), at(15, 0))];
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
    const status = computeActivityStatus(at(17, 20), at(18, 0), at(19, 0), milestones);
    expect(status.phase).toBe('upcoming');
    expect(status.nextMilestone?.label).toBe('Arrive');
  });
});
