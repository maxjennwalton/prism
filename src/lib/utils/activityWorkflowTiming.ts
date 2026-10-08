/**
 * Pure arithmetic for the Activity Workflow widget (Sports & Activity
 * Assistant, Phase 4A). Resolves the "effective" timing/location for one
 * REAL matched occurrence (an activity_event_links row joined to its event
 * and Activity Profile) and computes its timeline by delegating straight to
 * the editor's existing computeTimelinePreview — see that module's own doc
 * comment, which already calls out this exact reuse: "the same arithmetic a
 * later phase will need for real events... written once here so that phase
 * extends this rather than re-deriving it." This file is that extension; it
 * never re-implements the milestone math itself.
 *
 * Same NULL vs 0 rule as everywhere else in Activity Profiles: an override
 * or profile value of 0 is a real, calculated setting ("arrive exactly on
 * time" / "no travel time") and must never be treated the same as it being
 * unset. `??` is used deliberately throughout (not `||`) because it only
 * falls through on null/undefined, never on 0.
 */
import {
  computeTimelinePreview,
  type TimelinePreviewPrepStep,
  type TimelinePreviewResult,
} from './activityTimelinePreview';

/** The occurrence-level overrides stored on one activity_event_links row. */
export interface ActivityOccurrenceOverrides {
  arrivalBufferMinutesOverride?: number | null;
  travelMinutesOverride?: number | null;
  locationOverride?: string | null;
}

/** The Activity Profile's own defaults, as read from activity_profiles. */
export interface ActivityProfileDefaults {
  arrivalBufferMinutes?: number | null;
  travelMinutes?: number | null;
  defaultLocation?: string | null;
}

/**
 * Occurrence override wins when set; otherwise fall back to the profile's
 * own default; otherwise null ("not configured anywhere"). Used identically
 * for arrivalBufferMinutes and travelMinutes.
 */
export function resolveEffectiveMinutes(
  override: number | null | undefined,
  profileDefault: number | null | undefined,
): number | null {
  return override ?? profileDefault ?? null;
}

/**
 * Location precedence (approved product decision): occurrence-specific
 * locationOverride -> the calendar event's own location -> the Activity
 * Profile's default location -> null. Never invents a location when all
 * three are empty/unset.
 */
export function resolveEffectiveLocation(
  locationOverride: string | null | undefined,
  eventLocation: string | null | undefined,
  profileDefaultLocation: string | null | undefined,
): string | null {
  const override = locationOverride?.trim();
  if (override) return override;
  const eventLoc = eventLocation?.trim();
  if (eventLoc) return eventLoc;
  const profileLoc = profileDefaultLocation?.trim();
  if (profileLoc) return profileLoc;
  return null;
}

export interface ActivityEffectiveTiming {
  arrivalBufferMinutes: number | null;
  travelMinutes: number | null;
}

/** Resolves both timing fields from occurrence overrides + profile defaults in one call. */
export function resolveEffectiveTiming(
  overrides: ActivityOccurrenceOverrides,
  profile: ActivityProfileDefaults,
): ActivityEffectiveTiming {
  return {
    arrivalBufferMinutes: resolveEffectiveMinutes(overrides.arrivalBufferMinutesOverride, profile.arrivalBufferMinutes),
    travelMinutes: resolveEffectiveMinutes(overrides.travelMinutesOverride, profile.travelMinutes),
  };
}

/**
 * Computes the real timeline for one occurrence. A thin, intentional
 * pass-through to computeTimelinePreview — the effective buffers/prep steps
 * computed above are exactly the shape that function already expects, so
 * there is no separate arithmetic to maintain here.
 */
export function computeActivityTimeline(
  eventStart: Date,
  effective: ActivityEffectiveTiming,
  prepSteps: TimelinePreviewPrepStep[],
): TimelinePreviewResult {
  return computeTimelinePreview(eventStart, {
    arrivalBufferMinutes: effective.arrivalBufferMinutes,
    travelMinutes: effective.travelMinutes,
    prepSteps,
  });
}
