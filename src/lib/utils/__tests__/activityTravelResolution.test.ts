import {
  resolveEffectiveTravel,
  resolveEffectiveDeparture,
  hashTravelLocation,
  hashTravelText,
  haversineDistanceMeters,
  isAmbiguousGeocodeMatch,
  travelSourceLabel,
  MAX_PLAUSIBLE_ACTIVITY_DISTANCE_METERS,
  type ActivityTravelCalculation,
} from '../activityTravelResolution';

function calc(overrides: Partial<ActivityTravelCalculation> = {}): ActivityTravelCalculation {
  return {
    status: 'ok',
    minutes: 25,
    departureInputHash: 'dep-hash',
    destinationInputHash: 'dest-hash',
    ...overrides,
  };
}

describe('resolveEffectiveTravel — precedence: manual override -> fresh calculation -> profile fallback -> unavailable', () => {
  it('(a) uses the manual override when set, even to 0, ahead of everything else', () => {
    const result = resolveEffectiveTravel({
      travelMinutesOverride: 0,
      calculation: calc({ minutes: 99 }),
      currentDepartureInputHash: 'dep-hash',
      currentDestinationInputHash: 'dest-hash',
      profileTravelMinutes: 15,
    });
    expect(result).toEqual({ minutes: 0, source: 'manual_override' });
  });

  it('(b) uses a fresh successful calculation when there is no manual override', () => {
    const result = resolveEffectiveTravel({
      travelMinutesOverride: null,
      calculation: calc({ minutes: 25 }),
      currentDepartureInputHash: 'dep-hash',
      currentDestinationInputHash: 'dest-hash',
      profileTravelMinutes: 15,
    });
    expect(result).toEqual({ minutes: 25, source: 'calculated' });
  });

  it('a calculated 0 (same-location route) is honored as real, not treated as missing', () => {
    const result = resolveEffectiveTravel({
      travelMinutesOverride: null,
      calculation: calc({ minutes: 0 }),
      currentDepartureInputHash: 'dep-hash',
      currentDestinationInputHash: 'dest-hash',
      profileTravelMinutes: 15,
    });
    expect(result).toEqual({ minutes: 0, source: 'calculated' });
  });

  it('(c) falls back to the profile default when there is no override and no fresh calculation', () => {
    const result = resolveEffectiveTravel({
      travelMinutesOverride: null,
      calculation: null,
      currentDepartureInputHash: 'dep-hash',
      currentDestinationInputHash: 'dest-hash',
      profileTravelMinutes: 15,
    });
    expect(result).toEqual({ minutes: 15, source: 'profile_fallback' });
  });

  it('a profile fallback of 0 is preserved, not treated as unconfigured', () => {
    const result = resolveEffectiveTravel({
      travelMinutesOverride: null,
      calculation: null,
      currentDepartureInputHash: 'dep-hash',
      currentDestinationInputHash: 'dest-hash',
      profileTravelMinutes: 0,
    });
    expect(result).toEqual({ minutes: 0, source: 'profile_fallback' });
  });

  it('(d) is unavailable when nothing is configured at all', () => {
    const result = resolveEffectiveTravel({
      travelMinutesOverride: null,
      calculation: null,
      currentDepartureInputHash: null,
      currentDestinationInputHash: null,
      profileTravelMinutes: null,
    });
    expect(result).toEqual({ minutes: null, source: 'unavailable' });
  });

  it('falls back to profile when the calculation failed (status unavailable)', () => {
    const result = resolveEffectiveTravel({
      travelMinutesOverride: null,
      calculation: calc({ status: 'unavailable', minutes: null }),
      currentDepartureInputHash: 'dep-hash',
      currentDestinationInputHash: 'dest-hash',
      profileTravelMinutes: 15,
    });
    expect(result).toEqual({ minutes: 15, source: 'profile_fallback' });
  });

  it('treats a stale calculation (departure hash changed since) as not fresh and falls back to profile', () => {
    const result = resolveEffectiveTravel({
      travelMinutesOverride: null,
      calculation: calc({ departureInputHash: 'old-dep-hash' }),
      currentDepartureInputHash: 'new-dep-hash',
      currentDestinationInputHash: 'dest-hash',
      profileTravelMinutes: 15,
    });
    expect(result).toEqual({ minutes: 15, source: 'profile_fallback' });
  });

  it('treats a stale calculation (destination hash changed since) as not fresh', () => {
    const result = resolveEffectiveTravel({
      travelMinutesOverride: null,
      calculation: calc({ destinationInputHash: 'old-dest-hash' }),
      currentDepartureInputHash: 'dep-hash',
      currentDestinationInputHash: 'new-dest-hash',
      profileTravelMinutes: null,
    });
    expect(result).toEqual({ minutes: null, source: 'unavailable' });
  });

  it('never surfaces a stale calculation when current hashes are unknown (null)', () => {
    const result = resolveEffectiveTravel({
      travelMinutesOverride: null,
      calculation: calc(),
      currentDepartureInputHash: null,
      currentDestinationInputHash: null,
      profileTravelMinutes: null,
    });
    expect(result).toEqual({ minutes: null, source: 'unavailable' });
  });

  it('never uses a calculation with status ok but a null minutes value', () => {
    const result = resolveEffectiveTravel({
      travelMinutesOverride: null,
      calculation: calc({ minutes: null }),
      currentDepartureInputHash: 'dep-hash',
      currentDestinationInputHash: 'dest-hash',
      profileTravelMinutes: 10,
    });
    expect(result).toEqual({ minutes: 10, source: 'profile_fallback' });
  });
});

describe('travelSourceLabel — exact required display strings', () => {
  it('maps each source to its exact required label', () => {
    expect(travelSourceLabel('calculated')).toBe('Calculated driving estimate');
    expect(travelSourceLabel('manual_override')).toBe('Manual override');
    expect(travelSourceLabel('profile_fallback')).toBe('Profile fallback');
    expect(travelSourceLabel('unavailable')).toBe('Travel time needed');
  });
});

describe('resolveEffectiveDeparture — per-event override -> Home -> null', () => {
  it('prefers the per-event departure override over Home', () => {
    expect(resolveEffectiveDeparture('123 Override St', '456 Home Ave')).toBe('123 Override St');
  });

  it('falls back to Home when there is no override', () => {
    expect(resolveEffectiveDeparture(null, '456 Home Ave')).toBe('456 Home Ave');
    expect(resolveEffectiveDeparture(undefined, '456 Home Ave')).toBe('456 Home Ave');
  });

  it('ignores a whitespace-only override and falls back to Home', () => {
    expect(resolveEffectiveDeparture('   ', '456 Home Ave')).toBe('456 Home Ave');
  });

  it('returns null when neither override nor Home is configured', () => {
    expect(resolveEffectiveDeparture(null, null)).toBeNull();
    expect(resolveEffectiveDeparture(undefined, undefined)).toBeNull();
  });
});

describe('hashTravelLocation — stable fingerprint of a resolved location', () => {
  it('produces the same hash for the same address/coordinates', () => {
    const a = hashTravelLocation({ address: '123 Main St', lat: 40.7128, lon: -74.006 });
    const b = hashTravelLocation({ address: '123 Main St', lat: 40.7128, lon: -74.006 });
    expect(a).toBe(b);
  });

  it('is case/whitespace insensitive on the address text', () => {
    const a = hashTravelLocation({ address: '123 Main St', lat: 40.7128, lon: -74.006 });
    const b = hashTravelLocation({ address: '  123 MAIN ST  ', lat: 40.7128, lon: -74.006 });
    expect(a).toBe(b);
  });

  it('changes when the address text changes, even at identical coordinates', () => {
    const a = hashTravelLocation({ address: '123 Main St', lat: 40.7128, lon: -74.006 });
    const b = hashTravelLocation({ address: '456 Main St', lat: 40.7128, lon: -74.006 });
    expect(a).not.toBe(b);
  });

  it('changes when coordinates change, even at identical address text', () => {
    const a = hashTravelLocation({ address: '123 Main St', lat: 40.7128, lon: -74.006 });
    const b = hashTravelLocation({ address: '123 Main St', lat: 41.0, lon: -74.006 });
    expect(a).not.toBe(b);
  });

  it('is not sensitive to float-formatting noise past 6 decimal places', () => {
    const a = hashTravelLocation({ address: '123 Main St', lat: 40.712800000001, lon: -74.006 });
    const b = hashTravelLocation({ address: '123 Main St', lat: 40.7128, lon: -74.006 });
    expect(a).toBe(b);
  });
});

describe('hashTravelText — fingerprint of raw text alone (no coordinates)', () => {
  it('produces the same hash for the same text', () => {
    expect(hashTravelText('123 Main St')).toBe(hashTravelText('123 Main St'));
  });

  it('is case/whitespace insensitive', () => {
    expect(hashTravelText('123 Main St')).toBe(hashTravelText('  123 MAIN ST  '));
  });

  it('changes when the text changes', () => {
    expect(hashTravelText('123 Main St')).not.toBe(hashTravelText('456 Main St'));
  });

  it('differs from hashTravelLocation for the same address text (distinct hash spaces)', () => {
    const textHash = hashTravelText('123 Main St');
    const locationHash = hashTravelLocation({ address: '123 Main St', lat: 0, lon: 0 });
    expect(textHash).not.toBe(locationHash);
  });
});

describe('isAmbiguousGeocodeMatch — safe-to-auto-route heuristic', () => {
  it('is ambiguous when there are no candidates', () => {
    expect(isAmbiguousGeocodeMatch([])).toBe(true);
  });

  it('is not ambiguous for a single strong, confident match', () => {
    expect(isAmbiguousGeocodeMatch([{ importance: 0.8 }])).toBe(false);
  });

  it('is ambiguous when the sole candidate has low importance', () => {
    expect(isAmbiguousGeocodeMatch([{ importance: 0.1 }])).toBe(true);
  });

  it('is ambiguous when two candidates are close in importance (no clear winner)', () => {
    expect(isAmbiguousGeocodeMatch([{ importance: 0.55 }, { importance: 0.53 }])).toBe(true);
  });

  it('is not ambiguous when the top candidate clearly outranks the rest', () => {
    expect(isAmbiguousGeocodeMatch([{ importance: 0.8 }, { importance: 0.4 }, { importance: 0.2 }])).toBe(false);
  });

  it('does not depend on input order', () => {
    const unordered = [{ importance: 0.2 }, { importance: 0.8 }, { importance: 0.4 }];
    expect(isAmbiguousGeocodeMatch(unordered)).toBe(false);
  });
});

describe('haversineDistanceMeters — great-circle distance sanity gate', () => {
  it('is 0 for the same point', () => {
    expect(haversineDistanceMeters({ lat: 43.6, lon: -79.4 }, { lat: 43.6, lon: -79.4 })).toBe(0);
  });

  it('is symmetric — order of the two points never matters', () => {
    const a = { lat: 43.6, lon: -79.4 };
    const b = { lat: 40.7, lon: -74.0 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });

  it('matches the exact closed-form quarter-circumference distance, pole to equator (latitude axis)', () => {
    const quarterCircumference = (6_371_000 * Math.PI) / 2;
    const distance = haversineDistanceMeters({ lat: 90, lon: 0 }, { lat: 0, lon: 0 });
    expect(distance).toBeCloseTo(quarterCircumference, 0);
  });

  it('matches the exact closed-form quarter-circumference distance along the equator (longitude axis) — confirms lon is not swapped with lat', () => {
    const quarterCircumference = (6_371_000 * Math.PI) / 2;
    const distance = haversineDistanceMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 90 });
    expect(distance).toBeCloseTo(quarterCircumference, 0);
  });

  it('matches the exact closed-form half-circumference (antipodal poles)', () => {
    const halfCircumference = 6_371_000 * Math.PI;
    const distance = haversineDistanceMeters({ lat: 90, lon: 0 }, { lat: -90, lon: 0 });
    expect(distance).toBeCloseTo(halfCircumference, 0);
  });

  it('returns a small, locally-plausible distance for two nearby points (~0.001 degree apart)', () => {
    const distance = haversineDistanceMeters({ lat: 43.0, lon: -79.0 }, { lat: 43.001, lon: -79.0 });
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(120);
  });

  it('a plausible local activity distance never trips MAX_PLAUSIBLE_ACTIVITY_DISTANCE_METERS', () => {
    const distance = haversineDistanceMeters({ lat: 44.5, lon: -80.2 }, { lat: 44.6, lon: -80.1 });
    expect(distance).toBeLessThan(MAX_PLAUSIBLE_ACTIVITY_DISTANCE_METERS);
  });

  it('a cross-continental mismatch far exceeds MAX_PLAUSIBLE_ACTIVITY_DISTANCE_METERS, and stays safely under OpenRouteService\'s own 6,000,000 m limit for the gate to fire first', () => {
    const distance = haversineDistanceMeters({ lat: 44.5, lon: -80.2 }, { lat: 51.5, lon: -0.1 }); // ~5,700 km, Ontario to London
    expect(distance).toBeGreaterThan(MAX_PLAUSIBLE_ACTIVITY_DISTANCE_METERS);
  });
});

describe('MAX_PLAUSIBLE_ACTIVITY_DISTANCE_METERS', () => {
  it('is a positive bound comfortably under OpenRouteService\'s own 6,000,000 m hard limit', () => {
    expect(MAX_PLAUSIBLE_ACTIVITY_DISTANCE_METERS).toBeGreaterThan(0);
    expect(MAX_PLAUSIBLE_ACTIVITY_DISTANCE_METERS).toBeLessThan(6_000_000);
  });
});
