/**
 * Tests for the ROUTING_PROVIDER dispatcher. The API key is read only from
 * process.env (never from a client-supplied value) and the provider is
 * never the ORS one unless both ROUTING_PROVIDER=openrouteservice and
 * OPENROUTESERVICE_API_KEY are set.
 */
import { getRoutingProvider } from '../index';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('getRoutingProvider', () => {
  it('defaults to the none provider when ROUTING_PROVIDER is unset', async () => {
    delete process.env.ROUTING_PROVIDER;
    delete process.env.OPENROUTESERVICE_API_KEY;
    const provider = getRoutingProvider();
    expect(provider.name).toBe('none');
    const outcome = await provider.getDrivingRoute({ lat: 0, lon: 0 }, { lat: 1, lon: 1 });
    expect(outcome).toEqual({ status: 'unavailable', route: null, failureReason: 'not_configured' });
  });

  it('uses the none provider for an explicit ROUTING_PROVIDER=none', () => {
    process.env.ROUTING_PROVIDER = 'none';
    expect(getRoutingProvider().name).toBe('none');
  });

  it('falls back to the none provider when openrouteservice is selected but no API key is configured', () => {
    process.env.ROUTING_PROVIDER = 'openrouteservice';
    delete process.env.OPENROUTESERVICE_API_KEY;
    expect(getRoutingProvider().name).toBe('none');
  });

  it('uses the openrouteservice provider when selected with an API key present', () => {
    process.env.ROUTING_PROVIDER = 'openrouteservice';
    process.env.OPENROUTESERVICE_API_KEY = 'test-key';
    expect(getRoutingProvider().name).toBe('openrouteservice');
  });

  it('falls back to none for an unrecognized ROUTING_PROVIDER value', () => {
    process.env.ROUTING_PROVIDER = 'some-future-provider';
    expect(getRoutingProvider().name).toBe('none');
  });
});
