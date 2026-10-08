/**
 * Read service for the Activity Workflow widget (Sports & Activity
 * Assistant, Phase 4A). Lists today's SETTLED matched activities
 * (auto_confirmed / confirmed only — needs_review and rejected links, and
 * events with no link at all, are never included) with their full computed
 * timeline, in the household's own configured timezone.
 *
 * Read-only: this never writes anything and never re-runs matching. It is a
 * display layer over what Phase 3 already decided, exactly like
 * listNeedsReviewLinks is for the review queue.
 *
 * Returned in chronological (event start) order — the same convention every
 * other Phase 3 listing uses. Urgency ranking (overdue-first, next-
 * milestone-first — see activityWorkflowPriority.ts) is a presentation
 * concern applied by the client hook/widget, not baked into this contract,
 * so the plain "what's matched today" shape stays simple and independently
 * testable from "what order to show it in".
 */
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { db, type DbExecutor } from '@/lib/db/client';
import {
  activityEventLinks,
  activityProfilePrepSteps,
  activityProfiles,
  events,
  settings,
  users,
} from '@/lib/db/schema';
import { todayBoundsInZone } from '@/lib/utils/timezone';
import {
  resolveEffectiveTiming,
  resolveEffectiveLocation,
  computeActivityTimeline,
} from '@/lib/utils/activityWorkflowTiming';
import { computeActivityStatus, type ActivityWorkflowStatus } from '@/lib/utils/activityWorkflowPriority';
import type { TimelinePreviewPrepStep } from '@/lib/utils/activityTimelinePreview';

/** Settled link states this widget ever surfaces — never needs_review, never rejected. */
const SETTLED_MATCH_STATUSES = ['auto_confirmed', 'confirmed'] as const;

/** Settings key the household's timezone is stored under (see useTimezone/GeneralSection). */
const TIMEZONE_SETTING_KEY = 'timezone';

async function loadHouseholdTimezone(executor: DbExecutor): Promise<string> {
  const [row] = await executor.select().from(settings).where(eq(settings.key, TIMEZONE_SETTING_KEY));
  const value = row?.value;
  return typeof value === 'string' && value.length > 0 ? value : 'UTC';
}

export interface ActivityWorkflowPrepStepView {
  id: string;
  label: string;
  kind: 'checkable' | 'informational';
  /** A real calculated time, or null — never guessed. */
  time: Date | null;
  /** Set only when `time` is null: the human-facing reason it can't be calculated yet. */
  unscheduledReason: string | null;
}

export interface ActivityWorkflowItem {
  linkId: string;
  eventId: string;
  eventTitle: string;
  eventStart: Date;
  eventEnd: Date;
  memberId: string | null;
  memberName: string | null;
  memberColor: string | null;
  profileId: string | null;
  profileName: string | null;
  profileColor: string | null;
  /** True when the matched profile has since been archived — the link still displays fully (Phase 3 invariant: archiving never touches existing links). */
  profileArchived: boolean;
  /** Effective location: locationOverride -> event.location -> profile.defaultLocation -> null. Never invented. */
  location: string | null;
  arrivalTime: Date | null;
  leaveHomeTime: Date | null;
  prepSteps: ActivityWorkflowPrepStepView[];
  status: ActivityWorkflowStatus;
}

interface PrepStepLoadRow {
  id: string;
  activityProfileId: string;
  label: string;
  anchor: TimelinePreviewPrepStep['anchor'];
  offsetMinutes: number;
  isCheckable: boolean;
}

async function loadPrepStepsByProfile(
  profileIds: string[],
  executor: DbExecutor,
): Promise<Map<string, TimelinePreviewPrepStep[]>> {
  const byProfile = new Map<string, TimelinePreviewPrepStep[]>();
  if (profileIds.length === 0) return byProfile;

  const rows: PrepStepLoadRow[] = await executor
    .select({
      id: activityProfilePrepSteps.id,
      activityProfileId: activityProfilePrepSteps.activityProfileId,
      label: activityProfilePrepSteps.label,
      anchor: activityProfilePrepSteps.anchor,
      offsetMinutes: activityProfilePrepSteps.offsetMinutes,
      isCheckable: activityProfilePrepSteps.isCheckable,
    })
    .from(activityProfilePrepSteps)
    .where(inArray(activityProfilePrepSteps.activityProfileId, profileIds))
    .orderBy(asc(activityProfilePrepSteps.sortOrder));

  for (const row of rows) {
    const list = byProfile.get(row.activityProfileId) ?? [];
    list.push({ id: row.id, label: row.label, anchor: row.anchor, offsetMinutes: row.offsetMinutes, isCheckable: row.isCheckable });
    byProfile.set(row.activityProfileId, list);
  }
  return byProfile;
}

/**
 * Merges computeActivityTimeline's scheduled/unscheduled prep-step rows back
 * into one ordered (profile sortOrder) list, carrying either a calculated
 * time or a human reason it can't be calculated yet — the "clearly label
 * unavailable calculations instead of guessing" rule, applied to the
 * per-step display rather than just the two system milestones.
 */
function buildPrepStepViews(
  prepSteps: TimelinePreviewPrepStep[],
  scheduled: { id: string; time: Date }[],
  unscheduled: { id: string; reason: string }[],
): ActivityWorkflowPrepStepView[] {
  const scheduledById = new Map(scheduled.map((r) => [r.id, r]));
  const unscheduledById = new Map(unscheduled.map((r) => [r.id, r]));

  return prepSteps.map((step) => {
    const kind: 'checkable' | 'informational' = step.isCheckable ? 'checkable' : 'informational';
    const resolved = scheduledById.get(step.id);
    if (resolved) {
      return { id: step.id, label: step.label, kind, time: resolved.time, unscheduledReason: null };
    }
    return {
      id: step.id,
      label: step.label,
      kind,
      time: null,
      unscheduledReason: unscheduledById.get(step.id)?.reason ?? null,
    };
  });
}

/**
 * Lists every settled (auto_confirmed/confirmed) matched activity whose
 * event starts today, in the household's own configured timezone. `now`
 * defaults to the real current instant; tests pass a fixed value so results
 * are deterministic.
 */
export async function listTodayActivityWorkflow(
  now: Date = new Date(),
  executor: DbExecutor = db,
): Promise<ActivityWorkflowItem[]> {
  const timezone = await loadHouseholdTimezone(executor);
  const { start, end } = todayBoundsInZone(now, timezone);

  const rows = await executor
    .select({
      linkId: activityEventLinks.id,
      arrivalBufferMinutesOverride: activityEventLinks.arrivalBufferMinutesOverride,
      travelMinutesOverride: activityEventLinks.travelMinutesOverride,
      locationOverride: activityEventLinks.locationOverride,
      assignedMemberId: activityEventLinks.assignedMemberId,
      activityProfileId: activityEventLinks.activityProfileId,
      eventId: events.id,
      eventTitle: events.title,
      eventLocation: events.location,
      eventStart: events.startTime,
      eventEnd: events.endTime,
      memberName: users.name,
      memberColor: users.color,
      profileName: activityProfiles.name,
      profileColor: activityProfiles.color,
      profileArchived: activityProfiles.archived,
      profileArrivalBufferMinutes: activityProfiles.arrivalBufferMinutes,
      profileTravelMinutes: activityProfiles.travelMinutes,
      profileDefaultLocation: activityProfiles.defaultLocation,
    })
    .from(activityEventLinks)
    .innerJoin(events, eq(activityEventLinks.eventId, events.id))
    // LEFT JOINs: a settled link can (rarely, via direct API use rather than
    // the normal UI) have no profile/member, and a matched profile may since
    // have been archived — neither case should drop the row or its event
    // details. Archived profiles are never filtered out here on purpose.
    .leftJoin(activityProfiles, eq(activityEventLinks.activityProfileId, activityProfiles.id))
    .leftJoin(users, eq(activityEventLinks.assignedMemberId, users.id))
    .where(
      and(
        inArray(activityEventLinks.matchStatus, SETTLED_MATCH_STATUSES),
        gte(events.startTime, start),
        lt(events.startTime, end),
      ),
    )
    .orderBy(asc(events.startTime));

  if (rows.length === 0) return [];

  const profileIds = Array.from(
    new Set(rows.map((r) => r.activityProfileId).filter((id): id is string => id !== null)),
  );
  const prepStepsByProfile = await loadPrepStepsByProfile(profileIds, executor);

  return rows.map((r) => {
    const prepSteps = r.activityProfileId ? prepStepsByProfile.get(r.activityProfileId) ?? [] : [];
    const effective = resolveEffectiveTiming(
      { arrivalBufferMinutesOverride: r.arrivalBufferMinutesOverride, travelMinutesOverride: r.travelMinutesOverride },
      { arrivalBufferMinutes: r.profileArrivalBufferMinutes ?? null, travelMinutes: r.profileTravelMinutes ?? null },
    );
    const timeline = computeActivityTimeline(r.eventStart, effective, prepSteps);
    const status = computeActivityStatus(now, r.eventStart, r.eventEnd, timeline.scheduled);
    const location = resolveEffectiveLocation(r.locationOverride, r.eventLocation, r.profileDefaultLocation ?? null);

    const arrivalTime = timeline.scheduled.find((row) => row.id === '__arrival')?.time ?? null;
    const leaveHomeTime = timeline.scheduled.find((row) => row.id === '__leave_home')?.time ?? null;

    return {
      linkId: r.linkId,
      eventId: r.eventId,
      eventTitle: r.eventTitle,
      eventStart: r.eventStart,
      eventEnd: r.eventEnd,
      memberId: r.assignedMemberId,
      memberName: r.memberName,
      memberColor: r.memberColor,
      profileId: r.activityProfileId,
      profileName: r.profileName,
      profileColor: r.profileColor,
      profileArchived: r.profileArchived ?? false,
      location,
      arrivalTime,
      leaveHomeTime,
      prepSteps: buildPrepStepViews(prepSteps, timeline.scheduled, timeline.unscheduled),
      status,
    };
  });
}
