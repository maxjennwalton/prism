/**
 * Pure logic for the Sports & Activity Assistant, Phase 4B (Automatic
 * Travel): effective-travel-time precedence, staleness detection, and the
 * geocode ambiguity heuristic. Kept separate from activityWorkflowTiming.ts
 * (which owns the timeline/milestone arithmetic) because this module's
 * inputs are about *which number to trust*, not how to lay out a schedule
 * from one.
 *
 * Same NULL vs 0 rule as the rest of Activity Profiles: every nullish check
 * below is `!== null && !== undefined` (or `??`), never a truthiness check,
 * because an explicitly configured zero (zero travel minutes, zero gap
 * between two importance scores) is real data, not "unset".
 */
import { createHash } from 'crypto';

/**
 * The four possible origins of an effective travel-time estimate, in
 * precedence order. Exactly one of these is ever active at a time.
 */
export type ActivityTravelSource = 'manual_override' | 'calculated' | 'profile_fallback' | 'unavailable';

export interface ActivityEffectiveTravel {
  minutes: number | null;
  source: ActivityTravelSource;
}

/** Required display label per source — exact strings, not descriptions. */
const TRAVEL_SOURCE_LABELS: Record<ActivityTravelSource, string> = {
  calculated: 'Calculated driving estimate',
  manual_override: 'Manual override',
  profile_fallback: 'Profile fallback',
  unavailable: 'Travel time needed',
};

export function travelSourceLabel(source: ActivityTravelSource): string {
  return TRAVEL_SOURCE_LABELS[source];
}

/**
 * The subset of a persisted travel_meta row that resolution needs. Defined
 * locally (rather than importing ActivityTravelMeta from db/schema.ts) so
 * this stays a pure, DB-free module — same pattern activityWorkflowTiming.ts
 * already uses for its own override/profile-default input shapes.
 */
export interface ActivityTravelCalculation {
  status: 'ok' | 'unavailable';
  minutes: number | null;
  departureInputHash: string;
  destinationInputHash: string;
}

export interface ResolveEffectiveTravelParams {
  /** NULL/undefined = no manual override; 0 is a real, explicit override. */
  travelMinutesOverride: number | null | undefined;
  /** The last persisted calculation result, if any. */
  calculation: ActivityTravelCalculation | null | undefined;
  /** Today's resolved departure input hash — what the calculation would be computed from right now. */
  currentDepartureInputHash: string | null | undefined;
  /** Today's resolved destination input hash. */
  currentDestinationInputHash: string | null | undefined;
  /** NULL/undefined = profile does not configure a fallback; 0 is a real, explicit fallback. */
  profileTravelMinutes: number | null | undefined;
}

/**
 * Resolves the effective travel time using the required precedence:
 *   (a) manual per-event override (including an explicit zero)
 *   (b) a fresh, successful calculated route — "fresh" meaning its stored
 *       input hashes still match what Home/departure-override/destination
 *       resolve to right now; a stale result is never surfaced as current
 *   (c) the Activity Profile's fallback travelMinutes, only when the
 *       profile explicitly configures one
 *   (d) unavailable — never fabricated
 */
export function resolveEffectiveTravel(params: ResolveEffectiveTravelParams): ActivityEffectiveTravel {
  const {
    travelMinutesOverride,
    calculation,
    currentDepartureInputHash,
    currentDestinationInputHash,
    profileTravelMinutes,
  } = params;

  if (travelMinutesOverride !== null && travelMinutesOverride !== undefined) {
    return { minutes: travelMinutesOverride, source: 'manual_override' };
  }

  if (
    calculation &&
    calculation.status === 'ok' &&
    calculation.minutes !== null &&
    currentDepartureInputHash != null &&
    currentDestinationInputHash != null &&
    calculation.departureInputHash === currentDepartureInputHash &&
    calculation.destinationInputHash === currentDestinationInputHash
  ) {
    return { minutes: calculation.minutes, source: 'calculated' };
  }

  if (profileTravelMinutes !== null && profileTravelMinutes !== undefined) {
    return { minutes: profileTravelMinutes, source: 'profile_fallback' };
  }

  return { minutes: null, source: 'unavailable' };
}

/**
 * Departure-location precedence: a per-event departureLocationOverride wins
 * when set; otherwise the household's default Home address; otherwise null
 * (never invents a departure point). Mirrors activityWorkflowTiming.ts's
 * resolveEffectiveLocation shape for the destination side.
 */
export function resolveEffectiveDeparture(
  departureLocationOverride: string | null | undefined,
  homeAddress: string | null | undefined,
): string | null {
  const override = departureLocationOverride?.trim();
  if (override) return override;
  const home = homeAddress?.trim();
  if (home) return home;
  return null;
}

/** The resolved identity (geocoded coordinates + the text that produced them) a route was calculated from. */
export interface TravelLocationIdentity {
  address: string;
  lat: number;
  lon: number;
}

/**
 * Fingerprints a resolved location so a later change to the address or its
 * geocoded coordinates can be detected (hash no longer matches) without
 * storing the address/coordinates themselves as a separate "is this stale"
 * flag that would need to be kept in sync by hand. Coordinates are rounded
 * to ~0.11m precision (6 decimal places) before hashing so float-formatting
 * noise from the geocoder never causes a spurious mismatch.
 */
export function hashTravelLocation(identity: TravelLocationIdentity): string {
  const canonical = `${identity.address.trim().toLowerCase()}|${identity.lat.toFixed(6)}|${identity.lon.toFixed(6)}`;
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Fingerprints raw input text alone, with no coordinates — used when a
 * geocode attempt fails or comes back ambiguous, so there is still
 * something to detect "the configured address text itself changed since"
 * even though no coordinate was ever resolved for it.
 */
export function hashTravelText(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two points, in meters. Used as a sanity
 * gate before ever calling a routing provider — a resolved departure/
 * destination pair whose straight-line distance is already implausible
 * for a local activity means one side's geocode almost certainly resolved
 * to the wrong place, and no routing provider call should be spent
 * confirming that (OpenRouteService's own distance limit — 6,000,000 m —
 * is what actually surfaces this today, as an HTTP 400 after the request
 * has already been wasted).
 */
export function haversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Generous upper bound for a single local/regional activity's one-way
 * drive — well under OpenRouteService's own 6,000,000 m hard limit, so
 * this gate always fires first and produces a specific, actionable
 * failureReason instead of a opaque provider HTTP error. Not tied to any
 * specific region or household; it's a plausibility bound on "a kid's
 * activity," not a geographic boundary.
 */
export const MAX_PLAUSIBLE_ACTIVITY_DISTANCE_METERS = 300_000;

export interface GeocodeCandidate {
  importance: number;
}

const MIN_CONFIDENT_IMPORTANCE = 0.3;
const AMBIGUOUS_IMPORTANCE_GAP = 0.05;

/**
 * Nominatim ambiguity heuristic: safe to auto-route to a geocode result
 * only when there is one clear, confident match. Ambiguous when there are
 * no candidates, the top candidate's importance is too low to trust at all,
 * or the top two candidates are close enough in importance that picking
 * either would be a guess.
 */
export function isAmbiguousGeocodeMatch(candidates: GeocodeCandidate[]): boolean {
  const sorted = [...candidates].sort((a, b) => b.importance - a.importance);
  const top = sorted[0];
  if (!top) return true;
  if (top.importance < MIN_CONFIDENT_IMPORTANCE) return true;
  const second = sorted[1];
  if (second && top.importance - second.importance < AMBIGUOUS_IMPORTANCE_GAP) return true;
  return false;
}
