/**
 * Routing provider dispatch for Phase 4B (Automatic Travel). Selects the
 * active provider from ROUTING_PROVIDER — same env-var-only, server-side-
 * only configuration convention as the rest of Prism's optional
 * integrations (PIRATE_WEATHER_API_KEY, GOOGLE_CLIENT_SECRET, etc. in
 * .env.example). The API key is read here and only here; it is never
 * returned to the browser or logged.
 */
import { createOpenRouteServiceProvider } from './openRouteService';
import type { RoutingProvider, RouteOutcome } from './types';

export type { RoutingProvider, RouteOutcome, RoutingCoordinate, RouteResult, RouteFailureReason } from './types';

const noopProvider: RoutingProvider = {
  name: 'none',
  async getDrivingRoute(): Promise<RouteOutcome> {
    return { status: 'unavailable', route: null, failureReason: 'not_configured' };
  },
};

/**
 * Returns the configured routing provider, derived fresh from env on every
 * call (cheap — just a string check and a small object) so a changed
 * OPENROUTESERVICE_API_KEY or ROUTING_PROVIDER is always reflected
 * immediately, with no stale-cache window to reason about.
 */
export function getRoutingProvider(): RoutingProvider {
  const providerName = process.env.ROUTING_PROVIDER;

  if (providerName === 'openrouteservice') {
    const apiKey = process.env.OPENROUTESERVICE_API_KEY;
    return apiKey ? createOpenRouteServiceProvider(apiKey) : noopProvider;
  }

  return noopProvider;
}
