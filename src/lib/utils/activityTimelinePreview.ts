/**
 * Pure arithmetic for the Activity Profile editor's Timeline Preview (Phase 2
 * of the Sports & Activity Assistant). Takes an adjustable, UI-only sample
 * event time plus the profile draft currently being edited and returns an
 * ordered list of rows to render — three fixed system milestones (Event
 * Start, Arrival, Leave Home) plus the profile's preparation steps, each
 * placed at its computed clock time.
 *
 * This is deliberately the same arithmetic a later phase will need for real
 * events (derived prep/leave/arrival times) — written once here so that
 * phase extends this rather than re-deriving it. The sample time itself is
 * never part of the data this function reads from or writes back to —
 * callers must never persist it.
 */
import type { PrepStepAnchor } from '@/lib/constants/activityProfiles';

export type PreviewRowKind = 'milestone' | 'checkable' | 'informational';

export interface PreviewRow {
  id: string;
  kind: PreviewRowKind;
  label: string;
  time: Date;
}

export interface TimelinePreviewPrepStep {
  id: string;
  label: string;
  anchor: PrepStepAnchor;
  offsetMinutes: number;
  isCheckable: boolean;
}

export interface TimelinePreviewProfile {
  /** Minutes to arrive before the event starts. Unset (null/undefined) is treated as 0 for preview purposes only — never an invented number, just "no buffer configured yet". */
  arrivalBufferMinutes?: number | null;
  /** Minutes of travel time. Unset (null/undefined) is treated as 0 for preview purposes only. */
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

function anchorTime(anchor: PrepStepAnchor, milestones: Record<PrepStepAnchor, Date>): Date {
  return milestones[anchor];
}

/**
 * Computes the ordered timeline for the editor's live preview.
 *
 * @param sampleEventTime UI-only adjustable sample time — never persisted.
 * @param profile The in-progress (possibly unsaved) profile draft.
 */
export function computeTimelinePreview(
  sampleEventTime: Date,
  profile: TimelinePreviewProfile,
): PreviewRow[] {
  const arrivalBuffer = profile.arrivalBufferMinutes ?? 0;
  const travel = profile.travelMinutes ?? 0;

  const eventStart = sampleEventTime;
  const arrival = addMinutes(eventStart, -arrivalBuffer);
  const leaveHome = addMinutes(arrival, -travel);

  const milestones: Record<PrepStepAnchor, Date> = {
    event_start: eventStart,
    arrival,
    leave_home: leaveHome,
  };

  const rows: PreviewRow[] = [
    { id: '__leave_home', kind: 'milestone', label: MILESTONE_LABELS.leave_home, time: leaveHome },
    { id: '__arrival', kind: 'milestone', label: MILESTONE_LABELS.arrival, time: arrival },
    { id: '__event_start', kind: 'milestone', label: MILESTONE_LABELS.event_start, time: eventStart },
    ...profile.prepSteps.map((step) => ({
      id: step.id,
      kind: (step.isCheckable ? 'checkable' : 'informational') as PreviewRowKind,
      label: step.label,
      time: addMinutes(anchorTime(step.anchor, milestones), -step.offsetMinutes),
    })),
  ];

  // Chronological order. Ties (e.g. a 0-minute buffer makes Arrival coincide
  // with Event Start) break by milestone rank so the three system rows
  // always read Leave Home -> Arrive -> Event in that order relative to each
  // other, with any same-time prep step sorted ahead of the milestone it's
  // effectively "at".
  return rows.sort((a, b) => {
    const t = a.time.getTime() - b.time.getTime();
    if (t !== 0) return t;
    const rankA = a.kind === 'milestone' ? MILESTONE_RANK[anchorKindOf(a.id)] : -1;
    const rankB = b.kind === 'milestone' ? MILESTONE_RANK[anchorKindOf(b.id)] : -1;
    return rankA - rankB;
  });
}

function anchorKindOf(milestoneRowId: string): PrepStepAnchor {
  if (milestoneRowId === '__leave_home') return 'leave_home';
  if (milestoneRowId === '__arrival') return 'arrival';
  return 'event_start';
}
