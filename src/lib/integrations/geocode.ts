/**
 * Shared Nominatim (OpenStreetMap) geocoding primitive — "turn free-text
 * into ranked candidate locations with coordinates". Used by the Travel
 * globe's place search and by Phase 4B's Home-address / per-event
 * departure / destination resolution for Automatic Travel.
 *
 * Query-specific behavior (the Travel search's colloquial-name aliases and
 * its national-park result reordering) stays in that route, not here —
 * this module only does the Nominatim call, parsing, and caching that both
 * callers need identically. `class`/`type` are passed through unparsed so
 * a caller that needs Nominatim's own categorization (as the Travel route
 * does) still can, without this module guessing what every caller wants.
 *
 * Nominatim's usage policy asks heavy callers to cache results rather than
 * re-querying identical strings — results are cached for 24h (an address's
 * coordinates don't move); a failed/timed-out lookup is never cached, so a
 * transient outage doesn't "stick" for the full TTL.
 */
import { getCached } from '@/lib/cache/redis';
import { logError } from '@/lib/utils/logError';

export interface GeocodeResult {
  placeId: number;
  displayName: string;
  fullName: string;
  latitude: number;
  longitude: number;
  /** Nominatim's relevance score (0-1ish); used to detect ambiguous matches. */
  importance: number;
  class?: string;
  type?: string;
}

interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    house_number?: string;
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    municipality?: string;
    island?: string;
    archipelago?: string;
    state?: string;
    country?: string;
    country_code?: string;
  };
  class?: string;
  type?: string;
  importance?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Geocoding request timed out')), ms)),
  ]);
}

function shortDisplayName(result: NominatimResult): string {
  const a = result.address || {};
  const streetPart = [a.house_number, a.road].filter(Boolean).join(' ');
  const place = a.city || a.town || a.village || a.county || a.municipality || a.island || a.archipelago;
  const parts = [streetPart || place, a.state, a.country].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  return result.display_name.split(',').slice(0, 3).join(',').trim();
}

const GEOCODE_TIMEOUT_MS = 8000;
const GEOCODE_CACHE_TTL_SECONDS = 60 * 60 * 24;

async function fetchGeocodeResults(query: string, limit: number): Promise<GeocodeResult[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', String(limit));

  const response = await withTimeout(
    fetch(url.toString(), {
      headers: {
        'User-Agent': 'Prism-Family-Dashboard/1.0 (https://github.com/sandydargoport/prism)',
        'Accept-Language': 'en',
      },
    }),
    GEOCODE_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Nominatim returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error('Nominatim returned an unexpected response shape');
  }

  return (data as NominatimResult[])
    .map((item) => ({
      placeId: item.place_id,
      displayName: shortDisplayName(item),
      fullName: item.display_name,
      latitude: parseFloat(item.lat),
      longitude: parseFloat(item.lon),
      importance: item.importance ?? 0,
      class: item.class,
      type: item.type,
    }))
    .filter(
      (r) =>
        Number.isFinite(r.latitude) && Number.isFinite(r.longitude) &&
        r.latitude >= -90 && r.latitude <= 90 &&
        r.longitude >= -180 && r.longitude <= 180,
    );
}

/**
 * Looks up `query` against Nominatim and returns ranked candidates. Returns
 * [] for a too-short query, a genuinely zero-result lookup, or on any
 * provider/network failure (never throws) — callers that need to tell
 * "no results" apart from "lookup failed" should treat both the same way
 * Prism already does elsewhere for optional integrations: don't block on it,
 * but don't silently invent a location either.
 */
export async function geocodeAddress(query: string, limit = 5): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const cacheKey = `geocode:v1:${trimmed.toLowerCase()}:${limit}`;

  try {
    return await getCached(cacheKey, () => fetchGeocodeResults(trimmed, limit), GEOCODE_CACHE_TTL_SECONDS);
  } catch (error) {
    logError('Error geocoding address:', error);
    return [];
  }
}
