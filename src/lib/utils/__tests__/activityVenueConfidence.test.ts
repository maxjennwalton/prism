import { evaluateVenueCandidates } from '../activityVenueConfidence';
import type { GeocodeResult } from '@/lib/integrations/geocode';

function candidate(overrides: Partial<GeocodeResult> = {}): GeocodeResult {
  return {
    placeId: 1,
    displayName: 'Some Place',
    fullName: 'Some Place, ON, Canada',
    latitude: 44.5,
    longitude: -80.2,
    importance: 0.1,
    ...overrides,
  };
}

describe('evaluateVenueCandidates', () => {
  it('rejects with no_candidates when the search returned nothing', () => {
    expect(evaluateVenueCandidates([])).toEqual({ accepted: null, reason: 'no_candidates' });
  });

  it('auto-accepts a single low-importance candidate — the root-cause fix: a unique match needs no importance floor', () => {
    const only = candidate({ placeId: 42, importance: 0.05 });
    expect(evaluateVenueCandidates([only])).toEqual({ accepted: only, reason: 'unique_match' });
  });

  it('picks the candidate clearly nearest the bias point among several low-importance candidates', () => {
    const near = candidate({ placeId: 1, latitude: 44.5, longitude: -80.2, importance: 0.05 });
    const far = candidate({ placeId: 2, latitude: 51.5, longitude: -0.1, importance: 0.05 }); // London, UK
    const result = evaluateVenueCandidates([far, near], { lat: 44.5, lon: -80.2 });
    expect(result).toEqual({ accepted: near, reason: 'proximity_confident' });
  });

  it('falls back to the importance heuristic when candidates are too close together for proximity to decide', () => {
    const a = candidate({ placeId: 1, latitude: 44.5, longitude: -80.2, importance: 0.5 });
    const b = candidate({ placeId: 2, latitude: 44.5001, longitude: -80.2001, importance: 0.1 });
    const result = evaluateVenueCandidates([a, b], { lat: 44.5, lon: -80.2 });
    expect(result).toEqual({ accepted: a, reason: 'importance_confident' });
  });

  it('is ambiguous when candidates are close together and neither importance nor proximity can decide', () => {
    const a = candidate({ placeId: 1, latitude: 44.5, longitude: -80.2, importance: 0.1 });
    const b = candidate({ placeId: 2, latitude: 44.5001, longitude: -80.2001, importance: 0.11 });
    const result = evaluateVenueCandidates([a, b], { lat: 44.5, lon: -80.2 });
    expect(result).toEqual({ accepted: null, reason: 'ambiguous' });
  });

  it('falls back to the importance heuristic when no bias point is given at all', () => {
    const a = candidate({ placeId: 1, importance: 0.8 });
    const b = candidate({ placeId: 2, importance: 0.1 });
    const result = evaluateVenueCandidates([a, b]);
    expect(result).toEqual({ accepted: a, reason: 'importance_confident' });
  });

  it('does not reject an away-game candidate far from home when it is the clear nearest of the candidate set', () => {
    // Bias is the household's Home; the away-game venue is legitimately far
    // from it, but it's still the one candidate that matches the search
    // text closely, so it is still the nearest of the set.
    const awayVenue = candidate({ placeId: 1, latitude: 46.0, longitude: -79.0, importance: 0.05 });
    const unrelatedDistantPlace = candidate({ placeId: 2, latitude: -33.9, longitude: 151.2, importance: 0.05 }); // Sydney
    const result = evaluateVenueCandidates([unrelatedDistantPlace, awayVenue], { lat: 44.5, lon: -80.2 });
    expect(result).toEqual({ accepted: awayVenue, reason: 'proximity_confident' });
  });

  it('remains ambiguous rather than guessing when candidates are equidistant and equally unimportant', () => {
    const a = candidate({ placeId: 1, latitude: 44.5, longitude: -80.2, importance: 0.05 });
    const b = candidate({ placeId: 2, latitude: 44.5, longitude: -80.2, importance: 0.05 });
    const result = evaluateVenueCandidates([a, b], { lat: 10, lon: 10 });
    expect(result).toEqual({ accepted: null, reason: 'ambiguous' });
  });

  describe('road-segment filtering (real example: a street address resolving to both the road and the building on it)', () => {
    it('prefers the building/POI match over a highway/road-segment match at the same address, even with near-identical importance', () => {
      const road = candidate({ placeId: 1, class: 'highway', type: 'residential', latitude: 44.5, longitude: -80.2001, importance: 0.1 });
      const building = candidate({ placeId: 2, class: 'building', type: 'yes', latitude: 44.5, longitude: -80.2, importance: 0.1 });
      const result = evaluateVenueCandidates([road, building], { lat: 44.5, lon: -80.2 });
      expect(result).toEqual({ accepted: building, reason: 'unique_match' });
    });

    it('still disambiguates by proximity/importance among the remaining non-road candidates when more than one is left', () => {
      const road = candidate({ placeId: 1, class: 'highway', type: 'residential', latitude: 1, longitude: 1, importance: 0.1 });
      const near = candidate({ placeId: 2, class: 'amenity', type: 'sports_centre', latitude: 44.5, longitude: -80.2, importance: 0.05 });
      const far = candidate({ placeId: 3, class: 'building', type: 'yes', latitude: 51.5, longitude: -0.1, importance: 0.05 });
      const result = evaluateVenueCandidates([road, near, far], { lat: 44.5, lon: -80.2 });
      expect(result).toEqual({ accepted: near, reason: 'proximity_confident' });
    });

    it('falls back to the full candidate set, never discarding every candidate, when all of them are road segments', () => {
      const road1 = candidate({ placeId: 1, class: 'highway', type: 'residential', importance: 0.2 });
      const road2 = candidate({ placeId: 2, class: 'highway', type: 'tertiary', importance: 0.19 });
      const result = evaluateVenueCandidates([road1, road2]);
      // No non-road candidate exists to prefer — same importance-heuristic outcome as before this fix.
      expect(result).toEqual({ accepted: null, reason: 'ambiguous' });
    });

    it('does not alter a set with no road-segment candidates at all', () => {
      const a = candidate({ placeId: 1, class: 'amenity', type: 'sports_centre', importance: 0.8 });
      const b = candidate({ placeId: 2, class: 'building', type: 'yes', importance: 0.1 });
      const result = evaluateVenueCandidates([a, b]);
      expect(result).toEqual({ accepted: a, reason: 'importance_confident' });
    });
  });
});
