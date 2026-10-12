/**
 * Optional Google Places Text Search fallback for venue destination
 * resolution. This is the LAST stage tried in resolveVenueDestination
 * (activityVenues.ts), only reached when the saved venue directory has
 * nothing and every free Nominatim-based progressive-search query (see
 * buildSearchQueries) has already failed or come back ambiguous.
 *
 * Disabled by default: with no GOOGLE_PLACES_API_KEY configured,
 * isGooglePlacesConfigured() returns false and this module is never
 * called — no accidental cost, no silent dependency on a paid API for a
 * feature that otherwise works entirely for free via OpenStreetMap.
 *
 * Cost controls, per the requirement that this stay a deliberately-chosen,
 * bounded-cost integration rather than an uncapped one:
 *  - A conservative daily request cap (GOOGLE_PLACES_DAILY_LIMIT, default
 *    DEFAULT_DAILY_LIMIT) enforced via the same Redis-backed
 *    checkRateLimit every other optional external integration in Prism
 *    uses (see openRouteService.ts). Once a household's venue directory
 *    is populated, nearly every lookup resolves from the saved-venue stage
 *    with zero calls of any kind — this cap bounds cold-start/away-game
 *    lookups, not steady-state traffic.
 *  - Results are cached for CACHE_TTL_SECONDS: a venue's coordinates don't
 *    move, so an identical query is never billed twice within the cache
 *    window. This only caches for Prism's own internal deduplication of
 *    repeated lookups by its own users — it never redistributes Places
 *    data to third parties and stores nothing beyond the name/address/
 *    coordinates needed to geocode a destination, consistent with
 *    Google's Maps Platform terms on caching for your own application.
 */
import { getCached } from '@/lib/cache/redis';
import { checkRateLimit } from '@/lib/cache/rateLimit';
import { logError } from '@/lib/utils/logError';
import type { GeocodeBias, GeocodeResult } from './geocode';

const TEXT_SEARCH_ENDPOINT = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h — same convention as geocode.ts's Nominatim cache.
const RATE_LIMIT_SCOPE = 'system';
const DEFAULT_DAILY_LIMIT = 100;
const MAX_RESULTS = 3;

// Text Search's location+radius params are a soft ranking preference, not
// a hard filter — same role as Nominatim's viewbox bias in geocode.ts, so
// a genuinely correct away-game venue outside this radius is still findable.
const BIAS_RADIUS_METERS = 50_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Google Places request timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** True only when a server-side API key is configured — otherwise this integration is entirely inert. */
export function isGooglePlacesConfigured(): boolean {
  return !!process.env.GOOGLE_PLACES_API_KEY;
}

function dailyLimit(): number {
  const configured = Number(process.env.GOOGLE_PLACES_DAILY_LIMIT);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DAILY_LIMIT;
}

interface GooglePlacesResultItem {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  /** 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY' — a permanently-closed place must never become a destination. */
  business_status?: string;
}

interface GooglePlacesResponse {
  status: string;
  results?: GooglePlacesResultItem[];
}

async function fetchGooglePlaces(query: string, apiKey: string, bias?: GeocodeBias): Promise<GeocodeResult[]> {
  const url = new URL(TEXT_SEARCH_ENDPOINT);
  url.searchParams.set('query', query);
  url.searchParams.set('key', apiKey);
  if (bias) {
    url.searchParams.set('location', `${bias.lat},${bias.lon}`);
    url.searchParams.set('radius', String(BIAS_RADIUS_METERS));
  }

  const response = await withTimeout(fetch(url.toString()), REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`Google Places returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as GooglePlacesResponse;
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places returned status ${data.status}`);
  }

  const results: GeocodeResult[] = [];
  for (const [index, item] of (data.results ?? []).slice(0, MAX_RESULTS).entries()) {
    const lat = item.geometry?.location?.lat;
    const lon = item.geometry?.location?.lng;
    if (lat === undefined || lon === undefined || !item.name) continue;
    if (item.business_status === 'CLOSED_PERMANENTLY') continue;
    results.push({
      placeId: index,
      displayName: item.name,
      fullName: item.formatted_address ?? item.name,
      latitude: lat,
      longitude: lon,
      // Text Search gives no numeric relevance score — this is a
      // synthetic, rank-derived stand-in so the shared confidence
      // heuristic (evaluateVenueCandidates) still has a fallback signal
      // when proximity-to-bias alone can't disambiguate several results.
      // The common single-result case never consults it at all.
      importance: Math.max(0.05, 0.5 - index * 0.15),
    });
  }
  return results;
}

/**
 * Looks up `query` against Google Places Text Search. Returns [] when not
 * configured, for a too-short query, once the daily cap is reached, a
 * genuinely zero-result lookup, or on any provider/network failure — never
 * throws, same contract as geocodeAddress.
 */
export async function searchGooglePlaces(query: string, bias?: GeocodeBias): Promise<GeocodeResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const dayLimit = await checkRateLimit(RATE_LIMIT_SCOPE, 'google-places:day', dailyLimit(), 60 * 60 * 24);
  if (!dayLimit.allowed) {
    logError('Google Places daily request cap reached', new Error('google_places_rate_limited'));
    return [];
  }

  const biasKey = bias ? `:bias=${bias.lat.toFixed(2)},${bias.lon.toFixed(2)}` : '';
  const cacheKey = `places:v1:${trimmed.toLowerCase()}${biasKey}`;

  try {
    return await getCached(cacheKey, () => fetchGooglePlaces(trimmed, apiKey, bias), CACHE_TTL_SECONDS);
  } catch (error) {
    logError('Error searching Google Places:', error);
    return [];
  }
}
