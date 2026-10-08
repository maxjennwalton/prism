/**
 * Phase 4B / Weekly Review preparation: reusable issue-detection logic over
 * the next 7 days of matched activities. This is deliberately just the
 * detection function — no widget, no dashboard surface. Phase 4C builds
 * the actual Weekly Review UI on top of this; this module exists now so
 * that UI has something real to call rather than re-deriving the same
 * checks later.
 *
 * Detects exactly five issue types, at most one per occurrence (most
 * relevant wins — see the ordering in detectWeeklyReviewIssues):
 *   - unreviewed_match:    still awaiting a human decision (needs_review)
 *   - missing_destination: no locationOverride, event location, or
 *                           profile default location at all
 *   - missing_departure:   no per-event departure override AND no
 *                           household Home address configured
 *   - ambiguous_address:   a geocode attempt on either side failed or came
 *                           back ambiguous (travel_meta failureReason
 *                           prefixed departure_/destination_)
 *   - unavailable_route:   the address resolved fine but the routing
 *                           provider itself failed (timeout, rate limit,
 *                           provider error, not configured)
 *
 * A rejected link ("not an activity", a human decision) is never flagged —
 * same rule every other Activity Matching surface follows. A settled link
 * with a resolved travel estimate (calculated, manual override, or profile
 * fallback) is never flagged either; "using the profile fallback" is not
 * one of the five issue types.
 */
import { and, eq, gte, lt } from 'drizzle-orm';
import { db, type DbExecutor } from '@/lib/db/client';
import { activityEventLinks, activityProfiles, events, users, type ActivityTravelMeta } from '@/lib/db/schema';
import { resolveEffectiveLocation } from '@/lib/utils/activityWorkflowTiming';
import { resolveEffectiveDeparture } from '@/lib/utils/activityTravelResolution';
import { getHomeAddress } from '@/lib/services/homeAddress';

export const WEEKLY_REVIEW_WINDOW_DAYS = 7;

export type WeeklyReviewIssueType =
  | 'unreviewed_match'
  | 'missing_destination'
  | 'missing_departure'
  | 'ambiguous_address'
  | 'unavailable_route';

export interface WeeklyReviewIssue {
  type: WeeklyReviewIssueType;
  linkId: string;
  eventId: string;
  eventTitle: string;
  eventStart: Date;
  memberName: string | null;
  /** The raw travel_meta.failureReason behind ambiguous_address/unavailable_route, if any. */
  detail: string | null;
}

interface ReviewCandidateRow {
  linkId: string;
  matchStatus: 'auto_confirmed' | 'needs_review' | 'confirmed' | 'rejected' | null;
  departureLocationOverride: string | null;
  travelMinutesOverride: number | null;
  locationOverride: string | null;
  travelMeta: ActivityTravelMeta | null;
  eventId: string;
  eventTitle: string;
  eventLocation: string | null;
  eventStart: Date;
  memberName: string | null;
  profileDefaultLocation: string | null;
}

function classifyFailure(failureReason: string): 'ambiguous_address' | 'unavailable_route' {
  return failureReason.startsWith('departure_') || failureReason.startsWith('destination_')
    ? 'ambiguous_address'
    : 'unavailable_route';
}

/**
 * Detects every Weekly Review issue over the next WEEKLY_REVIEW_WINDOW_DAYS
 * days. Read-only — never writes or recomputes anything; it only reports
 * what's already true from the data a prior sync/match/travel pass wrote.
 */
export async function detectWeeklyReviewIssues(
  executor: DbExecutor = db,
  now: Date = new Date(),
  windowDays: number = WEEKLY_REVIEW_WINDOW_DAYS,
): Promise<WeeklyReviewIssue[]> {
  const to = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

  const rows: ReviewCandidateRow[] = await executor
    .select({
      linkId: activityEventLinks.id,
      matchStatus: activityEventLinks.matchStatus,
      departureLocationOverride: activityEventLinks.departureLocationOverride,
      travelMinutesOverride: activityEventLinks.travelMinutesOverride,
      locationOverride: activityEventLinks.locationOverride,
      travelMeta: activityEventLinks.travelMeta,
      eventId: events.id,
      eventTitle: events.title,
      eventLocation: events.location,
      eventStart: events.startTime,
      memberName: users.name,
      profileDefaultLocation: activityProfiles.defaultLocation,
    })
    .from(activityEventLinks)
    .innerJoin(events, eq(activityEventLinks.eventId, events.id))
    .leftJoin(activityProfiles, eq(activityEventLinks.activityProfileId, activityProfiles.id))
    .leftJoin(users, eq(activityEventLinks.assignedMemberId, users.id))
    .where(and(gte(events.startTime, now), lt(events.startTime, to)));

  const settled = rows.filter((r) => r.matchStatus !== 'rejected');
  if (settled.length === 0) return [];

  const home = await getHomeAddress(executor);
  const issues: WeeklyReviewIssue[] = [];

  for (const r of settled) {
    const base = { linkId: r.linkId, eventId: r.eventId, eventTitle: r.eventTitle, eventStart: r.eventStart, memberName: r.memberName };

    if (r.matchStatus === 'needs_review') {
      issues.push({ ...base, type: 'unreviewed_match', detail: null });
      continue;
    }

    // Manual override means travel is fully resolved regardless of
    // destination/departure configuration — never flagged.
    if (r.travelMinutesOverride !== null && r.travelMinutesOverride !== undefined) {
      continue;
    }

    const destination = resolveEffectiveLocation(r.locationOverride, r.eventLocation, r.profileDefaultLocation ?? null);
    if (!destination) {
      issues.push({ ...base, type: 'missing_destination', detail: null });
      continue;
    }

    const departure = resolveEffectiveDeparture(r.departureLocationOverride, home?.address ?? null);
    if (!departure) {
      issues.push({ ...base, type: 'missing_departure', detail: null });
      continue;
    }

    if (r.travelMeta?.status === 'unavailable' && r.travelMeta.failureReason) {
      issues.push({ ...base, type: classifyFailure(r.travelMeta.failureReason), detail: r.travelMeta.failureReason });
    }
  }

  return issues;
}
