/**
 * Confidence evaluation for venue geocode candidates — the piece that fixes
 * the actual root cause behind "almost all hockey/soccer locations fail
 * automatic geocoding": isAmbiguousGeocodeMatch (activityTravelResolution.ts,
 * left untouched — it still governs plain departure/destination address
 * resolution) treats Nominatim's `importance` score as a confidence proxy.
 * Importance reflects global notability, not correctness: a small local
 * arena is a real, uniquely-identified place that Nominatim is fully
 * capable of finding, but it will always score low importance next to a
 * national landmark, so the 0.3 floor rejects it outright even when it's
 * the only candidate returned.
 *
 * This module's rule: when a search returns exactly one candidate, that's
 * itself the confidence signal — there's nothing else it could be. When it
 * returns several, prefer the one nearest the household's own bias point
 * (its Home, or wherever the caller is biasing this particular search)
 * whenever one candidate is clearly closer than the rest; this handles the
 * common case of a generically-named venue ("Community Arena") that
 * matches multiple real places across the globe, where only one is
 * anywhere near the household. Only when neither signal resolves it does
 * this fall back to the existing importance heuristic.
 *
 * Proximity here is a ranking/tie-breaker signal among candidates for the
 * *same* search, never an absolute "too far from home" rejection — a
 * household's away games can legitimately be hundreds of kilometers out.
 * The absolute plausibility bound on a resolved departure/destination pair
 * is a separate, later gate (MAX_PLAUSIBLE_ACTIVITY_DISTANCE_METERS in
 * activityTravelResolution.ts).
 *
 * A real street address commonly comes back from Nominatim as a mix of a
 * road/highway segment match (the street itself) and a building/POI/
 * address-point match (an actual place on that street) — e.g. a soccer
 * facility's own street address resolving to both "Sandford Fleming Dr"
 * (class: highway) and the specific building at that address (class:
 * building/amenity/place). These are not two competing real-world
 * destinations; the road segment is noise a destination search should
 * never be resolving to. Candidates are filtered down to the non-road
 * ones (when at least one exists) *before* the proximity/importance
 * checks below — this is a real signal Nominatim already returns
 * (GeocodeResult.class/type) that was previously computed and discarded.
 */
import type { GeocodeResult } from '@/lib/integrations/geocode';
import { type GeoPoint, haversineDistanceMeters, isAmbiguousGeocodeMatch } from './activityTravelResolution';

export type VenueConfidenceReason =
  | 'unique_match'
  | 'proximity_confident'
  | 'importance_confident'
  | 'no_candidates'
  | 'ambiguous';

export interface VenueConfidenceResult {
  accepted: GeocodeResult | null;
  reason: VenueConfidenceReason;
}

/**
 * How much closer (in meters) the nearest candidate must be than the next
 * nearest, to the bias point, before proximity alone is trusted to pick it.
 * Two genuinely distinct real-world venues matching the same search text
 * are essentially never this close together; two Nominatim entries for the
 * *same* physical venue (duplicate OSM data) typically are, so a small gap
 * correctly falls through to the importance heuristic instead of guessing.
 */
const MIN_PROXIMITY_GAP_METERS = 2000;

function distanceTo(bias: GeoPoint, candidate: GeocodeResult): number {
  return haversineDistanceMeters(bias, { lat: candidate.latitude, lon: candidate.longitude });
}

/** Nominatim's `class` for a plain road/street-segment match, never itself a destination. */
function isRoadSegment(candidate: GeocodeResult): boolean {
  return candidate.class === 'highway';
}

/**
 * Decides whether a set of geocode candidates for one search query can be
 * auto-accepted, and which one. Never picks a candidate when the result is
 * ambiguous — callers must treat `accepted: null` as "try the next
 * progressive-search query" or "give up and surface for review," never as
 * license to guess.
 */
export function evaluateVenueCandidates(candidates: GeocodeResult[], bias?: GeoPoint): VenueConfidenceResult {
  if (candidates.length === 0) return { accepted: null, reason: 'no_candidates' };
  if (candidates.length === 1) return { accepted: candidates[0] as GeocodeResult, reason: 'unique_match' };

  const places = candidates.filter((c) => !isRoadSegment(c));
  if (places.length > 0 && places.length < candidates.length) {
    return evaluateVenueCandidates(places, bias);
  }

  if (bias) {
    const byDistance = [...candidates].sort((a, b) => distanceTo(bias, a) - distanceTo(bias, b));
    const nearest = byDistance[0] as GeocodeResult;
    const second = byDistance[1];
    if (second && distanceTo(bias, second) - distanceTo(bias, nearest) >= MIN_PROXIMITY_GAP_METERS) {
      return { accepted: nearest, reason: 'proximity_confident' };
    }
  }

  if (!isAmbiguousGeocodeMatch(candidates)) {
    const byImportance = [...candidates].sort((a, b) => b.importance - a.importance);
    return { accepted: byImportance[0] as GeocodeResult, reason: 'importance_confident' };
  }

  return { accepted: null, reason: 'ambiguous' };
}
