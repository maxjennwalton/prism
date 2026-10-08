/**
 * Pure priority/status logic for the Activity Workflow widget (Sports &
 * Activity Assistant, Phase 4A). Decides, for one matched occurrence, which
 * phase it's in right now and which milestone (if any) is "next actionable"
 * — then ranks several occurrences against each other by urgency.
 *
 * Every scheduled milestone computeTimelinePreview can produce (Leave Home,
 * Arrive, Event Starts, and every prep step) is always at-or-before the
 * event's own start time: prep-step offsets and the arrival/travel buffers
 * are all validated >= 0 minutes, so a milestone can never fall after the
 * anchor it counts back from, and every anchor is itself at-or-before Event
 * Start. That single fact is what makes "overdue vs. upcoming" collapse to
 * one rule below rather than needing per-milestone-kind handling.
 */
import type { PreviewRow } from './activityTimelinePreview';

export type ActivityPhase = 'overdue' | 'upcoming' | 'in_progress' | 'completed';

export interface ActivityWorkflowStatus {
  phase: ActivityPhase;
  /**
   * The soonest not-yet-passed milestone (or Event Starts itself, once
   * nothing else remains ahead) — present whenever anything is still
   * reachable, INCLUDING while phase is 'overdue': missing one deadline
   * (e.g. Leave Home) never hides a later one that's still reachable (e.g.
   * Arrive). Null only for 'in_progress'/'completed', where nothing
   * pre-event is actionable anymore.
   */
  nextMilestone: PreviewRow | null;
  /**
   * Every pre-event milestone whose time has already passed, oldest missed
   * first — never just the latest one, so a parent who missed Leave Home
   * AND Arrive sees both, not only the most recent. Empty unless phase is
   * 'overdue'.
   */
  overdueMilestones: PreviewRow[];
}

/** computeTimelinePreview's fixed id for the Event Starts milestone row. */
const EVENT_START_ROW_ID = '__event_start';

function byTimeAscending(a: PreviewRow, b: PreviewRow): number {
  return a.time.getTime() - b.time.getTime();
}

/**
 * Computes the current phase for one occurrence.
 *
 * - `now >= eventEnd` -> 'completed' (the real end time from the event row —
 *   never a fabricated one; events always carry a real endTime).
 * - `now >= eventStart` (and before eventEnd) -> 'in_progress'. Pre-event
 *   deadlines stop being actionable the instant the event starts, per the
 *   approved product decision — no milestone is surfaced in this phase.
 * - Otherwise (event hasn't started): Event Starts itself is always still in
 *   the future at this point (that's what "hasn't started" means), so it's
 *   excluded from the PRE-event milestone set below (Leave Home, Arrive,
 *   prep steps) — those are the ones a parent can actually still miss, and
 *   missing ANY of them (not just all of them) is reported immediately:
 *     - At least one pre-event milestone has already passed -> 'overdue',
 *       listing every one that's passed (oldest first) in overdueMilestones,
 *       while nextMilestone still points at the soonest one that HASN'T
 *       passed yet (or Event Starts, if none remain) — overdue and "still
 *       something you can act on" are not mutually exclusive.
 *     - None have passed, but at least one is still ahead -> 'upcoming',
 *       surfacing the soonest.
 *     - No pre-event milestone is configured at all -> 'upcoming', with
 *       Event Starts itself as the next milestone (e.g. "Starts in 12 min").
 *
 * A milestone whose time exactly equals `now` counts as already passed, not
 * upcoming — "due this instant" reads as something to act on now, not later.
 */
export function computeActivityStatus(
  now: Date,
  eventStart: Date,
  eventEnd: Date,
  scheduledMilestones: PreviewRow[],
): ActivityWorkflowStatus {
  const nowMs = now.getTime();

  if (nowMs >= eventEnd.getTime()) {
    return { phase: 'completed', nextMilestone: null, overdueMilestones: [] };
  }
  if (nowMs >= eventStart.getTime()) {
    return { phase: 'in_progress', nextMilestone: null, overdueMilestones: [] };
  }

  const eventStartRow = scheduledMilestones.find((m) => m.id === EVENT_START_ROW_ID) ?? null;
  const preEventMilestones = scheduledMilestones.filter((m) => m.id !== EVENT_START_ROW_ID);

  const future: PreviewRow[] = [];
  const past: PreviewRow[] = [];
  for (const milestone of preEventMilestones) {
    (milestone.time.getTime() > nowMs ? future : past).push(milestone);
  }
  future.sort(byTimeAscending);
  past.sort(byTimeAscending);

  const nextMilestone = future[0] ?? eventStartRow;

  if (past.length > 0) {
    return { phase: 'overdue', nextMilestone, overdueMilestones: past };
  }
  return { phase: 'upcoming', nextMilestone, overdueMilestones: [] };
}

const PHASE_RANK: Record<ActivityPhase, number> = {
  overdue: 0,
  upcoming: 1,
  in_progress: 2,
  completed: 3,
};

export interface RankableActivity {
  status: ActivityWorkflowStatus;
  eventStart: Date;
  eventEnd: Date;
}

/**
 * Deterministic urgency ordering, most urgent first — the "next actionable
 * preparation or departure milestone" rule, generalized across several
 * occurrences at once:
 *
 *  - every overdue activity outranks every non-overdue one, full stop,
 *    however close or far its own next deadline is — missing a deadline
 *    always demands attention before a still-on-schedule one.
 *  - WITHIN overdue, and within upcoming, the tie-break is identical: rank
 *    by the soonest still-reachable deadline (`nextMilestone`, falling back
 *    to event start when nothing remains) — never by event start directly,
 *    since a later-starting activity can easily have the nearer deadline
 *    (e.g. its leave-home time is in 5 minutes while an earlier-starting
 *    one's next deadline is 20 minutes off). An overdue activity with
 *    nothing left to do but wait for the event (nextMilestone falls back to
 *    Event Starts) still outranks every upcoming one via the phase gate
 *    above, and among other overdue activities sorts by how soon ITS event
 *    starts, via that same fallback.
 *  - in_progress activities sort next (nothing pre-event left to act on),
 *    ordered by soonest end time — the one wrapping up soonest is the most
 *    relevant to still be showing.
 *  - completed activities sort last (callers are expected to filter these
 *    out before display entirely, per the widget's "today" scope).
 */
export function compareActivityUrgency(a: RankableActivity, b: RankableActivity): number {
  const rankDiff = PHASE_RANK[a.status.phase] - PHASE_RANK[b.status.phase];
  if (rankDiff !== 0) return rankDiff;

  switch (a.status.phase) {
    case 'overdue':
    case 'upcoming': {
      const at = a.status.nextMilestone?.time.getTime() ?? a.eventStart.getTime();
      const bt = b.status.nextMilestone?.time.getTime() ?? b.eventStart.getTime();
      return at - bt;
    }
    case 'in_progress':
      return a.eventEnd.getTime() - b.eventEnd.getTime();
    default:
      return a.eventStart.getTime() - b.eventStart.getTime();
  }
}

/** Sorts a copy of `items` by urgency (see compareActivityUrgency) — never mutates the input. */
export function sortByUrgency<T extends RankableActivity>(items: T[]): T[] {
  return [...items].sort(compareActivityUrgency);
}

export interface ActivityMilestoneSource {
  eventStart: Date;
  arrivalTime: Date | null;
  leaveHomeTime: Date | null;
  prepSteps: { id: string; label: string; kind: 'checkable' | 'informational'; time: Date | null }[];
}

/**
 * Reconstructs the scheduled-milestone list computeActivityStatus needs from
 * the FLAT fields the read API returns (arrivalTime/leaveHomeTime/prepSteps
 * with a time-or-null each) rather than computeTimelinePreview's own
 * richer shape — the client re-derives status locally on every countdown
 * tick (see useActivityWorkflow) without re-fetching, so it needs this one
 * small adapter to feed the same pure computeActivityStatus the server
 * already uses. A prep step with a null time (unscheduled) is simply
 * omitted — it was never a candidate milestone in the first place.
 */
export function buildScheduledMilestones(source: ActivityMilestoneSource): PreviewRow[] {
  const rows: PreviewRow[] = [
    { id: '__event_start', kind: 'milestone', label: 'Event starts', time: source.eventStart },
  ];
  if (source.arrivalTime) rows.push({ id: '__arrival', kind: 'milestone', label: 'Arrive', time: source.arrivalTime });
  if (source.leaveHomeTime) rows.push({ id: '__leave_home', kind: 'milestone', label: 'Leave home', time: source.leaveHomeTime });
  for (const step of source.prepSteps) {
    if (step.time) rows.push({ id: step.id, kind: step.kind, label: step.label, time: step.time });
  }
  return rows;
}
