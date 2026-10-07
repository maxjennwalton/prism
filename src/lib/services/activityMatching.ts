/**
 * Orchestration for Activity Event Matching (Sports & Activity Assistant,
 * Phase 3): finds calendar events that haven't been looked at yet, runs
 * them through the pure matcher (src/lib/matching/activityMatcher.ts), and
 * optionally persists the result as an activity_event_links row.
 *
 * `matchEventsInRange` is the one function Preview, Activate's backfill,
 * and the incremental cron tick all call — same event-selection query, same
 * profile/identifier lookups, same matcher. Preview just passes
 * `persist: false`. There is no separate "backfill algorithm": Activate
 * runs this once, and the cron tick re-runs the exact same bounded-window
 * pass on every sync, which naturally catches newly-synced events as they
 * enter the window and naturally skips anything already linked.
 */
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { db, type DbExecutor } from '@/lib/db/client';
import { events, calendarSources, calendarGroups, activityEventLinks, settings, type ActivityMatchMeta } from '@/lib/db/schema';
import { listActivityProfiles, createActivityEventLinkIfAbsent, updateActivityEventLink } from '@/lib/db/activityProfiles';
import { matchEvent, type MatchResult, type MatchTeamIdentifier } from '@/lib/matching/activityMatcher';

/**
 * Both the one-time Activate backfill and every incremental cron tick use
 * this exact bounded window — there is no unbounded "scan all history" mode
 * anywhere in Activity Matching.
 */
export const ACTIVITY_MATCHING_WINDOW_DAYS = 60;

export function activityMatchingWindow(now: Date = new Date()): { from: Date; to: Date } {
  return { from: now, to: new Date(now.getTime() + ACTIVITY_MATCHING_WINDOW_DAYS * 24 * 60 * 60 * 1000) };
}

export interface MatchEventSummary {
  eventId: string;
  title: string;
  startTime: Date;
  result: MatchResult;
}

export interface MatchRangeSummary {
  total: number;
  autoMatched: number;
  needsReview: number;
  ignored: number;
  results: MatchEventSummary[];
}

async function loadTeamIdentifiers(executor: DbExecutor): Promise<MatchTeamIdentifier[]> {
  const [row] = await executor.select().from(settings).where(eq(settings.key, 'activityTeamIdentifiers'));
  const value = row?.value;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is MatchTeamIdentifier =>
      Boolean(v) &&
      typeof v === 'object' &&
      typeof (v as { identifier?: unknown }).identifier === 'string' &&
      typeof (v as { memberId?: unknown }).memberId === 'string',
  );
}

/**
 * Events in [from, to] with no activity_event_link yet, plus the member who
 * owns the calendar/group they came from (if that calendar is a per-member
 * one — type='user' — rather than a shared/custom calendar).
 */
async function loadUnlinkedEventsInRange(executor: DbExecutor, from: Date, to: Date) {
  return executor
    .select({
      id: events.id,
      title: events.title,
      startTime: events.startTime,
      calendarGroupMemberId: calendarGroups.userId,
    })
    .from(events)
    .leftJoin(calendarSources, eq(events.calendarSourceId, calendarSources.id))
    .leftJoin(calendarGroups, and(eq(calendarSources.groupId, calendarGroups.id), eq(calendarGroups.type, 'user')))
    .leftJoin(activityEventLinks, eq(events.id, activityEventLinks.eventId))
    .where(
      and(
        isNull(activityEventLinks.id),
        isNull(events.pendingDeletion),
        gte(events.startTime, from),
        lte(events.startTime, to),
      ),
    );
}

/** Settings key read by the client's useActivityMatchingStatus hook too — keep both in sync if this ever changes. */
export const MATCHING_ENABLED_SETTING_KEY = 'activityMatchingEnabled';

async function isMatchingEnabled(executor: DbExecutor): Promise<boolean> {
  const [row] = await executor.select().from(settings).where(eq(settings.key, MATCHING_ENABLED_SETTING_KEY));
  const value = row?.value;
  return Boolean(value && typeof value === 'object' && (value as { enabled?: unknown }).enabled === true);
}

export interface MatchEventsInRangeOptions {
  /** false (Preview) runs the matcher and reports results without writing anything. */
  persist: boolean;
  /** Pass the `tx` from a `db.transaction(async (tx) => ...)` to make the backfill atomic with another write. */
  executor?: DbExecutor;
}

export async function matchEventsInRange(
  from: Date,
  to: Date,
  opts: MatchEventsInRangeOptions,
): Promise<MatchRangeSummary> {
  const executor = opts.executor ?? db;

  const [profiles, teamIdentifiers, candidateEvents] = await Promise.all([
    listActivityProfiles({}, executor),
    loadTeamIdentifiers(executor),
    loadUnlinkedEventsInRange(executor, from, to),
  ]);

  const activeProfiles = profiles.map((p) => ({ id: p.id, name: p.name, matchKeywords: p.matchKeywords }));

  const results: MatchEventSummary[] = [];
  let autoMatched = 0;
  let needsReview = 0;
  let ignored = 0;

  for (const event of candidateEvents) {
    const result = matchEvent({
      title: event.title,
      activeProfiles,
      teamIdentifiers,
      calendarGroupMemberId: event.calendarGroupMemberId,
    });

    results.push({ eventId: event.id, title: event.title, startTime: event.startTime, result });

    if (result.outcome === 'auto_match') autoMatched++;
    else if (result.outcome === 'needs_review') needsReview++;
    else ignored++;

    // "ignore" means this event doesn't look like an activity at all — no
    // row is created, exactly like a never-reviewed calendar event today.
    if (opts.persist && result.outcome !== 'ignore') {
      await createActivityEventLinkIfAbsent(
        {
          eventId: event.id,
          activityProfileId: result.profileId,
          assignedMemberId: result.memberId,
          autoMatched: true,
          matchStatus: result.matchStatus,
          matchMeta: {
            reviewReason: result.reviewReason,
            matchedPhrase: result.matchedPhrase,
            profileCandidates: result.profileCandidates,
            memberCandidates: result.memberCandidates,
            identifiersFound: result.identifiersFound,
          },
        },
        executor,
      );
    }
  }

  return { total: candidateEvents.length, autoMatched, needsReview, ignored, results };
}

/**
 * Entry point for the calendar sync cron. Runs the exact same bounded
 * 60-day pass Activate uses, but only when a household has actually turned
 * matching on — before that, the cron must never create a single
 * activity_event_links row. Returns null when matching is disabled (so the
 * cron can skip it from its report entirely) rather than an empty summary.
 */
export async function runActivityMatchingTick(): Promise<MatchRangeSummary | null> {
  if (!(await isMatchingEnabled(db))) return null;
  const { from, to } = activityMatchingWindow();
  return matchEventsInRange(from, to, { persist: true });
}

export interface NeedsReviewRow {
  id: string;
  eventId: string;
  eventTitle: string;
  eventStartTime: Date;
  activityProfileId: string | null;
  assignedMemberId: string | null;
  reviewReason: ActivityMatchMeta['reviewReason'];
  profileCandidates: ActivityMatchMeta['profileCandidates'];
  memberCandidates: ActivityMatchMeta['memberCandidates'];
  identifiersFound: ActivityMatchMeta['identifiersFound'];
}

/** Every link still awaiting a human decision, oldest event first. */
export async function listNeedsReviewLinks(executor: DbExecutor = db): Promise<NeedsReviewRow[]> {
  const rows = await executor
    .select({
      id: activityEventLinks.id,
      eventId: activityEventLinks.eventId,
      activityProfileId: activityEventLinks.activityProfileId,
      assignedMemberId: activityEventLinks.assignedMemberId,
      matchMeta: activityEventLinks.matchMeta,
      eventTitle: events.title,
      eventStartTime: events.startTime,
    })
    .from(activityEventLinks)
    .innerJoin(events, eq(activityEventLinks.eventId, events.id))
    .where(eq(activityEventLinks.matchStatus, 'needs_review'))
    .orderBy(asc(events.startTime));

  return rows.map((r) => ({
    id: r.id,
    eventId: r.eventId,
    eventTitle: r.eventTitle,
    eventStartTime: r.eventStartTime,
    activityProfileId: r.activityProfileId,
    assignedMemberId: r.assignedMemberId,
    reviewReason: r.matchMeta?.reviewReason ?? null,
    profileCandidates: r.matchMeta?.profileCandidates ?? [],
    memberCandidates: r.matchMeta?.memberCandidates ?? [],
    identifiersFound: r.matchMeta?.identifiersFound ?? [],
  }));
}

export interface ReevaluateResult {
  link: typeof activityEventLinks.$inferSelect;
  /** False when the fresh result was "ignore" — nothing is applied rather than guessing what that should do to an existing row. */
  changed: boolean;
}

/**
 * Explicit, one-off reuse of the pure matcher against a single existing
 * link — e.g. after editing a profile's keywords or adding an identifier,
 * to see whether this one event would resolve differently now. Unlike
 * every other path in this file, this intentionally DOES touch an existing
 * row: it's a direct human request, not automatic matching, so the
 * "existing link row is never touched by automatic matching" invariant
 * doesn't apply here.
 */
export async function reevaluateMatch(linkId: string, executor: DbExecutor = db): Promise<ReevaluateResult | null> {
  const [row] = await executor
    .select({
      eventId: activityEventLinks.eventId,
      eventTitle: events.title,
      calendarGroupMemberId: calendarGroups.userId,
    })
    .from(activityEventLinks)
    .innerJoin(events, eq(activityEventLinks.eventId, events.id))
    .leftJoin(calendarSources, eq(events.calendarSourceId, calendarSources.id))
    .leftJoin(calendarGroups, and(eq(calendarSources.groupId, calendarGroups.id), eq(calendarGroups.type, 'user')))
    .where(eq(activityEventLinks.id, linkId));

  if (!row) return null;

  const [profiles, teamIdentifiers] = await Promise.all([
    listActivityProfiles({}, executor),
    loadTeamIdentifiers(executor),
  ]);
  const activeProfiles = profiles.map((p) => ({ id: p.id, name: p.name, matchKeywords: p.matchKeywords }));

  const result = matchEvent({
    title: row.eventTitle,
    activeProfiles,
    teamIdentifiers,
    calendarGroupMemberId: row.calendarGroupMemberId,
  });

  if (result.outcome === 'ignore') {
    const [existing] = await executor.select().from(activityEventLinks).where(eq(activityEventLinks.id, linkId));
    return { link: existing!, changed: false };
  }

  const updated = await updateActivityEventLink(
    linkId,
    {
      activityProfileId: result.profileId,
      assignedMemberId: result.memberId,
      matchStatus: result.matchStatus,
      matchMeta: {
        reviewReason: result.reviewReason,
        matchedPhrase: result.matchedPhrase,
        profileCandidates: result.profileCandidates,
        memberCandidates: result.memberCandidates,
        identifiersFound: result.identifiersFound,
      },
    },
    executor,
  );

  return { link: updated!, changed: true };
}
