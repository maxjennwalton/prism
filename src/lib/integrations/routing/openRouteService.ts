/**
 * OpenRouteService (via HeiGIT, the current host after ORS's 2024 move off
 * api.openrouteservice.org) driving-car routing provider.
 *
 * Endpoint: https://api.heigit.org/openrouteservice/v2/directions/driving-car/json
 * Request:  POST { "coordinates": [[lon, lat], [lon, lat]] } — longitude
 *           first, and as numbers (sending strings is a documented
 *           source of silent failures).
 * Auth:     "Authorization: <raw API key>" — NOT "Bearer <key>".
 * Response: { routes: [ { summary: { distance, duration }, segments: [...] } ], bbox, metadata }
 *           `summary` can come back as an empty object `{}` when the
 *           origin and destination resolve to the same point — that is a
 *           legitimate zero-distance/zero-duration route, not a parse
 *           failure, so it's handled explicitly rather than falling into
 *           the "invalid response" branch.
 *
 * These are typical driving-time estimates from the routing graph, not
 * live traffic — Phase 4B never claims otherwise in any display string.
 */
import { getCached } from '@/lib/cache/redis';
import { checkRateLimit } from '@/lib/cache/rateLimit';
import { logError } from '@/lib/utils/logError';
import type { RoutingCoordinate, RouteOutcome, RoutingProvider } from './types';

const ORS_ENDPOINT = 'https://api.heigit.org/openrouteservice/v2/directions/driving-car/json';
const REQUEST_TIMEOUT_MS = 10_000;
const ROUTE_CACHE_TTL_SECONDS = 60 * 60; // 1h — dedupes bursts; the persisted travel_meta row is the long-lived cache.

// Free-tier ORS limits are ~40 requests/minute and ~2000/day; stay safely
// under both so Prism never trips the provider's own rate limiting.
const RATE_LIMIT_SCOPE = 'system';
const MAX_PER_MINUTE = 30;
const MAX_PER_DAY = 1500;

// Bounds how much of ORS's own error body we ever log — plenty for its
// structured { error: { code, message } } payloads, small enough to never
// balloon logs. ORS error bodies describe the request it received (e.g.
// "could not find routable point"), never the Authorization header, so
// this is safe to log in full up to the cap.
const MAX_ERROR_BODY_CHARS = 500;

interface OrsSummary {
  distance?: number;
  duration?: number;
}

interface OrsResponse {
  routes?: Array<{ summary?: OrsSummary }>;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Routing request timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function roundCoord(n: number): number {
  // ~11m precision — enough to dedupe repeated calls for the same
  // addresses without caching across genuinely different locations.
  return Math.round(n * 10000) / 10000;
}

/** Best-effort read of a non-OK response's body for diagnostics; never throws. */
async function safeReadErrorBody(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    return text ? text.slice(0, MAX_ERROR_BODY_CHARS) : null;
  } catch {
    return null;
  }
}

async function callOrs(origin: RoutingCoordinate, destination: RoutingCoordinate, apiKey: string): Promise<RouteOutcome> {
  try {
    const response = await withTimeout(
      fetch(ORS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coordinates: [
            [origin.lon, origin.lat],
            [destination.lon, destination.lat],
          ],
        }),
      }),
      REQUEST_TIMEOUT_MS,
    );

    if (!response.ok) {
      const body = await safeReadErrorBody(response);
      logError('OpenRouteService returned an error status', new Error(`HTTP ${response.status}${body ? `: ${body}` : ''}`));
      return { status: 'unavailable', route: null, failureReason: 'provider_error' };
    }

    const data = (await response.json()) as OrsResponse;
    const summary = data.routes?.[0]?.summary;

    if (!summary) {
      return { status: 'unavailable', route: null, failureReason: 'invalid_response' };
    }

    // An empty `{}` summary (origin === destination) is a real zero-length
    // route, not a missing one — distance/duration default to 0.
    const distanceMeters = summary.distance ?? 0;
    const durationSeconds = summary.duration ?? 0;

    if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) {
      return { status: 'unavailable', route: null, failureReason: 'invalid_response' };
    }

    return { status: 'ok', route: { distanceMeters, durationSeconds }, failureReason: null };
  } catch (error) {
    logError('OpenRouteService request failed', error);
    const timedOut = error instanceof Error && error.message === 'Routing request timed out';
    return { status: 'unavailable', route: null, failureReason: timedOut ? 'provider_timeout' : 'provider_error' };
  }
}

export function createOpenRouteServiceProvider(apiKey: string): RoutingProvider {
  return {
    name: 'openrouteservice',
    async getDrivingRoute(origin, destination): Promise<RouteOutcome> {
      const minuteLimit = await checkRateLimit(RATE_LIMIT_SCOPE, 'openrouteservice:minute', MAX_PER_MINUTE, 60);
      if (!minuteLimit.allowed) {
        return { status: 'unavailable', route: null, failureReason: 'rate_limited' };
      }
      const dayLimit = await checkRateLimit(RATE_LIMIT_SCOPE, 'openrouteservice:day', MAX_PER_DAY, 60 * 60 * 24);
      if (!dayLimit.allowed) {
        return { status: 'unavailable', route: null, failureReason: 'rate_limited' };
      }

      const cacheKey = `routing:ors:v1:${roundCoord(origin.lat)},${roundCoord(origin.lon)}:${roundCoord(destination.lat)},${roundCoord(destination.lon)}`;

      try {
        return await getCached(cacheKey, async () => {
          const outcome = await callOrs(origin, destination, apiKey);
          if (outcome.status !== 'ok') {
            // Never cache a failure — a transient outage shouldn't "stick".
            throw new RouteUnavailableError(outcome);
          }
          return outcome;
        }, ROUTE_CACHE_TTL_SECONDS);
      } catch (error) {
        if (error instanceof RouteUnavailableError) return error.outcome;
        logError('Unexpected error calling OpenRouteService', error);
        return { status: 'unavailable', route: null, failureReason: 'provider_error' };
      }
    },
  };
}

class RouteUnavailableError extends Error {
  constructor(public outcome: RouteOutcome) {
    super('Route unavailable');
  }
}
