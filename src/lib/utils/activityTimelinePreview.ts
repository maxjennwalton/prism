/**
 * Pure arithmetic for the Activity Profile editor's Timeline Preview (Phase 2
 * of the Sports & Activity Assistant). Takes an adjustable, UI-only sample
 * event time plus the profile draft currently being edited and returns the
 * rows to render — three fixed system milestones (Event Start, Arrival,
 * Leave Home) plus the profile's preparation steps.
 *
 * This is deliberately the same arithmetic a later phase will need for real
 * events (derived prep/leave/arrival times) — written once here so that
 * phase extends this rather than re-deriving it. The sample time itself is
 * never part of the data this function reads from or writes back to —
 * callers must never persist it.
 *
 * NULL vs 0 is a real distinction here, same as in the stored data (Phase 1):
 * `arrivalBufferMinutes`/`travelMinutes` left unset (null/undefined) mean
 * "not configured yet" and must NOT be treated as 0 — Arrival/Leave Home are
 * only ever given a calculated clock time once the buffer that determines
 * them is actually set, even to 0 ("arrive exactly at the event"). A row
 * whose time can't yet be calculated is returned as `unscheduled`, never as
 * a `scheduled` row pretending to be at the event's own time.
 */
import type { PrepStepAnchor } from '@/lib/constants/activityProfiles';

export type PreviewRowKind = 'milestone' | 'checkable' | 'informational';

/** A row with a calculable clock time. */
export interface PreviewRow {
  id: string;
  kind: PreviewRowKind;
  label: string;
  time: Date;
}

/** A row that can't be calculated yet because the timing it depends on isn't configured. */
export interface UnscheduledPreviewRow {
  id: string;
  kind: PreviewRowKind;
  label: string;
  /** Short, parent-facing reason this row has no time yet. */
  reason: string;
}

export interface TimelinePreviewResult {
  /** Chronologically ordered rows with a real calculated time. */
  scheduled: PreviewRow[];
  /** Rows whose time can't be calculated yet — milestones or prep steps waiting on a buffer that isn't configured. */
  unscheduled: UnscheduledPreviewRow[];
}

export interface TimelinePreviewPrepStep {
  id: string;
  label: string;
  anchor: PrepStepAnchor;
  offsetMinutes: number;
  isCheckable: boolean;
}

export interface TimelinePreviewProfile {
  /** Minutes to arrive before the event starts. Null/undefined = not configured — distinct from 0 ("arrive exactly at the event"). */
  arrivalBufferMinutes?: number | null;
  /** Minutes of travel time. Null/undefined = not configured — distinct from 0 ("no travel time"). */
  travelMinutes?: number | null;
  prepSteps: TimelinePreviewPrepStep[];
}

const MILESTONE_RANK: Record<PrepStepAnchor, number> = {
  leave_home: 0,
  arrival: 1,
  event_start: 2,
};

const MILESTONE_LABELS: Record<PrepStepAnchor, string> = {
  event_start: 'Event starts',
  arrival: 'Arrive',
  leave_home: 'Leave home',
};

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/**
 * Computes the timeline for the editor's live preview, split into rows that
 * have a real calculated time and rows that are still waiting on timing
 * configuration.
 *
 * @param sampleEventTime UI-only adjustable sample time — never persisted.
 * @param profile The in-progress (possibly unsaved) profile draft.
 */
export function computeTimelinePreview(
  sampleEventTime: Date,
  profile: TimelinePreviewProfile,
): TimelinePreviewResult {
  const eventStart = sampleEventTime;

  // Each milestone's resolvability cascades from the one before it: Arrival
  // needs its own buffer configured; Leave Home needs BOTH Arrival resolved
  // AND its own travel time configured. `?? null` keeps 0 meaningfully
  // different from "not set" at every step.
  const arrivalBuffer = profile.arrivalBufferMinutes ?? null;
  const travel = profile.travelMinutes ?? null;

  const arrival = arrivalBuffer !== null ? addMinutes(eventStart, -arrivalBuffer) : null;
  const leaveHome = arrival !== null && travel !== null ? addMinutes(arrival, -travel) : null;

  const milestoneTimes: Record<PrepStepAnchor, Date | null> = {
    event_start: eventStart,
    arrival,
    leave_home: leaveHome,
  };

  const scheduled: PreviewRow[] = [
    { id: '__event_start', kind: 'milestone', label: MILESTONE_LABELS.event_start, time: eventStart },
  ];
  const unscheduled: UnscheduledPreviewRow[] = [];

  if (arrival !== null) {
    scheduled.push({ id: '__arrival', kind: 'milestone', label: MILESTONE_LABELS.arrival, time: arrival });
  } else {
    unscheduled.push({ id: '__arrival', kind: 'milestone', label: MILESTONE_LABELS.arrival, reason: 'Set an arrival buffer above to calculate this' });
  }

  if (leaveHome !== null) {
    scheduled.push({ id: '__leave_home', kind: 'milestone', label: MILESTONE_LABELS.leave_home, time: leaveHome });
  } else {
    unscheduled.push({
      id: '__leave_home',
      kind: 'milestone',
      label: MILESTONE_LABELS.leave_home,
      reason: arrival === null ? 'Set an arrival buffer above to calculate this' : 'Set a travel time above to calculate this',
    });
  }

  for (const step of profile.prepSteps) {
    const kind: PreviewRowKind = step.isCheckable ? 'checkable' : 'informational';
    const anchorTime = milestoneTimes[step.anchor];
    if (anchorTime !== null) {
      scheduled.push({ id: step.id, kind, label: step.label, time: addMinutes(anchorTime, -step.offsetMinutes) });
    } else {
      unscheduled.push({ id: step.id, kind, label: step.label, reason: `Needs "${MILESTONE_LABELS[step.anchor]}" to be configured first` });
    }
  }

  // Chronological order. Ties (e.g. a 0-minute buffer makes Arrival coincide
  // with Event Start) break by milestone rank so the system rows always read
  // Leave Home -> Arrive -> Event relative to each other, with any same-time
  // prep step sorted ahead of the milestone it's effectively "at".
  scheduled.sort((a, b) => {
    const t = a.time.getTime() - b.time.getTime();
    if (t !== 0) return t;
    const rankA = a.kind === 'milestone' ? MILESTONE_RANK[anchorKindOf(a.id)] : -1;
    const rankB = b.kind === 'milestone' ? MILESTONE_RANK[anchorKindOf(b.id)] : -1;
    return rankA - rankB;
  });

  return { scheduled, unscheduled };
}

function anchorKindOf(milestoneRowId: string): PrepStepAnchor {
  if (milestoneRowId === '__leave_home') return 'leave_home';
  if (milestoneRowId === '__arrival') return 'arrival';
  return 'event_start';
}
