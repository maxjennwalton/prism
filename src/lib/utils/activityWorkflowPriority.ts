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
  /** The soonest not-yet-passed milestone — set only when phase is 'upcoming'. */
  nextMilestone: PreviewRow | null;
  /** The most recently passed milestone (what was missed) — set only when phase is 'overdue'. */
  overdueMilestone: PreviewRow | null;
}

/** computeTimelinePreview's fixed id for the Event Starts milestone row. */
const EVENT_START_ROW_ID = '__event_start';

/**
 * Computes the current phase for one occurrence.
 *
 * - `now >= eventEnd` -> 'completed' (the real end time from the event row —
 *   never a fabricated one; events always carry a real endTime).
 * - `now >= eventStart` (and before eventEnd) -> 'in_progress'. Pre-event
 *   deadlines stop being actionable the instant the event starts, per the
 *   approved product decision — no milestone is surfaced in this phase.
 * - Otherwise (event hasn't started): Event Starts itself is always still in
 *   the future at this point (that's what "hasn't started" means), so it is
 *   deliberately excluded from the overdue/upcoming decision below — only
 *   the PRE-event milestones (Leave Home, Arrive, prep steps) decide that,
 *   since those are the ones a parent can actually still miss:
 *     - No pre-event milestone is configured at all -> 'upcoming', with
 *       Event Starts itself as the next milestone (e.g. "Starts in 12 min").
 *     - At least one pre-event milestone is still in the future -> 'upcoming',
 *       surfacing the soonest of those (never Event Starts, as long as a
 *       nearer pre-event deadline still exists).
 *     - Every pre-event milestone has already passed -> 'overdue',
 *       surfacing the most recently missed one — never silently dropped.
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
    return { phase: 'completed', nextMilestone: null, overdueMilestone: null };
  }
  if (nowMs >= eventStart.getTime()) {
    return { phase: 'in_progress', nextMilestone: null, overdueMilestone: null };
  }

  const eventStartRow = scheduledMilestones.find((m) => m.id === EVENT_START_ROW_ID) ?? null;
  const preEventMilestones = scheduledMilestones.filter((m) => m.id !== EVENT_START_ROW_ID);

  let soonestFuture: PreviewRow | null = null;
  let latestPast: PreviewRow | null = null;
  for (const milestone of preEventMilestones) {
    const t = milestone.time.getTime();
    if (t > nowMs) {
      if (soonestFuture === null || t < soonestFuture.time.getTime()) soonestFuture = milestone;
    } else {
      if (latestPast === null || t > latestPast.time.getTime()) latestPast = milestone;
    }
  }

  if (soonestFuture !== null) {
    return { phase: 'upcoming', nextMilestone: soonestFuture, overdueMilestone: null };
  }
  if (latestPast !== null) {
    return { phase: 'overdue', nextMilestone: null, overdueMilestone: latestPast };
  }
  // No pre-event milestone configured at all (no arrival buffer, no travel
  // time, no prep steps) — Event Starts is the only milestone there is, and
  // it's still ahead of us, so this is 'upcoming', not 'overdue'.
  return { phase: 'upcoming', nextMilestone: eventStartRow, overdueMilestone: null };
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
 *  - overdue activities sort first, ordered by soonest event start (the one
 *    with the least slack left is the most urgent to resolve).
 *  - upcoming activities sort next, ordered by their own soonest next
 *    milestone time (never by event start — a soon-to-start event whose
 *    leave-home time is far off is less urgent than one leaving in 5
 *    minutes even if it starts later).
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
      return a.eventStart.getTime() - b.eventStart.getTime();
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
