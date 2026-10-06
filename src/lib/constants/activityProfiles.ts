/**
 * Shared constants for the Sports & Activity Assistant's Activity Profiles.
 * Single source of truth — use these everywhere instead of inline literals.
 */

/**
 * The three system-calculated milestones a prep step's offset can count back
 * from. These are never stored as rows — they're computed at read time from
 * the event's own startTime plus the profile/override buffers — so a step
 * only ever references one of these three well-known anchor names, not
 * another row's id.
 */
export const PREP_STEP_ANCHORS = ['event_start', 'arrival', 'leave_home'] as const;

export type PrepStepAnchor = (typeof PREP_STEP_ANCHORS)[number];

/** Display labels keyed by anchor value. */
export const PREP_STEP_ANCHOR_LABELS: Record<PrepStepAnchor, string> = {
  event_start: 'Event start',
  arrival: 'Arrival',
  leave_home: 'Leave home',
};
