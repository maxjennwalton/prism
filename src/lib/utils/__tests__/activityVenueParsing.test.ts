import { buildSearchQueries, normalizeVenueName, parseVenueLocation } from '../activityVenueParsing';

describe('parseVenueLocation', () => {
  it('returns all nulls for empty/blank input', () => {
    expect(parseVenueLocation('')).toEqual({ venueName: null, streetAddress: null, cityProvince: null });
    expect(parseVenueLocation('   ')).toEqual({ venueName: null, streetAddress: null, cityProvince: null });
    expect(parseVenueLocation(null)).toEqual({ venueName: null, streetAddress: null, cityProvince: null });
    expect(parseVenueLocation(undefined)).toEqual({ venueName: null, streetAddress: null, cityProvince: null });
  });

  it('parses a bare venue name with no address at all', () => {
    expect(parseVenueLocation('Osprey Community Arena')).toEqual({
      venueName: 'Osprey Community Arena',
      streetAddress: null,
      cityProvince: null,
    });
  });

  it('parses a dash-separated venue name and street+city', () => {
    expect(parseVenueLocation('Eddie Bush Arena - 100 First St, Midland ON')).toEqual({
      venueName: 'Eddie Bush Arena',
      streetAddress: '100 First St',
      cityProvince: 'Midland ON',
    });
  });

  it('parses a dash-separated venue name with only a city, no street number', () => {
    expect(parseVenueLocation('Osprey Arena - Osprey, ON')).toEqual({
      venueName: 'Osprey Arena',
      streetAddress: null,
      cityProvince: 'Osprey, ON',
    });
  });

  it('parses a comma-separated venue name, street address, and multi-part city/province', () => {
    expect(parseVenueLocation('All Around Athletics Centre, 123 Main St, Collingwood, ON L9Y 1A1')).toEqual({
      venueName: 'All Around Athletics Centre',
      streetAddress: '123 Main St',
      cityProvince: 'Collingwood, ON L9Y 1A1',
    });
  });

  it('parses a bare street address with no venue name as a pure address', () => {
    expect(parseVenueLocation('123 Main Street, Collingwood ON')).toEqual({
      venueName: null,
      streetAddress: '123 Main Street',
      cityProvince: 'Collingwood ON',
    });
  });

  it('parses a single street-address segment with no city at all', () => {
    expect(parseVenueLocation('100 First St')).toEqual({
      venueName: null,
      streetAddress: '100 First St',
      cityProvince: null,
    });
  });

  it('never invents a city/province that is not present in the input', () => {
    const result = parseVenueLocation('Rink B');
    expect(result.cityProvince).toBeNull();
    expect(result.streetAddress).toBeNull();
  });

  it('treats a hyphen without surrounding spaces as part of the name, not a separator', () => {
    expect(parseVenueLocation('All-Star Arena')).toEqual({
      venueName: 'All-Star Arena',
      streetAddress: null,
      cityProvince: null,
    });
  });

  describe('pipe-separated facility descriptors (real example: soccer calendar export)', () => {
    it('extracts the street address past a "dash then pipe" facility descriptor, discarding the descriptor as noise', () => {
      expect(parseVenueLocation('All Around Athletics Centre - Full Facility | 91 Sandford Fleming Dr, Peterborough, ON')).toEqual({
        venueName: 'All Around Athletics Centre',
        streetAddress: '91 Sandford Fleming Dr',
        cityProvince: 'Peterborough, ON',
      });
    });

    it('extracts the street address past a comma-only facility descriptor (no pipe), same result', () => {
      expect(parseVenueLocation('All Around Athletics Centre - Full Facility, 91 Sandford Fleming Dr, Peterborough, ON')).toEqual({
        venueName: 'All Around Athletics Centre',
        streetAddress: '91 Sandford Fleming Dr',
        cityProvince: 'Peterborough, ON',
      });
    });

    it('extracts the street address when the facility descriptor is comma-separated with no dash at all', () => {
      expect(parseVenueLocation('All Around Athletics Centre, Full Facility, 91 Sandford Fleming Dr, Peterborough, ON')).toEqual({
        venueName: 'All Around Athletics Centre',
        streetAddress: '91 Sandford Fleming Dr',
        cityProvince: 'Peterborough, ON',
      });
    });

    it('handles a pipe with no preceding dash or facility descriptor', () => {
      expect(parseVenueLocation('Osprey Community Arena | 95 Osprey Dr, Osprey, ON')).toEqual({
        venueName: 'Osprey Community Arena',
        streetAddress: '95 Osprey Dr',
        cityProvince: 'Osprey, ON',
      });
    });

    it('never discards the street address when the facility descriptor is itself multi-word and comma-free', () => {
      expect(parseVenueLocation('Eddie Bush Arena - Rink 1 Full Facility Rental | 100 First St, Midland, ON')).toEqual({
        venueName: 'Eddie Bush Arena',
        streetAddress: '100 First St',
        cityProvince: 'Midland, ON',
      });
    });

    it('still discards the facility descriptor with no address at all, leaving cityProvince null rather than a garbage blob', () => {
      expect(parseVenueLocation('Eddie Bush Arena - Full Facility | Rink Only Booking')).toEqual({
        venueName: 'Eddie Bush Arena',
        streetAddress: null,
        cityProvince: 'Full Facility, Rink Only Booking',
      });
    });
  });
});

describe('normalizeVenueName', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeVenueName('Eddie Bush Arena')).toBe('eddie bush arena');
    expect(normalizeVenueName('Osprey Comm. Arena  -  Rink #1')).toBe('osprey comm arena rink 1');
  });

  it('keeps descriptor words like "arena" and "community" as part of identity', () => {
    expect(normalizeVenueName('Osprey Community Arena')).toBe('osprey community arena');
  });

  it('produces the same key for superficially different variants of the same venue', () => {
    expect(normalizeVenueName('All Around Athletics Centre')).toBe(normalizeVenueName('ALL AROUND ATHLETICS CENTRE!'));
  });
});

describe('buildSearchQueries', () => {
  it('orders street+city, street alone, venue+city, venue alone, then raw text, deduplicated', () => {
    const parsed = parseVenueLocation('Eddie Bush Arena - 100 First St, Midland ON');
    const raw = 'Eddie Bush Arena - 100 First St, Midland ON';
    expect(buildSearchQueries(parsed, raw)).toEqual([
      '100 First St, Midland ON',
      '100 First St',
      'Eddie Bush Arena, Midland ON',
      'Eddie Bush Arena',
      raw,
    ]);
  });

  it('falls back to just the venue name and raw text when there is no address at all', () => {
    const parsed = parseVenueLocation('Osprey Community Arena');
    expect(buildSearchQueries(parsed, 'Osprey Community Arena')).toEqual(['Osprey Community Arena']);
  });

  it('falls back to just the street address and raw text when there is no venue name', () => {
    const parsed = parseVenueLocation('123 Main Street, Collingwood ON');
    expect(buildSearchQueries(parsed, '123 Main Street, Collingwood ON')).toEqual([
      '123 Main Street, Collingwood ON',
      '123 Main Street',
    ]);
  });

  it('never produces an empty query list for non-empty input', () => {
    const parsed = parseVenueLocation('Rink B');
    expect(buildSearchQueries(parsed, 'Rink B').length).toBeGreaterThan(0);
  });

  it('prioritizes the clean street address first for the real soccer example, past its "dash then pipe" facility descriptor', () => {
    const raw = 'All Around Athletics Centre - Full Facility | 91 Sandford Fleming Dr, Peterborough, ON';
    const parsed = parseVenueLocation(raw);
    expect(buildSearchQueries(parsed, raw)).toEqual([
      '91 Sandford Fleming Dr, Peterborough, ON',
      '91 Sandford Fleming Dr',
      'All Around Athletics Centre, Peterborough, ON',
      'All Around Athletics Centre',
      raw,
    ]);
  });
});
