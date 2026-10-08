/**
 * Phase 4B (Automatic Travel): computes one activity occurrence's driving
 * estimate. Pure with respect to the database — takes already-loaded
 * inputs and returns the ActivityTravelMeta to persist (or null when there
 * is nothing to compute), so it's testable without a DB and reusable from
 * both the batch cron recompute and the manual single-link refresh route.
 *
 * Precedence/skip rules this function enforces:
 *  - A manual travelMinutesOverride always wins at display time (see
 *    resolveEffectiveTravel), so a route is never even requested when one
 *    is set — never wastes a provider call on a value the UI won't use.
 *  - No destination text, or no departure (no override and no Home
 *    address configured) -> nothing to compute. Weekly Review detection
 *    flags these as their own issue types, not as a calculation failure.
 *  - An unresolved/ambiguous address on either side is a real attempted-
 *    and-failed calculation -> persisted as status 'unavailable' with a
 *    failureReason, carrying a text-only input hash so a later edit to
 *    that address is still detected even though no coordinate exists yet.
 *  - When the existing stored result's input hashes still match today's
 *    resolved addresses, is still 'ok', and is within REFRESH_INTERVAL_MS,
 *    the existing result is reused outright (no provider call at all) —
 *    this is the "bounded refresh" Phase 4B requires. `forceRefresh`
 *    (the manual refresh action) bypasses this reuse.
 */
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { geocodeAddress } from '@/lib/integrations/geocode';
import { getRoutingProvider } from '@/lib/integrations/routing';
import { resolveEffectiveLocation } from '@/lib/utils/activityWorkflowTiming';
import {
  hashTravelLocation,
  hashTravelText,
  isAmbiguousGeocodeMatch,
  resolveEffectiveTravel,
  type ActivityTravelSource,
} from '@/lib/utils/activityTravelResolution';
import { db, type DbExecutor } from '@/lib/db/client';
import { activityEventLinks, activityProfiles, events, users, type ActivityTravelMeta } from '@/lib/db/schema';
import { getHomeAddress } from '@/lib/services/homeAddress';

const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Same settled states the Activity Workflow widget shows — see activityWorkflow.ts. */
const SETTLED_MATCH_STATUSES = ['auto_confirmed', 'confirmed'] as const;

/** How far ahead the batch recompute looks — bounds provider usage; wider than Weekly Review's 7-day window so a result is already warm by the time that window reaches an event. */
export const ACTIVITY_TRAVEL_WINDOW_DAYS = 14;

export interface HomeAddressInput {
  address: string;
  lat: number;
  lon: number;
}

export interface ActivityTravelComputationInput {
  departureLocationOverride: string | null;
  travelMinutesOverride: number | null;
  locationOverride: string | null;
  eventLocation: string | null;
  profileDefaultLocation: string | null;
  home: HomeAddressInput | null;
  existingTravelMeta: ActivityTravelMeta | null;
  /** Bypasses the "reuse a still-fresh result" shortcut — used by the manual refresh action. */
  forceRefresh?: boolean;
}

type ResolvedLocation = { address: string; lat: number; lon: number };
type LocationResolution = { ok: true; location: ResolvedLocation } | { ok: false; failureReason: string };

async function resolveLocationText(text: string): Promise<LocationResolution> {
  const candidates = await geocodeAddress(text, 3);
  if (candidates.length === 0) return { ok: false, failureReason: 'geocode_failed' };
  if (isAmbiguousGeocodeMatch(candidates)) return { ok: false, failureReason: 'ambiguous_address' };
  const top = candidates[0]!;
  return { ok: true, location: { address: text, lat: top.latitude, lon: top.longitude } };
}

function failureMeta(failureReason: string, departureInputHash: string, destinationInputHash: string): ActivityTravelMeta {
  return {
    status: 'unavailable',
    minutes: null,
    provider: 'none',
    calculatedAt: new Date().toISOString(),
    distanceMeters: null,
    durationSeconds: null,
    departureInputHash,
    destinationInputHash,
    failureReason,
  };
}

/**
 * Computes the travel_meta to persist for one occurrence, or null when
 * there is nothing meaningful to compute (manual override set, or an
 * input required even to attempt a calculation is missing entirely).
 */
export async function computeActivityTravel(input: ActivityTravelComputationInput): Promise<ActivityTravelMeta | null> {
  if (input.travelMinutesOverride !== null && input.travelMinutesOverride !== undefined) {
    return null;
  }

  const destinationText = resolveEffectiveLocation(input.locationOverride, input.eventLocation, input.profileDefaultLocation);
  if (!destinationText) return null;

  const departureOverrideText = input.departureLocationOverride?.trim() || null;
  if (!departureOverrideText && !input.home) return null;

  const departureResolution: LocationResolution = departureOverrideText
    ? await resolveLocationText(departureOverrideText)
    : { ok: true, location: { address: input.home!.address, lat: input.home!.lat, lon: input.home!.lon } };

  const destinationInputHashFallback = hashTravelText(destinationText);

  if (!departureResolution.ok) {
    const departureInputHash = hashTravelText(departureOverrideText ?? input.home!.address);
    return failureMeta(`departure_${departureResolution.failureReason}`, departureInputHash, destinationInputHashFallback);
  }

  const departureHash = hashTravelLocation(departureResolution.location);
  const destinationResolution = await resolveLocationText(destinationText);

  if (!destinationResolution.ok) {
    return failureMeta(`destination_${destinationResolution.failureReason}`, departureHash, destinationInputHashFallback);
  }

  const destinationHash = hashTravelLocation(destinationResolution.location);

  const existing = input.existingTravelMeta;
  const hashesMatch = existing?.departureInputHash === departureHash && existing?.destinationInputHash === destinationHash;
  const isFresh =
    !!existing &&
    existing.status === 'ok' &&
    hashesMatch &&
    Date.now() - new Date(existing.calculatedAt).getTime() < REFRESH_INTERVAL_MS;

  if (isFresh && !input.forceRefresh) {
    return existing;
  }

  const provider = getRoutingProvider();
  const outcome = await provider.getDrivingRoute(
    { lat: departureResolution.location.lat, lon: departureResolution.location.lon },
    { lat: destinationResolution.location.lat, lon: destinationResolution.location.lon },
  );

  if (outcome.status !== 'ok' || !outcome.route) {
    return {
      status: 'unavailable',
      minutes: null,
      provider: provider.name,
      calculatedAt: new Date().toISOString(),
      distanceMeters: null,
      durationSeconds: null,
      departureInputHash: departureHash,
      destinationInputHash: destinationHash,
      failureReason: outcome.failureReason ?? 'provider_error',
    };
  }

  return {
    status: 'ok',
    minutes: Math.round(outcome.route.durationSeconds / 60),
    provider: provider.name,
    calculatedAt: new Date().toISOString(),
    distanceMeters: outcome.route.distanceMeters,
    durationSeconds: outcome.route.durationSeconds,
    departureInputHash: departureHash,
    destinationInputHash: destinationHash,
    failureReason: null,
  };
}

interface TravelCandidateRow {
  linkId: string;
  departureLocationOverride: string | null;
  travelMinutesOverride: number | null;
  locationOverride: string | null;
  travelMeta: ActivityTravelMeta | null;
  eventLocation: string | null;
  profileDefaultLocation: string | null;
}

async function loadTravelCandidates(
  executor: DbExecutor,
  from: Date,
  to: Date,
): Promise<TravelCandidateRow[]> {
  const rows = await executor
    .select({
      linkId: activityEventLinks.id,
      departureLocationOverride: activityEventLinks.departureLocationOverride,
      travelMinutesOverride: activityEventLinks.travelMinutesOverride,
      locationOverride: activityEventLinks.locationOverride,
      travelMeta: activityEventLinks.travelMeta,
      eventLocation: events.location,
      profileDefaultLocation: activityProfiles.defaultLocation,
    })
    .from(activityEventLinks)
    .innerJoin(events, eq(activityEventLinks.eventId, events.id))
    .leftJoin(activityProfiles, eq(activityEventLinks.activityProfileId, activityProfiles.id))
    .where(
      and(
        inArray(activityEventLinks.matchStatus, SETTLED_MATCH_STATUSES),
        gte(events.startTime, from),
        lt(events.startTime, to),
      ),
    );

  return rows.map((r) => ({ ...r, profileDefaultLocation: r.profileDefaultLocation ?? null }));
}

export interface ActivityTravelBatchSummary {
  scanned: number;
  calculated: number;
  reused: number;
  skipped: number;
  failed: number;
}

/**
 * Recomputes travel estimates for every settled, upcoming (within
 * ACTIVITY_TRAVEL_WINDOW_DAYS) activity occurrence. Hooked into the
 * calendar sync cron — see calendarSyncCron.ts — rather than any
 * dashboard-visible polling, so routing requests only ever originate from
 * a bounded, server-side schedule (never from a countdown tick).
 */
export async function recomputeActivityTravelForUpcoming(
  executor: DbExecutor = db,
  now: Date = new Date(),
): Promise<ActivityTravelBatchSummary> {
  const to = new Date(now.getTime() + ACTIVITY_TRAVEL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await loadTravelCandidates(executor, now, to);

  const summary: ActivityTravelBatchSummary = { scanned: rows.length, calculated: 0, reused: 0, skipped: 0, failed: 0 };
  if (rows.length === 0) return summary;

  const home = await getHomeAddress(executor);

  for (const row of rows) {
    const result = await computeActivityTravel({
      departureLocationOverride: row.departureLocationOverride,
      travelMinutesOverride: row.travelMinutesOverride,
      locationOverride: row.locationOverride,
      eventLocation: row.eventLocation,
      profileDefaultLocation: row.profileDefaultLocation,
      home,
      existingTravelMeta: row.travelMeta,
    });

    if (result === null) {
      summary.skipped += 1;
      continue;
    }
    if (result === row.travelMeta) {
      summary.reused += 1;
      continue;
    }
    if (result.status === 'unavailable') {
      summary.failed += 1;
    } else {
      summary.calculated += 1;
    }

    await executor
      .update(activityEventLinks)
      .set({ travelMeta: result, updatedAt: new Date() })
      .where(eq(activityEventLinks.id, row.linkId));
  }

  return summary;
}

export interface ActivityTravelRefreshResult {
  /** False when no link with this id exists — distinct from a link existing with nothing to compute. */
  found: boolean;
  travelMeta: ActivityTravelMeta | null;
}

/**
 * Recomputes the travel estimate for exactly one activity link, bypassing
 * the "still fresh" reuse shortcut — the parent-triggered manual refresh
 * action (see /api/activity-matching/links/[id]/refresh-travel) always
 * wants a new attempt, even if the stored result looks current.
 */
export async function recomputeActivityTravelForLink(
  linkId: string,
  executor: DbExecutor = db,
): Promise<ActivityTravelRefreshResult> {
  const [row] = await executor
    .select({
      departureLocationOverride: activityEventLinks.departureLocationOverride,
      travelMinutesOverride: activityEventLinks.travelMinutesOverride,
      locationOverride: activityEventLinks.locationOverride,
      travelMeta: activityEventLinks.travelMeta,
      eventLocation: events.location,
      profileDefaultLocation: activityProfiles.defaultLocation,
    })
    .from(activityEventLinks)
    .innerJoin(events, eq(activityEventLinks.eventId, events.id))
    .leftJoin(activityProfiles, eq(activityEventLinks.activityProfileId, activityProfiles.id))
    .where(eq(activityEventLinks.id, linkId));

  if (!row) return { found: false, travelMeta: null };

  const home = await getHomeAddress(executor);
  const result = await computeActivityTravel({
    departureLocationOverride: row.departureLocationOverride,
    travelMinutesOverride: row.travelMinutesOverride,
    locationOverride: row.locationOverride,
    eventLocation: row.eventLocation,
    profileDefaultLocation: row.profileDefaultLocation ?? null,
    home,
    existingTravelMeta: row.travelMeta,
    forceRefresh: true,
  });

  if (result !== null && result !== row.travelMeta) {
    await executor
      .update(activityEventLinks)
      .set({ travelMeta: result, updatedAt: new Date() })
      .where(eq(activityEventLinks.id, linkId));
  }

  return { found: true, travelMeta: result };
}

export interface ActivityTravelListItem {
  linkId: string;
  eventId: string;
  eventTitle: string;
  eventStart: Date;
  memberName: string | null;
  /** Effective destination text (locationOverride -> event.location -> profile.defaultLocation -> null). */
  destination: string | null;
  /** Raw per-event departure override, if any — null means "depart from Home". */
  departureLocationOverride: string | null;
  travelMinutesOverride: number | null;
  travelMeta: ActivityTravelMeta | null;
  travelSource: ActivityTravelSource;
  travelMinutes: number | null;
}

/**
 * Lists every settled, upcoming activity occurrence with its travel
 * configuration — the data source for the Activity Profiles settings
 * panel where a parent can set a per-event departure override or trigger
 * a manual refresh. Read-only; never computes or writes anything.
 */
export async function listUpcomingActivityTravel(
  executor: DbExecutor = db,
  now: Date = new Date(),
  windowDays: number = ACTIVITY_TRAVEL_WINDOW_DAYS,
): Promise<ActivityTravelListItem[]> {
  const to = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

  const rows = await executor
    .select({
      linkId: activityEventLinks.id,
      departureLocationOverride: activityEventLinks.departureLocationOverride,
      travelMinutesOverride: activityEventLinks.travelMinutesOverride,
      locationOverride: activityEventLinks.locationOverride,
      travelMeta: activityEventLinks.travelMeta,
      eventId: events.id,
      eventTitle: events.title,
      eventLocation: events.location,
      eventStart: events.startTime,
      memberName: users.name,
      profileTravelMinutes: activityProfiles.travelMinutes,
      profileDefaultLocation: activityProfiles.defaultLocation,
    })
    .from(activityEventLinks)
    .innerJoin(events, eq(activityEventLinks.eventId, events.id))
    .leftJoin(activityProfiles, eq(activityEventLinks.activityProfileId, activityProfiles.id))
    .leftJoin(users, eq(activityEventLinks.assignedMemberId, users.id))
    .where(
      and(
        inArray(activityEventLinks.matchStatus, SETTLED_MATCH_STATUSES),
        gte(events.startTime, now),
        lt(events.startTime, to),
      ),
    )
    .orderBy(asc(events.startTime));

  return rows.map((r) => {
    const destination = resolveEffectiveLocation(r.locationOverride, r.eventLocation, r.profileDefaultLocation ?? null);
    const travel = resolveEffectiveTravel({
      travelMinutesOverride: r.travelMinutesOverride,
      calculation: r.travelMeta,
      currentDepartureInputHash: r.travelMeta?.departureInputHash ?? null,
      currentDestinationInputHash: r.travelMeta?.destinationInputHash ?? null,
      profileTravelMinutes: r.profileTravelMinutes ?? null,
    });

    return {
      linkId: r.linkId,
      eventId: r.eventId,
      eventTitle: r.eventTitle,
      eventStart: r.eventStart,
      memberName: r.memberName,
      destination,
      departureLocationOverride: r.departureLocationOverride,
      travelMinutesOverride: r.travelMinutesOverride,
      travelMeta: r.travelMeta,
      travelSource: travel.source,
      travelMinutes: travel.minutes,
    };
  });
}

/**
 * Sets (or clears, with null) the per-event departure override. Never
 * touches the Home address setting — this is purely a per-event column —
 * and never geocodes or validates the text itself; that happens the next
 * time travel is computed for this link (see computeActivityTravel),
 * which the caller typically triggers immediately afterward via
 * recomputeActivityTravelForLink(linkId) so the UI reflects the change
 * without waiting for the next cron tick.
 */
export async function setActivityDepartureOverride(
  linkId: string,
  departureLocationOverride: string | null,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .update(activityEventLinks)
    .set({ departureLocationOverride, updatedAt: new Date() })
    .where(eq(activityEventLinks.id, linkId));
}
