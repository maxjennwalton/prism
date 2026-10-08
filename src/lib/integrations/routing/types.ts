/**
 * Provider-agnostic shape for Phase 4B's driving-time routing. A new
 * provider (e.g. a self-hosted OSRM instance) only needs to implement
 * RoutingProvider — nothing above this layer (the travel calculation
 * service, the precedence resolution in activityTravelResolution.ts)
 * needs to know which one is active.
 */

export interface RoutingCoordinate {
  lat: number;
  lon: number;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
}

/**
 * Why a routing attempt came back without a result — surfaced in
 * travel_meta.failureReason for diagnosis (and Weekly Review detection),
 * never shown to a parent as a raw string.
 */
export type RouteFailureReason =
  | 'not_configured'
  | 'rate_limited'
  | 'provider_timeout'
  | 'provider_error'
  | 'invalid_response';

export interface RouteOutcome {
  status: 'ok' | 'unavailable';
  /** Present only when status is 'ok'. */
  route: RouteResult | null;
  /** Present only when status is 'unavailable'. */
  failureReason: RouteFailureReason | null;
}

export interface RoutingProvider {
  /** Machine-readable provider id, stored in travel_meta.provider for display/debugging. */
  readonly name: string;
  getDrivingRoute(origin: RoutingCoordinate, destination: RoutingCoordinate): Promise<RouteOutcome>;
}
